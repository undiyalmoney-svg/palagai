import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { PaperLedgerService } from './paper-ledger.service';
import {
  ALL_PAPER_BOOKS,
  LivePaperBookState,
  LivePaperSession,
  emptySession,
  istDay,
  paperCfg,
  restoreDayStops,
  summarizePaper,
  tickBook,
  deskOf,
  underOf,
} from './live-paper.engine';
import {
  kiteOrderErrorOf,
  kiteOrderIdOf,
  PaperLiveBooks,
  PaperLiveUnder,
  overlayPaperWithKite,
  paperLiveArmed,
  paperLiveArmedFor,
  paperLiveBuyFields,
  paperLiveExitFields,
  paperLiveStopFields,
} from './paper-live-order.util';
import { PaperLiveApiService, PaperLiveView } from './paper-live-api.service';
import { readPaperLiveArm, writePaperLiveArm } from './paper-live-arm.util';
import { PaperTickQuote, runPaperTick } from './paper-tick.run';

export { bestBidAsk, needsOption, nextExpiryAsOf, optionMarkLast } from './paper-tick.run';

const STORAGE_KEY = 'palagai_live_paper_v11';
const TICK_MS = 8_000;

@Injectable({ providedIn: 'root' })
export class LivePaperService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kite = inject(KiteSessionService);
  private readonly ledger = inject(PaperLedgerService);
  private readonly paperLiveApi = inject(PaperLiveApiService);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private dropletLoop = false;
  private readonly placing = new Set<string>();

  readonly session = signal<LivePaperSession>(readStored() || emptySession(istDay()));
  readonly busy = signal(false);
  /** Live Kite radio. Restored from localStorage so a refresh or tab close does not disarm. */
  readonly liveToggle = signal(readPaperLiveArm().live);
  /** Per-book real-order checkboxes. Restored with the radio. */
  readonly liveBooks = signal<PaperLiveBooks>(readPaperLiveArm().books);
  readonly dropletWatching = signal(false);
  readonly dropletPlacing = signal(false);
  readonly dropletNote = signal('');

  constructor() {
    if (typeof localStorage === 'undefined') return;
    this.stampLive();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.session().running) void this.tick();
      });
      window.addEventListener('pagehide', () => this.handoffDroplet());
    }
    void this.boot();
  }

  liveArmed(): boolean {
    return paperLiveArmed(this.liveToggle(), this.liveBooks());
  }

  liveArmedFor(under: string): boolean {
    return paperLiveArmedFor(this.liveToggle(), this.liveBooks(), under);
  }

  setLiveToggle(on: boolean): void {
    this.liveToggle.set(!!on);
    this.persistArm();
    this.stampLive();
    void this.pushDroplet();
  }

  setLiveBook(under: PaperLiveUnder, on: boolean): void {
    this.liveBooks.update((cur) => ({ ...cur, [under]: !!on }));
    this.persistArm();
    this.stampLive();
    void this.pushDroplet();
  }

  private persistArm(): void {
    writePaperLiveArm({ live: this.liveToggle(), books: this.liveBooks() });
  }

  private stampLive(): void {
    const cur = this.session();
    const snap = summarizePaper(cur.books, {
      running: cur.running,
      day: cur.day,
      startedAt: cur.startedAt,
      asOf: cur.asOf,
      source: cur.source,
      kiteFunds: cur.kiteFunds,
      kiteError: cur.kiteError,
      liveOrders: this.liveArmed(),
    });
    this.session.set(snap);
    persist(snap);
  }

  async start(): Promise<void> {
    const auth = this.kite.getAuthorizationHeader();
    if (!auth) {
      const idle = emptySession(istDay());
      const snap = {
        ...idle,
        liveOrders: this.liveArmed(),
        kiteError: 'Connect Kite on Token first. Paper still records once started; Live Kite needs Token.',
        source: 'idle',
      };
      this.session.set(snap);
      persist(snap);
      return;
    }
    const day = istDay();
    const prev = this.session();
    const base =
      prev.day === day
        ? { ...prev, running: true, startedAt: prev.startedAt || new Date().toISOString(), kiteError: null }
        : { ...emptySession(day), running: true, startedAt: new Date().toISOString() };
    this.session.set({ ...base, liveOrders: this.liveArmed() });
    persist(this.session());
    await this.pushDroplet();
    this.loop();
    await this.tick();
  }

  stop(): void {
    this.clearTimer();
    this.dropletLoop = false;
    const cur = this.session();
    const books = cur.books.map((b) => {
      if (b.side === 'flat' || b.entry == null || b.last == null) return b;
      return tickBook(b, paperCfg(b.id), [], b.last, cur.day, 24 * 60, b.instrument);
    });
    const snap = summarizePaper(books, {
      running: false,
      day: cur.day,
      startedAt: cur.startedAt,
      asOf: new Date().toISOString(),
      source: cur.source,
      kiteFunds: cur.kiteFunds,
      kiteError: cur.kiteError,
      liveOrders: this.liveArmed(),
    });
    this.session.set(snap);
    persist(snap);
    this.ledger.sync(snap.day, snap.books.flatMap((b) => b.fills));
    void this.pushDroplet();
  }

  private loop(): void {
    this.clearTimer();
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    if (this.dropletWatching() && this.dropletLoop) {
      await this.pullDroplet();
      return;
    }
    const auth = this.kite.getAuthorizationHeader();
    if (!auth) {
      const cur = this.session();
      const snap = {
        ...cur,
        running: false,
        kiteError: 'Connect Kite on Token first. Paper still records once started; Live Kite needs Token.',
      };
      this.clearTimer();
      this.session.set(snap);
      persist(snap);
      return;
    }
    this.ticking = true;
    this.busy.set(true);
    try {
      const prevBooks = this.session().books;
      let snap = await runPaperTick({
        live: this.liveToggle(),
        liveBooks: this.liveBooks(),
        session: this.session(),
        fetchMargins: () => firstValueFrom(this.kiteApi.getUserMargins(auth)).catch(() => null),
        fetchCsv: () => firstValueFrom(this.kiteApi.getInstrumentsCsv(auth)).catch(() => ''),
        fetchQuotes: async (keys) => {
          if (!keys.length) return {};
          const res = (await firstValueFrom(this.kiteApi.getQuotes(auth, keys))) as {
            data?: Record<string, PaperTickQuote>;
          };
          return res?.data || {};
        },
        fetchHistorical: async (token, interval, from, to) => {
          const hist = (await firstValueFrom(
            this.kiteApi.getHistoricalData({
              instrumentToken: token,
              interval,
              from,
              to,
              authorization: auth,
            }),
          ).catch(() => null)) as { data?: { candles?: unknown[][] } } | null;
          return hist?.data?.candles || [];
        },
      });
      if (!this.dropletPlacing()) {
        const nextBooks: LivePaperBookState[] = [];
        for (const next of snap.books) {
          const prev = prevBooks.find((b) => b.id === next.id) || next;
          nextBooks.push(await overlayPaperWithKite(next, () => this.syncKite(prev, next), kiteOrderErrorOf));
        }
        snap = summarizePaper(nextBooks, {
          running: snap.running,
          day: snap.day,
          startedAt: snap.startedAt,
          asOf: snap.asOf,
          source: snap.source,
          kiteFunds: snap.kiteFunds,
          kiteError: snap.kiteError,
          liveOrders: this.liveArmed(),
        });
      }
      this.session.set(snap);
      persist(snap);
      this.ledger.sync(snap.day, snap.books.flatMap((b) => b.fills));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kite fetch failed';
      const cur = this.session();
      const snap = { ...cur, kiteError: message, source: cur.source || 'kite' };
      this.session.set(snap);
      persist(snap);
    } finally {
      this.ticking = false;
      this.busy.set(false);
    }
  }

  private applyDroplet(view: PaperLiveView | null): boolean {
    if (!view) {
      this.dropletWatching.set(false);
      this.dropletPlacing.set(false);
      return false;
    }
    this.dropletWatching.set(!!view.dropletWatching);
    this.dropletPlacing.set(!!view.dropletPlacing);
    this.dropletNote.set(view.lastError || view.lastMessage || '');
    const dropletOwnsArm = !!view.dropletWatching || !!view.dropletPlacing || !!view.live || !!view.running;
    if (dropletOwnsArm) {
      if (view.live != null) this.liveToggle.set(!!view.live);
      if (view.books) this.liveBooks.set({ ...this.liveBooks(), ...view.books });
      this.persistArm();
    }
    if (view.session && Array.isArray(view.session.books) && view.session.books.length) {
      const snap = { ...view.session, liveOrders: this.liveArmed() };
      this.session.set(snap);
      persist(snap);
      this.ledger.sync(snap.day, snap.books.flatMap((b) => b.fills));
    } else {
      this.stampLive();
    }
    return !!view.dropletWatching;
  }

  private async hydrateDroplet(): Promise<void> {
    const view = await this.paperLiveApi.get();
    if (!view) return;
    const watching = this.applyDroplet(view);
    if (watching && this.session().running) {
      this.dropletLoop = true;
      this.loop();
    }
  }

  private async boot(): Promise<void> {
    await this.hydrateDroplet();
    if (this.session().running || this.liveArmed()) {
      await this.pushDroplet();
    }
    if (this.session().running) {
      this.loop();
      void this.tick();
    }
  }

  private async pullDroplet(): Promise<void> {
    const view = await this.paperLiveApi.get();
    if (!this.applyDroplet(view)) {
      this.dropletLoop = false;
      if (this.session().running) void this.tick();
    }
  }

  private dropletBody() {
    return {
      running: this.session().running,
      live: this.liveToggle(),
      books: this.liveBooks(),
      session: this.session(),
    };
  }

  private async pushDroplet(): Promise<void> {
    const view = await this.paperLiveApi.set(this.dropletBody());
    const watching = this.applyDroplet(view);
    this.dropletLoop = watching && this.session().running;
  }

  private handoffDroplet(): void {
    this.persistArm();
    persist(this.session());
    this.paperLiveApi.beacon(this.dropletBody());
  }

  private async syncKite(prev: LivePaperBookState, next: LivePaperBookState): Promise<LivePaperBookState> {
    if (this.dropletPlacing()) return next;
    const auth = this.kite.getAuthorizationHeader();
    const closed = next.fills.length > prev.fills.length;
    if (closed && (prev.kiteBuyOrderId || prev.kiteSlOrderId)) {
      if (!auth) return { ...next, kiteNote: 'Live Kite needs Token.' };
      return this.kiteFlatten(
        {
          ...next,
          optionSymbol: next.optionSymbol || prev.optionSymbol,
          optionToken: next.optionToken || prev.optionToken,
          lot: next.lot || prev.lot,
          kiteBuyOrderId: prev.kiteBuyOrderId,
          kiteSlOrderId: prev.kiteSlOrderId,
        },
        auth,
      );
    }
    if (!this.liveArmedFor(underOf(next.id))) return next;
    if (!auth) return { ...next, kiteNote: 'Live Kite needs Token.' };
    if (next.side !== 'flat' && next.optionSymbol && next.optionToken > 0) {
      return this.kiteEnter(next, auth);
    }
    return next;
  }

  private async kiteEnter(book: LivePaperBookState, auth: string): Promise<LivePaperBookState> {
    if (this.placing.has(book.id)) return book;
    const ticket = {
      under: underOf(book.id),
      optionSymbol: book.optionSymbol,
      optionToken: book.optionToken,
      lot: book.lot,
    };
    let next = book;
    this.placing.add(book.id);
    try {
      if (!next.kiteBuyOrderId) {
        const fields = paperLiveBuyFields(ticket);
        if (!fields) return { ...next, kiteNote: 'No listed contract — Kite buy skipped.' };
        try {
          const res = await firstValueFrom(this.kiteApi.placeRegularOrder(auth, fields));
          const id = kiteOrderIdOf(res);
          if (!id) return { ...next, kiteNote: 'Kite returned no buy id. Check the order book.' };
          next = { ...next, kiteBuyOrderId: id, kiteNote: `Kite buy ${id}` };
        } catch (err) {
          return { ...next, kiteNote: kiteOrderErrorOf(err) };
        }
      }
      if (next.kiteBuyOrderId && !next.kiteSlOrderId && next.sl != null && next.sl > 0) {
        const fields = paperLiveStopFields(ticket, next.sl);
        if (!fields) return { ...next, kiteNote: `${next.kiteNote || ''} · could not rest SL`.trim() };
        try {
          const res = await firstValueFrom(this.kiteApi.placeRegularOrder(auth, fields));
          const id = kiteOrderIdOf(res);
          if (!id) return { ...next, kiteNote: `${next.kiteNote || ''} · Kite returned no SL id`.trim() };
          next = { ...next, kiteSlOrderId: id, kiteNote: `${next.kiteNote || ''} · SL ${id} at ₹${fields['trigger_price']}`.trim() };
        } catch (err) {
          return { ...next, kiteNote: `${next.kiteNote || ''} · SL ${kiteOrderErrorOf(err)}`.trim() };
        }
      }
      return next;
    } finally {
      this.placing.delete(book.id);
    }
  }

  private async kiteFlatten(book: LivePaperBookState, auth: string): Promise<LivePaperBookState> {
    if (this.placing.has(`x:${book.id}`)) return book;
    this.placing.add(`x:${book.id}`);
    const notes: string[] = [];
    try {
      if (book.kiteSlOrderId) {
        try {
          await firstValueFrom(this.kiteApi.cancelRegularOrder(auth, book.kiteSlOrderId));
          notes.push(`cancelled SL ${book.kiteSlOrderId}`);
        } catch (err) {
          notes.push(`SL cancel ${kiteOrderErrorOf(err)}`);
        }
      }
      const ticket = {
        under: underOf(book.id),
        optionSymbol: book.optionSymbol,
        optionToken: book.optionToken,
        lot: book.lot,
      };
      const fields = paperLiveExitFields(ticket);
      if (fields) {
        try {
          const res = await firstValueFrom(this.kiteApi.placeRegularOrder(auth, fields));
          const id = kiteOrderIdOf(res);
          notes.push(id ? `Kite exit ${id}` : 'Kite returned no exit id');
        } catch (err) {
          notes.push(`exit ${kiteOrderErrorOf(err)}`);
        }
      }
      return {
        ...book,
        kiteBuyOrderId: '',
        kiteSlOrderId: '',
        kiteNote: notes.join(' · ') || book.kiteNote,
      };
    } finally {
      this.placing.delete(`x:${book.id}`);
    }
  }
}

function persist(snap: LivePaperSession): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* ignore quota */
  }
}

function readStored(): LivePaperSession | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LivePaperSession;
    if (!parsed || !Array.isArray(parsed.books)) return null;
    const ids = parsed.books.map((b) => b.id).join(',');
    const want = ALL_PAPER_BOOKS.map((b) => b.id).join(',');
    const optionOk = parsed.books
      .filter((b) => (b.desk || deskOf(b.id)) !== 'scalp')
      .every((b) => String(b.product || '').includes('CE/PE'));
    if (ids !== want || !optionOk) return null;
    const arm = readPaperLiveArm();
    return {
      ...parsed,
      liveOrders: paperLiveArmed(arm.live, arm.books),
      guaranteed: false,
      armedOnCrudeBest: false,
      assumed: true,
      books: parsed.books.map((b) => restoreDayStops({
        ...b,
        desk: b.desk || deskOf(b.id),
        under: b.under || underOf(b.id),
        optionSymbol: b.optionSymbol || '',
        optionType: b.optionType || '',
        strike: b.strike ?? null,
        expiry: b.expiry || '',
        lot: b.lot || 0,
        optionToken: b.optionToken || 0,
        neededCeRs: b.neededCeRs ?? null,
        neededCe: b.neededCe || '',
        neededPeRs: b.neededPeRs ?? null,
        neededPe: b.neededPe || '',
        neededLot: b.neededLot || 0,
        neededAtAsk: !!b.neededAtAsk,
        lossesToday: b.lossesToday || 0,
        cooldownUntil: b.cooldownUntil ?? -1,
        entryMin: b.entryMin ?? null,
        lastSignalMin: b.lastSignalMin ?? -1,
        capitalUsed: b.capitalUsed || 0,
        kiteBuyOrderId: b.kiteBuyOrderId || '',
        kiteSlOrderId: b.kiteSlOrderId || '',
        kiteNote: b.kiteNote || '',
      }, parsed.day)),
    };
  } catch {
    return null;
  }
}

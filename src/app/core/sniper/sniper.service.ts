import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { UiDialogService } from '../../shared/ui/dialog/ui-dialog.service';
import { SniperApiService, SniperView } from './sniper-api.service';
import { emptySniperSession, flattenSniperBook, summarizeSniper } from './sniper-engine';
import { SNIPER_BOOKS, SNIPER_HONEST, SNIPER_STOP_RS, SniperBookState, SniperSession } from './sniper.models';
import {
  keepSniperOnKite,
  kiteOrderErrorOf,
  kiteOrderIdOf,
  sniperBuyFields,
  sniperBuyPlaced,
  sniperExitFields,
  sniperOpenBuyId,
  sniperStopFields,
} from './sniper-order.util';
import { runSniperTick, SniperTickQuote } from './sniper-tick.run';
import { sniperIstDay, sniperIstMinutes } from './sniper-clock';

const STORAGE_KEY = 'palagai_sniper_v2';
const TICK_MS = 8_000;

function readStored(): SniperSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SniperSession;
    if (!parsed || !Array.isArray(parsed.books) || parsed.books.length !== 3) return null;
    return { ...parsed, honest: SNIPER_HONEST };
  } catch {
    return null;
  }
}

function persist(snap: SniperSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* quota */
  }
}

@Injectable({ providedIn: 'root' })
export class SniperService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kite = inject(KiteSessionService);
  private readonly api = inject(SniperApiService);
  private readonly dialog = inject(UiDialogService);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private dropletLoop = false;
  private tickGen = 0;
  private dropletSeq = 0;
  private csvAt = 0;
  private csvDump = '';
  private readonly placing = new Set<string>();

  readonly session = signal<SniperSession>(readStored() || emptySniperSession(sniperIstDay()));
  readonly busy = signal(false);
  readonly dropletWatching = signal(false);
  readonly dropletPlacing = signal(false);
  readonly dropletNote = signal('');

  constructor() {
    if (typeof localStorage === 'undefined') return;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.session().running) void this.tick();
      });
      window.addEventListener('pagehide', () => this.handoff());
    }
    void this.boot();
  }

  async start(): Promise<void> {
    const auth = this.kite.getAuthorizationHeader();
    if (!auth) {
      const idle = emptySniperSession(sniperIstDay());
      this.session.set({
        ...idle,
        kiteError: 'Connect Kite on Token first. Paper still records once started; Live Kite needs Token.',
      });
      persist(this.session());
      return;
    }
    const day = sniperIstDay();
    const prev = this.session();
    const base =
      prev.day === day
        ? { ...prev, running: true, startedAt: prev.startedAt || new Date().toISOString(), kiteError: null }
        : {
            ...emptySniperSession(day, new Date().toISOString(), prev),
            running: true,
            mode: prev.liveArmed ? ('live' as const) : ('paper' as const),
            liveArmed: prev.liveArmed,
            paperOn: prev.paperOn !== false,
            startedAt: new Date().toISOString(),
          };
    this.tickGen += 1;
    this.session.set(summarizeSniper(base, { running: true }));
    persist(this.session());
    this.loop();
    void this.pushDroplet({ takeSession: false });
    void this.tick();
  }

  stop(): void {
    this.tickGen += 1;
    this.ticking = false;
    this.busy.set(false);
    this.clearTimer();
    this.dropletLoop = false;
    const cur = this.session();
    const nowIso = new Date().toISOString();
    const nowMin = sniperIstMinutes();
    const books = cur.books.map((b) => {
      const cfg = SNIPER_BOOKS.find((c) => c.id === b.id)!;
      if (b.side !== 'long') return b;
      return flattenSniperBook(b, cfg, nowMin, nowIso, b.last);
    });
    const snap = summarizeSniper({ ...cur, books }, { running: false, asOf: nowIso });
    this.session.set(snap);
    persist(snap);
    void this.pushDroplet({ takeSession: false });
  }

  setPaper(on: boolean): void {
    const snap = summarizeSniper(this.session(), { paperOn: on, mode: this.session().liveArmed ? 'live' : 'paper' });
    this.session.set(snap);
    persist(snap);
    void this.pushDroplet({ takeSession: false });
  }

  setLots(lots: number): void {
    const n = Math.max(1, Math.floor(Number(lots) || 1));
    const snap = summarizeSniper(this.session(), { lots: n });
    this.session.set(snap);
    persist(snap);
    void this.pushDroplet({ takeSession: false });
  }

  setStopRs(stopRs: number): void {
    const n = Math.max(1, Math.round(Number(stopRs) || SNIPER_STOP_RS));
    const snap = summarizeSniper(this.session(), { stopRs: n });
    this.session.set(snap);
    persist(snap);
    void this.pushDroplet({ takeSession: false });
  }

  setWatch(id: string, on: boolean): void {
    const books = this.session().books.map((b) => (b.id === id ? { ...b, watch: on } : b));
    const snap = summarizeSniper(this.session(), { books });
    this.session.set(snap);
    persist(snap);
    void this.pushDroplet({ takeSession: false });
  }

  async armLive(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Live Kite?',
      message: `MARKET buy and ₹${this.session().stopRs} SL on the first ORB cut.`,
      confirmLabel: 'Live on',
      cancelLabel: 'Paper',
      tone: 'danger',
    });
    if (!ok) return;
    const snap = summarizeSniper(this.session(), { mode: 'live', liveArmed: true, paperOn: true });
    this.session.set(snap);
    persist(snap);
    void this.pushDroplet({ takeSession: false });
  }

  disarmLive(): void {
    const snap = summarizeSniper(this.session(), { mode: 'paper', liveArmed: false });
    this.session.set(snap);
    persist(snap);
    void this.pushDroplet({ takeSession: false });
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
    if (!this.session().running) return;
    const tabHidden = typeof document !== 'undefined' && document.hidden === true;
    if (tabHidden && this.dropletWatching() && this.dropletLoop) {
      await this.pullDroplet();
      return;
    }
    const auth = this.kite.getAuthorizationHeader();
    if (!auth) {
      const cur = this.session();
      this.clearTimer();
      const snap = { ...cur, running: false, kiteError: 'Connect Kite on Token first.' };
      this.session.set(snap);
      persist(snap);
      return;
    }
    const gen = this.tickGen;
    this.ticking = true;
    this.busy.set(true);
    try {
      const prevBooks = this.session().books;
      let snap = await runSniperTick({
        now: undefined,
        session: this.session(),
        fetchCsv: () => this.instrumentsCsv(auth),
        fetchQuotes: async (keys) => {
          if (!keys.length) return {};
          const res = (await firstValueFrom(this.kiteApi.getQuotes(auth, keys))) as {
            data?: Record<string, SniperTickQuote>;
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
      if (gen !== this.tickGen || !this.session().running) return;
      if (!this.dropletPlacing() && snap.mode === 'live' && snap.liveArmed) {
        const nextBooks: SniperBookState[] = [];
        for (const next of snap.books) {
          const prev = prevBooks.find((b) => b.id === next.id) || next;
          nextBooks.push(await this.overlayKite(prev, next));
        }
        snap = summarizeSniper({ ...snap, books: nextBooks });
      }
      if (gen !== this.tickGen || !this.session().running) return;
      this.session.set(snap);
      persist(snap);
      void this.pushDroplet({ takeSession: false });
    } catch (err) {
      if (gen !== this.tickGen || !this.session().running) return;
      const cur = this.session();
      const snap = { ...cur, kiteError: err instanceof Error ? err.message : 'Kite fetch failed' };
      this.session.set(snap);
      persist(snap);
    } finally {
      if (gen === this.tickGen) {
        this.ticking = false;
        this.busy.set(false);
      }
    }
  }

  private replayNow(): Date {
    const day = this.session().replayDay;
    const now = new Date();
    const ist = new Date(`${day}T15:30:00+05:30`);
    return now.getTime() < ist.getTime() ? now : ist;
  }

  private async instrumentsCsv(auth: string): Promise<string> {
    if (this.csvDump && Date.now() - this.csvAt < 30 * 60 * 1000) return this.csvDump;
    const csv = await firstValueFrom(this.kiteApi.getInstrumentsCsv(auth)).catch(() => '');
    if (csv && csv.length > 80) {
      this.csvDump = csv;
      this.csvAt = Date.now();
    }
    return csv;
  }

  private applyDroplet(view: SniperView | null, opts?: { takeSession?: boolean }): boolean {
    if (!view) {
      this.dropletWatching.set(false);
      this.dropletPlacing.set(false);
      return false;
    }
    this.dropletWatching.set(!!view.dropletWatching);
    this.dropletPlacing.set(!!view.dropletPlacing);
    this.dropletNote.set(view.lastError || view.lastMessage || '');
    const takeSession = opts?.takeSession !== false;
    const books = Array.isArray(view.session?.books)
      ? view.session.books.filter((b) => b.id === 'nifty' || b.id === 'bank' || b.id === 'sensex')
      : [];
    if (takeSession && view.session && books.length === 3) {
      const snap = {
        ...view.session,
        books,
        honest: SNIPER_HONEST,
        liveArmed: this.session().liveArmed,
        mode: this.session().mode,
        stopRs: Number(view.session.stopRs) > 0 ? view.session.stopRs : SNIPER_STOP_RS,
      };
      if (view.live != null) snap.liveArmed = !!view.live;
      this.session.set(snap);
      persist(snap);
    }
    return !!view.dropletWatching;
  }

  private async hydrate(): Promise<void> {
    const view = await this.api.get();
    if (!view) return;
    const watching = this.applyDroplet(view);
    if (watching && this.session().running) {
      this.dropletLoop = true;
      this.loop();
    }
  }

  private async boot(): Promise<void> {
    await this.hydrate();
    if (this.session().running || this.session().liveArmed) void this.pushDroplet();
    if (this.session().running) {
      this.loop();
      void this.tick();
    }
  }

  private async pullDroplet(): Promise<void> {
    const view = await this.api.get();
    if (!this.applyDroplet(view)) {
      this.dropletLoop = false;
      if (this.session().running) void this.tick();
    }
  }

  private body() {
    const session = this.session();
    return { running: session.running, live: session.liveArmed, mode: session.mode, session };
  }

  private async pushDroplet(opts?: { takeSession?: boolean }): Promise<void> {
    const seq = ++this.dropletSeq;
    const view = await this.api.set(this.body());
    if (seq !== this.dropletSeq) return;
    const watching = this.applyDroplet(view, opts);
    this.dropletLoop = watching && this.session().running;
  }

  private handoff(): void {
    persist(this.session());
    this.api.beacon(this.body());
  }

  private async overlayKite(prev: SniperBookState, next: SniperBookState): Promise<SniperBookState> {
    const auth = this.kite.getAuthorizationHeader();
    const closed = next.fills.length > prev.fills.length;
    if (closed && (prev.kiteBuyOrderId || prev.kiteSlOrderId)) {
      if (!auth) return { ...next, kiteNote: 'Live Kite needs Token.' };
      return this.kiteFlatten(
        {
          ...next,
          optionSymbol: next.optionSymbol || prev.optionSymbol,
          optionToken: next.optionToken || prev.optionToken,
          qty: next.qty || prev.qty,
          kiteBuyOrderId: prev.kiteBuyOrderId,
          kiteSlOrderId: prev.kiteSlOrderId,
        },
        auth,
      );
    }
    if (!this.session().liveArmed) return next;
    if (!auth) return { ...next, kiteNote: 'Live Kite needs Token.' };
    if (next.side !== 'flat' && next.optionSymbol && next.optionToken > 0) {
      try {
        return keepSniperOnKite(next, await this.kiteEnter(next, auth));
      } catch (err) {
        return keepSniperOnKite(next, { kiteNote: kiteOrderErrorOf(err) });
      }
    }
    return next;
  }

  private async kiteEnter(book: SniperBookState, auth: string): Promise<SniperBookState> {
    if (this.placing.has(book.id)) return book;
    const ticket = { under: book.id, optionSymbol: book.optionSymbol, optionToken: book.optionToken, qty: book.qty };
    let next = book;
    this.placing.add(book.id);
    try {
      if (!sniperBuyPlaced(next)) {
        const existing = await this.existingBuy(auth, ticket.optionSymbol);
        if (existing) {
          next = { ...next, kiteBuyOrderId: existing, kiteHalt: true, kiteNote: `Kite buy ${existing} already on the book` };
        } else {
          const fields = sniperBuyFields(ticket);
          if (!fields) return { ...next, kiteNote: 'No listed contract — Kite buy skipped.' };
          try {
            const res = await firstValueFrom(this.kiteApi.placeRegularOrder(auth, fields));
            const id = kiteOrderIdOf(res);
            if (!id) return { ...next, kiteHalt: false, kiteNote: 'Kite rejected — will retry.' };
            next = { ...next, kiteBuyOrderId: id, kiteHalt: true, kiteNote: `Kite buy ${id}` };
          } catch (err) {
            return { ...next, kiteHalt: false, kiteNote: `Kite rejected — will retry. ${kiteOrderErrorOf(err)}` };
          }
        }
      }
      if (next.kiteBuyOrderId && !next.kiteSlOrderId && next.sl != null && next.sl > 0) {
        const fields = sniperStopFields(ticket, next.sl);
        if (!fields) return next;
        try {
          const res = await firstValueFrom(this.kiteApi.placeRegularOrder(auth, fields));
          const id = kiteOrderIdOf(res);
          if (id) next = { ...next, kiteSlOrderId: id, kiteNote: `${next.kiteNote || ''} · SL ${id}`.trim() };
        } catch (err) {
          next = { ...next, kiteNote: `${next.kiteNote || ''} · SL ${kiteOrderErrorOf(err)}`.trim() };
        }
      }
      return next;
    } finally {
      this.placing.delete(book.id);
    }
  }

  private async kiteFlatten(book: SniperBookState, auth: string): Promise<SniperBookState> {
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
      const fields = sniperExitFields({
        under: book.id,
        optionSymbol: book.optionSymbol,
        optionToken: book.optionToken,
        qty: book.qty,
      });
      if (fields) {
        try {
          const res = await firstValueFrom(this.kiteApi.placeRegularOrder(auth, fields));
          const id = kiteOrderIdOf(res);
          notes.push(id ? `Kite exit ${id}` : 'Kite returned no exit id');
        } catch (err) {
          notes.push(`exit ${kiteOrderErrorOf(err)}`);
        }
      }
      return { ...book, kiteBuyOrderId: '', kiteSlOrderId: '', kiteHalt: false, kiteNote: notes.join(' · ') || book.kiteNote };
    } finally {
      this.placing.delete(`x:${book.id}`);
    }
  }

  private async existingBuy(auth: string, symbol: string): Promise<string | null> {
    try {
      const res = await firstValueFrom(this.kiteApi.getOrders(auth));
      const rows = Array.isArray((res as { data?: unknown })?.data)
        ? ((res as { data: Array<{ order_id?: string | number; tradingsymbol?: string; transaction_type?: string; tag?: string; status?: string }> }).data)
        : [];
      return sniperOpenBuyId(rows, symbol);
    } catch {
      return null;
    }
  }
}

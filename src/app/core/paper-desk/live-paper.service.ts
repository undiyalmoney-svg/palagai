import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { Instrument } from '../models/instrument.model';
import { parseKiteInstrumentsCsv } from '../utils/csv.util';
import { CheapOtmPick, pickCheapOtm } from '../utils/pick-cheap-otm.util';
import { LiveAssumeBar, LiveAssumeBookCfg } from './live-assume.engine';
import { liveBuyPrice, lotCostRs, neededLotQuote, replayBudgetSkips } from './live-fill.util';
import { optionRoundTripCharges, venueForBook } from './option-charges.util';
import { PaperLedgerService } from './paper-ledger.service';
import { SkippedSignal } from './paper-analytics.models';
import { buildSignalCard } from './signal-card.util';
import {
  LIVE_PAPER_BOOKS,
  LivePaperBookState,
  LivePaperSession,
  bindOptionFill,
  completedBars,
  emptySession,
  istDay,
  istMinutes,
  optionRangePts,
  optionStopPts,
  summarizePaper,
  tickBook,
} from './live-paper.engine';

const STORAGE_KEY = 'palagai_live_paper_v3';
const TICK_MS = 8_000;

@Injectable({ providedIn: 'root' })
export class LivePaperService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kite = inject(KiteSessionService);
  private readonly ledger = inject(PaperLedgerService);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  readonly session = signal<LivePaperSession>(readStored() || emptySession(istDay()));
  readonly busy = signal(false);

  constructor() {
    if (typeof localStorage === 'undefined') return;
    if (this.session().running) {
      this.loop();
    }
  }

  async start(): Promise<void> {
    const auth = this.kite.getAuthorizationHeader();
    if (!auth) {
      const idle = emptySession(istDay());
      const snap = {
        ...idle,
        kiteError: 'Connect Kite on Token first. Paper only — no order is placed.',
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
    this.session.set(base);
    persist(base);
    this.loop();
    await this.tick();
  }

  stop(): void {
    this.clearTimer();
    const cur = this.session();
    const books = cur.books.map((b) => {
      if (b.side === 'flat' || b.entry == null || b.last == null) return b;
      return tickBook(
        b,
        LIVE_PAPER_BOOKS.find((c) => c.id === b.id) || LIVE_PAPER_BOOKS[0],
        [],
        b.last,
        cur.day,
        24 * 60,
        b.instrument,
      );
    });
    const snap = summarizePaper(books, {
      running: false,
      day: cur.day,
      startedAt: cur.startedAt,
      asOf: new Date().toISOString(),
      source: cur.source,
      kiteFunds: cur.kiteFunds,
      kiteError: cur.kiteError,
    });
    this.session.set(snap);
    persist(snap);
    this.ledger.sync(snap.day, snap.books.flatMap((b) => b.fills));
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
    const auth = this.kite.getAuthorizationHeader();
    if (!auth) {
      const cur = this.session();
      const snap = {
        ...cur,
        running: false,
        kiteError: 'Connect Kite on Token first. Paper only — no order is placed.',
      };
      this.clearTimer();
      this.session.set(snap);
      persist(snap);
      return;
    }
    this.ticking = true;
    this.busy.set(true);
    try {
      const day = istDay();
      const nowMin = istMinutes();
      const raw = this.session().day === day ? this.session() : emptySession(day, new Date().toISOString());
      const cur = { ...raw, books: raw.books.map(replayBudgetSkips) };
      const [margins, csv] = await Promise.all([
        firstValueFrom(this.kiteApi.getUserMargins(auth)).catch(() => null),
        firstValueFrom(this.kiteApi.getInstrumentsCsv(auth)).catch(() => ''),
      ]);
      const funds = margins ? parseFunds(margins) : cur.kiteFunds;
      const dump = String(csv || '');
      const chain = parseKiteInstrumentsCsv(dump);
      const crude = findCrudeMini(dump);
      const nifty = findNamed(dump, ['NIFTY 50']) || { tradingSymbol: 'NIFTY 50', token: 256265, exchange: 'NSE' };
      const bank = findNamed(dump, ['NIFTY BANK']) || { tradingSymbol: 'NIFTY BANK', token: 260105, exchange: 'NSE' };
      const sensex = findNamed(dump, ['SENSEX']) || { tradingSymbol: 'SENSEX', token: 265, exchange: 'BSE' };
      const underKeys = [
        crude ? `MCX:${crude.tradingSymbol}` : '',
        'NSE:NIFTY 50',
        'NSE:NIFTY BANK',
        'BSE:SENSEX',
      ].filter(Boolean);
      const openOptKeys = cur.books
        .filter((b) => b.side !== 'flat' && b.optionSymbol)
        .map((b) => optionKey(b));
      const keys = [...new Set([...underKeys, ...openOptKeys])];
      let quotes = keys.length
        ? ((await firstValueFrom(this.kiteApi.getQuotes(auth, keys))) as { data?: Record<string, KiteQuote> })
            ?.data || {}
        : {};
      const asOf = new Date();
      const cheapByBook = new Map<string, { ce: CheapOtmPick; pe: CheapOtmPick }>();
      const cheapKeys: string[] = [];
      for (const cfg of LIVE_PAPER_BOOKS) {
        const inst =
          cfg.id === 'crude' ? crude : cfg.id === 'nifty' ? nifty : cfg.id === 'bank' ? bank : sensex;
        const spot = lastPrice(quotes, cfg.id, inst?.tradingSymbol || '') ?? 0;
        const pair = cheapPair(chain, cfg.id as 'crude' | 'nifty' | 'bank' | 'sensex', spot, nextExpiryAsOf(asOf));
        cheapByBook.set(cfg.id, pair);
        for (const pick of [pair.ce, pair.pe]) {
          if (pick.instrument.instrumentToken > 0) {
            cheapKeys.push(`${pick.instrument.exchange}:${pick.instrument.tradingSymbol}`);
          }
        }
      }
      const extraKeys = [...new Set(cheapKeys.filter((k) => !keys.includes(k)))];
      if (extraKeys.length) {
        const extra = ((await firstValueFrom(this.kiteApi.getQuotes(auth, extraKeys))) as {
          data?: Record<string, KiteQuote>;
        })?.data || {};
        quotes = { ...quotes, ...extra };
      }
      const from = shiftDay(day, -8);
      const books = [];
      for (const cfg of LIVE_PAPER_BOOKS) {
        const inst =
          cfg.id === 'crude' ? crude : cfg.id === 'nifty' ? nifty : cfg.id === 'bank' ? bank : sensex;
        const prev = cur.books.find((b) => b.id === cfg.id) || emptySession(day).books.find((b) => b.id === cfg.id)!;
        let bars: LiveAssumeBar[] = [];
        if (inst?.token) {
          const hist = (await firstValueFrom(
            this.kiteApi.getHistoricalData({
              instrumentToken: String(inst.token),
              interval: '5minute',
              from,
              to: day,
              authorization: auth,
            }),
          )) as { data?: { candles?: unknown[][] } };
          bars = (hist?.data?.candles || []).map(kiteBar).filter((b) => b.day);
        }
        const underLast = lastPrice(quotes, cfg.id, inst?.tradingSymbol || '');
        const optLast = prev.optionSymbol ? lastByKey(quotes, optionKey(prev)) : null;
        const lastForTick =
          prev.side !== 'flat' && prev.optionSymbol ? (optLast ?? prev.last) : underLast;
        let optionBars: LiveAssumeBar[] = [];
        if (prev.side !== 'flat' && prev.optionToken) {
          const hist = (await firstValueFrom(
            this.kiteApi.getHistoricalData({
              instrumentToken: String(prev.optionToken),
              interval: '5minute',
              from: day,
              to: day,
              authorization: auth,
            }),
          ).catch(() => null)) as { data?: { candles?: unknown[][] } } | null;
          optionBars = (hist?.data?.candles || []).map(kiteBar).filter((b) => b.day);
        }
        let next = tickBook(
          prev,
          cfg,
          bars,
          lastForTick,
          day,
          nowMin,
          prev.optionSymbol || inst?.tradingSymbol || cfg.label,
          optionBars,
        );
        if (needsOption(next)) {
          const spot = underLast ?? next.last ?? next.entry ?? 0;
          const pair = cheapByBook.get(cfg.id);
          next = await this.bindCheap(next, cfg, chain, spot, quotes, nowMin, auth, pair);
          if (next.side !== 'flat' && next.optionToken) {
            next = { ...next, lastBarMin: nowMin - (nowMin % 5) };
          }
        } else if (next.side !== 'flat' && next.optionSymbol && optLast != null) {
          next = { ...next, last: optLast };
        }
        if (next.fills.length > prev.fills.length && prev.optionSymbol) {
          const q = findQuote(quotes, optionKey(prev));
          const { bid, ask } = bestBidAsk(q);
          const stamp = new Date().toISOString();
          const fills = next.fills.map((f, idx) =>
            idx >= prev.fills.length ? { ...f, exitBid: bid, exitAsk: ask, exitAt: stamp } : f,
          );
          next = { ...next, fills };
        }
        const underQuote = findQuote(quotes, underKeyFor(cfg.id, inst?.tradingSymbol, inst?.exchange));
        books.push({
          ...next,
          ...neededFields(cheapByBook.get(cfg.id), quotes),
          quoteAt: quoteStamp(underQuote) || next.quoteAt || '',
        });
      }
      const snap = summarizePaper(books, {
        running: true,
        day,
        startedAt: cur.startedAt || new Date().toISOString(),
        asOf: new Date().toISOString(),
        source: 'kite',
        kiteFunds: funds,
        kiteError: null,
      });
      this.session.set(snap);
      persist(snap);
      this.ledger.sync(day, books.flatMap((b) => b.fills));
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

  private async optionRange(token: number, day: string, nowMin: number, auth: string): Promise<number | null> {
    if (!(token > 0)) return null;
    const hist = (await firstValueFrom(
      this.kiteApi.getHistoricalData({
        instrumentToken: String(token),
        interval: '5minute',
        from: shiftDay(day, -3),
        to: day,
        authorization: auth,
      }),
    ).catch(() => null)) as { data?: { candles?: unknown[][] } } | null;
    const bars = (hist?.data?.candles || []).map(kiteBar).filter((b) => b.day);
    return optionRangePts(completedBars(bars, day, nowMin));
  }

  private async bindCheap(
    book: LivePaperBookState,
    cfg: LiveAssumeBookCfg,
    chain: Instrument[],
    spot: number,
    quotes: Record<string, KiteQuote>,
    nowMin: number,
    auth: string,
    pair?: { ce: CheapOtmPick; pe: CheapOtmPick },
  ): Promise<LivePaperBookState> {
    const id = cfg.id as 'crude' | 'nifty' | 'bank' | 'sensex';
    const pick =
      (book.side === 'long' ? pair?.ce : pair?.pe) ||
      pickCheapOtm({
        instruments: chain,
        book: id,
        direction: book.side === 'long' ? 'BUY' : 'SELL',
        spot,
        asOf: nextExpiryAsOf(new Date()),
        premiumBudgetRs: 10_000_000,
      });
    const listed = pick.instrument.instrumentToken > 0;
    const key = `${pick.instrument.exchange}:${pick.instrument.tradingSymbol}`;
    const q = listed ? findQuote(quotes, key) : null;
    const { bid, ask } = bestBidAsk(q);
    const liveLast = listed ? lastByKey(quotes, key) : null;
    const fill = liveBuyPrice(ask, liveLast);
    const flat = (reason: string, skip: SkippedSignal): LivePaperBookState => ({
      ...book,
      side: 'flat',
      entry: null,
      sl: null,
      tp: null,
      scratch: null,
      status: 'watching',
      reason,
      livePts: 0,
      liveRs: 0,
      skips: [...(book.skips || []), skip].slice(-100),
    });
    if (!listed || fill.price == null) {
      const skip: SkippedSignal = {
        at: new Date().toISOString(),
        day: istDay(),
        book: cfg.id,
        side: pick.side,
        mode: book.mode,
        structure: book.structure,
        contract: listed ? `${pick.instrument.tradingSymbol}` : `${pick.side} ${pick.strike} (not listed)`,
        premium: null,
        lot: pick.lotSize,
        costRs: null,
        budgetRs: 0,
        reason: listed ? 'no-live-quote' : 'no-listed-contract',
      };
      return flat(listed ? 'skipped: no live quote' : 'skipped: no listed contract', skip);
    }
    const prem = fill.price;
    const cost = lotCostRs(prem, pick.lotSize);
    const range = await this.optionRange(pick.instrument.instrumentToken, istDay(), nowMin, auth);
    const stop = optionStopPts(cfg, range);
    const stopPts = Math.min(stop.sl, prem - 0.05);
    const riskRs =
      Math.round((stopPts * pick.lotSize + optionRoundTripCharges(prem, prem - stopPts, pick.lotSize, venueForBook(cfg.id))) * 10) / 10;
    // Worst-case day = two stops: take a new trade only while today's loss is within one stop.
    if (book.closedRs < 0 && -book.closedRs > riskRs) {
      return flat(`day stop: today −₹${Math.abs(book.closedRs)} > one stop ₹${riskRs}`, {
        at: new Date().toISOString(),
        day: istDay(),
        book: cfg.id,
        side: pick.side,
        mode: book.mode,
        structure: book.structure,
        contract: pick.instrument.tradingSymbol,
        premium: prem,
        lot: pick.lotSize,
        costRs: riskRs,
        budgetRs: 0,
        reason: 'day-stop',
      });
    }
    pick.lastPrice = prem;
    pick.openCostRs = cost;
    pick.fitsBudget = true;
    const bound = bindOptionFill(book, cfg, prem, pick, range);
    const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
    const spreadPct = mid != null && mid > 0 ? (ask! - bid!) / mid : null;
    const signal =
      bound.entry != null && bound.sl != null && bound.tp != null
        ? buildSignalCard({
            book: cfg.id,
            venue: venueForBook(cfg.id),
            mode: bound.mode,
            structure: bound.structure,
            primaryRule: cfg.primary[bound.structure === 'wait' ? 'stand' : bound.structure] === bound.mode,
            entry: bound.entry,
            sl: bound.sl,
            tp: bound.tp,
            qty: pick.lotSize,
            premiumCostRs: cost,
            liveAsk: fill.atAsk,
            spreadPct,
            entryMinute: nowMin,
            entryStartMin: cfg.entryS,
            flatMin: cfg.flat,
            dayClosedRs: book.closedRs,
            dayLossCapRs: 2 * riskRs,
          })
        : null;
    return { ...bound, entryBid: bid, entryAsk: ask, entryAt: new Date().toISOString(), signal };
  }
}

const NO_BUDGET_CAP = 10_000_000;

/** Picking "after tomorrow" means a contract with 1 day or less left is never bought; the next expiry is. */
export function nextExpiryAsOf(asOf: Date): Date {
  return new Date(asOf.getTime() + 24 * 60 * 60 * 1000);
}

function cheapPair(
  chain: Instrument[],
  book: 'crude' | 'nifty' | 'bank' | 'sensex',
  spot: number,
  asOf: Date,
): { ce: CheapOtmPick; pe: CheapOtmPick } {
  return {
    ce: pickCheapOtm({
      instruments: chain,
      book,
      direction: 'BUY',
      spot,
      asOf,
      premiumBudgetRs: NO_BUDGET_CAP,
    }),
    pe: pickCheapOtm({
      instruments: chain,
      book,
      direction: 'SELL',
      spot,
      asOf,
      premiumBudgetRs: NO_BUDGET_CAP,
    }),
  };
}

function neededFields(
  pair: { ce: CheapOtmPick; pe: CheapOtmPick } | undefined,
  quotes: Record<string, KiteQuote>,
): Pick<
  LivePaperBookState,
  'neededCeRs' | 'neededCe' | 'neededPeRs' | 'neededPe' | 'neededLot' | 'neededAtAsk'
> {
  if (!pair) {
    return { neededCeRs: null, neededCe: '', neededPeRs: null, neededPe: '', neededLot: 0, neededAtAsk: false };
  }
  const quoteOf = (pick: CheapOtmPick) => {
    if (pick.instrument.instrumentToken <= 0) return null;
    const key = `${pick.instrument.exchange}:${pick.instrument.tradingSymbol}`;
    const { ask } = bestBidAsk(findQuote(quotes, key));
    return neededLotQuote(pick.instrument.tradingSymbol, pick.lotSize, ask, lastByKey(quotes, key));
  };
  const ce = quoteOf(pair.ce);
  const pe = quoteOf(pair.pe);
  return {
    neededCe: ce?.contract || pair.ce.instrument.tradingSymbol || '',
    neededCeRs: ce?.costRs ?? null,
    neededPe: pe?.contract || pair.pe.instrument.tradingSymbol || '',
    neededPeRs: pe?.costRs ?? null,
    neededLot: ce?.lot || pe?.lot || pair.ce.lotSize || pair.pe.lotSize || 0,
    neededAtAsk: !!(ce?.atAsk || pe?.atAsk),
  };
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
    const want = LIVE_PAPER_BOOKS.map((b) => b.id).join(',');
    const cepe = parsed.books.every((b) => String(b.product || '').includes('CE/PE'));
    if (ids !== want || !cepe) return null;
    return {
      ...parsed,
      liveOrders: false,
      guaranteed: false,
      armedOnCrudeBest: false,
      assumed: true,
      books: parsed.books.map((b) => ({
        ...b,
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
      })),
    };
  } catch {
    return null;
  }
}

function parseFunds(payload: unknown): LivePaperSession['kiteFunds'] {
  const root = (payload as { data?: { equity?: Seg; commodity?: Seg } })?.data || {};
  const pocket = (seg?: Seg) => {
    const a = seg?.available || {};
    const live = Number(a.live_balance);
    if (Number.isFinite(live) && live > 0) return Math.round(live);
    const cash = Number(a.cash);
    if (Number.isFinite(cash) && cash > 0) return Math.round(cash);
    return Math.round(Number(seg?.net) || 0);
  };
  return {
    equityCash: pocket(root.equity),
    equityNet: Math.round(Number(root.equity?.net) || 0),
    commodityCash: pocket(root.commodity),
    commodityNet: Math.round(Number(root.commodity?.net) || 0),
  };
}

interface Seg {
  net?: number;
  available?: { live_balance?: number; cash?: number };
}

function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function findCrudeMini(csv: string): { tradingSymbol: string; token: number; exchange: string } | null {
  const today = istDay();
  const rows: { tradingSymbol: string; token: number; exchange: string; expiry: string }[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    if (cols[11].trim().toUpperCase() !== 'MCX' || cols[9].trim().toUpperCase() !== 'FUT') continue;
    if (!cols[2].toUpperCase().startsWith('CRUDEOILM')) continue;
    rows.push({
      token: Number(cols[0]) || 0,
      tradingSymbol: cols[2].trim(),
      exchange: 'MCX',
      expiry: (cols[5] || '').slice(0, 10),
    });
  }
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return rows.find((r) => !r.expiry || r.expiry > today) || null;
}

function findNamed(csv: string, names: string[]): { tradingSymbol: string; token: number; exchange: string } | null {
  const want = names.map((n) => n.toUpperCase());
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    const sym = cols[2].trim().toUpperCase();
    const name = cols[3].trim().toUpperCase();
    if (want.includes(sym) || want.includes(name)) {
      return { tradingSymbol: cols[2].trim(), token: Number(cols[0]) || 0, exchange: cols[11].trim() };
    }
  }
  return null;
}

function kiteBar(row: unknown[]): LiveAssumeBar {
  const raw = String(row[0] || '');
  const d = new Date(raw);
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  const day = raw.slice(0, 10);
  const hh = Number.isNaN(d.getTime()) ? Number(raw.slice(11, 13)) : ist.getUTCHours();
  const mm = Number.isNaN(d.getTime()) ? Number(raw.slice(14, 16)) : ist.getUTCMinutes();
  return {
    day,
    min: hh * 60 + mm,
    open: Number(row[1]) || 0,
    high: Number(row[2]) || 0,
    low: Number(row[3]) || 0,
    close: Number(row[4]) || 0,
  };
}

/** Any open book without a bound option gets one (or goes flat) — it must never run on futures/index prices. */
export function needsOption(next: LivePaperBookState): boolean {
  return next.side !== 'flat' && !next.optionSymbol;
}

function optionKey(book: Pick<LivePaperBookState, 'optionSymbol' | 'id'>): string {
  const ex = book.id === 'crude' ? 'MCX' : book.id === 'sensex' ? 'BFO' : 'NFO';
  return `${ex}:${book.optionSymbol}`;
}

interface KiteQuote {
  last_price?: number;
  timestamp?: string;
  last_trade_time?: string;
  depth?: {
    buy?: { price?: number; quantity?: number }[];
    sell?: { price?: number; quantity?: number }[];
  };
}

function underKeyFor(id: string, symbol: string | undefined, exchange: string | undefined): string {
  if (id === 'nifty') return 'NSE:NIFTY 50';
  if (id === 'bank') return 'NSE:NIFTY BANK';
  if (id === 'sensex') return 'BSE:SENSEX';
  return `${exchange || 'MCX'}:${symbol || ''}`;
}

function findQuote(quotes: Record<string, KiteQuote>, key: string): KiteQuote | null {
  const want = key.toUpperCase();
  for (const [k, v] of Object.entries(quotes)) {
    if (k.toUpperCase() === want) return v;
  }
  return null;
}

/** Best bid / ask from the quote depth. Null when the book is empty (e.g. after the close). */
export function bestBidAsk(q: KiteQuote | null): { bid: number | null; ask: number | null } {
  const bid = Number(q?.depth?.buy?.[0]?.price);
  const ask = Number(q?.depth?.sell?.[0]?.price);
  return {
    bid: Number.isFinite(bid) && bid > 0 ? bid : null,
    ask: Number.isFinite(ask) && ask > 0 ? ask : null,
  };
}

function quoteStamp(q: KiteQuote | null): string {
  return String(q?.timestamp || q?.last_trade_time || '');
}

function lastByKey(quotes: Record<string, KiteQuote>, key: string): number | null {
  const want = key.toUpperCase();
  for (const [k, v] of Object.entries(quotes)) {
    if (k.toUpperCase() === want || k.toUpperCase().endsWith(want.split(':')[1] || '')) {
      const n = Number(v.last_price);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function lastPrice(
  quotes: Record<string, KiteQuote>,
  id: string,
  symbol: string,
): number | null {
  for (const [k, v] of Object.entries(quotes)) {
    const key = k.toUpperCase();
    if (id === 'crude' && key.includes('CRUDE')) return Number(v.last_price) || null;
    if (id === 'nifty' && key.includes('NIFTY 50')) return Number(v.last_price) || null;
    if (id === 'bank' && key.includes('BANK')) return Number(v.last_price) || null;
    if (id === 'sensex' && key.includes('SENSEX')) return Number(v.last_price) || null;
    if (symbol && key.includes(symbol.toUpperCase())) return Number(v.last_price) || null;
  }
  return null;
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + delta);
  return istDay(d);
}

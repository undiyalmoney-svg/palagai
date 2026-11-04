/** Live paper: isolated ₹14k books, Kite watch, no Kite order. Motto: buy CE/PE. */

import {
  LIVE_ASSUME_CAPITAL,
  LIVE_ASSUME_CHARGE,
  LIVE_ASSUME_CRUDE_MIN,
  LiveAssumeBar,
  LiveAssumeBookCfg,
  bookSignal,
  morningStructure,
} from './live-assume.engine';
import { OPTION_14K_BOOKS, OPTION_14K_HONEST, OPTION_14K_LIST, Option14kBookId, option14kToPaperCfg } from './option-14k-plan';
import { CheapOtmPick } from '../utils/pick-cheap-otm.util';
import { optionRoundTripCharges, venueForBook } from './option-charges.util';
import { SignalCard, SkippedSignal } from './paper-analytics.models';

export const LIVE_PAPER_BOOKS: LiveAssumeBookCfg[] = OPTION_14K_LIST.map(option14kToPaperCfg);
export const LIVE_PAPER_CAPITAL = LIVE_ASSUME_CAPITAL;
export const LIVE_PAPER_CHARGE = LIVE_ASSUME_CHARGE;
export const LIVE_PAPER_COOLDOWN_MIN = 60;
export const LIVE_PAPER_MAX_LOSSES = 2;
/** Stop = this × the option's median 5-min high−low; target = LIVE_PAPER_TARGET_R × stop. */
export const LIVE_PAPER_STOP_RANGE_MULT = 1.5;
export const LIVE_PAPER_TARGET_R = 2;
const MIN_RANGE_BARS = 3;
const RANGE_LOOKBACK_BARS = 12;

export interface LivePaperFill {
  day: string;
  book: string;
  label: string;
  side: 'long' | 'short';
  entry: number;
  exit: number;
  sl: number;
  tp: number;
  pts: number;
  rs: number;
  reason: string;
  mode: string;
  optionSymbol?: string;
  optionType?: '' | 'CE' | 'PE';
  strike?: number | null;
  expiry?: string;
  lot?: number;
  structure?: string;
  entryBid?: number | null;
  entryAsk?: number | null;
  exitBid?: number | null;
  exitAsk?: number | null;
  entryAt?: string;
  exitAt?: string;
  signal?: SignalCard | null;
}

export interface OptionPickView {
  id: string;
  optionType?: '' | 'CE' | 'PE';
  strike?: number | null;
  expiry?: string;
  optionSymbol?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function expiryShort(expiry: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry || '');
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim();
}

/** "SENSEX 77000 CE · exp 6 Nov" — the contract the book bought. */
export function optionPickLabel(pick: OptionPickView): string {
  if (!pick.optionType || pick.strike == null) return pick.optionSymbol || '';
  const name = OPTION_14K_BOOKS[pick.id as Option14kBookId]?.name ?? pick.id.toUpperCase();
  const exp = expiryShort(pick.expiry);
  return `${name} ${pick.strike} ${pick.optionType}${exp ? ` · exp ${exp}` : ''}`;
}

export interface LivePaperBookState {
  id: string;
  label: string;
  product: string;
  instrument: string;
  last: number | null;
  structure: string;
  mode: string;
  side: 'flat' | 'long' | 'short';
  entry: number | null;
  sl: number | null;
  tp: number | null;
  scratch: number | null;
  livePts: number;
  liveRs: number;
  closedRs: number;
  fund: number;
  status: 'watching' | 'pending' | 'open' | 'closed';
  pendingDir: number;
  pendingSig: number;
  pendingMode: string;
  lastBarMin: number;
  reason: string;
  fills: LivePaperFill[];
  optionSymbol: string;
  optionType: '' | 'CE' | 'PE';
  strike: number | null;
  expiry: string;
  lot: number;
  optionToken: number;
  entryBid?: number | null;
  entryAsk?: number | null;
  entryAt?: string;
  signal?: SignalCard | null;
  /** Exchange timestamp of the latest underlying quote, as Kite reported it. */
  quoteAt?: string;
  /** Signals the rules fired but the desk could not take (no listed contract / no live quote). */
  skips?: SkippedSignal[];
  /** Live 1-lot cash needed to copy this book's cheap CE. */
  neededCeRs?: number | null;
  neededCe?: string;
  /** Live 1-lot cash needed to copy this book's cheap PE. */
  neededPeRs?: number | null;
  neededPe?: string;
  neededLot?: number;
  neededAtAsk?: boolean;
  /** Losing closes today; the book stands down at LIVE_PAPER_MAX_LOSSES. */
  lossesToday?: number;
  /** IST minute before which no new entry is taken (set after a losing close). */
  cooldownUntil?: number;
}

export interface LivePaperSession {
  assumed: true;
  liveOrders: false;
  guaranteed: false;
  armedOnCrudeBest: false;
  running: boolean;
  day: string;
  startedAt: string | null;
  asOf: string;
  source: string;
  kiteFunds: {
    equityCash: number;
    equityNet: number;
    commodityCash: number;
    commodityNet: number;
  } | null;
  kiteError: string | null;
  books: LivePaperBookState[];
  liveRs: number;
  closedRs: number;
  honest: string;
}

export function emptyBook(cfg: LiveAssumeBookCfg): LivePaperBookState {
  return {
    id: cfg.id,
    label: cfg.label,
    product: cfg.product,
    instrument: cfg.label,
    last: null,
    structure: 'wait',
    mode: 'stand',
    side: 'flat',
    entry: null,
    sl: null,
    tp: null,
    scratch: null,
    livePts: 0,
    liveRs: 0,
    closedRs: 0,
    fund: LIVE_PAPER_CAPITAL,
    status: 'watching',
    pendingDir: 0,
    pendingSig: 0,
    pendingMode: '',
    lastBarMin: -1,
    reason: '',
    fills: [],
    optionSymbol: '',
    optionType: '',
    strike: null,
    expiry: '',
    lot: 0,
    optionToken: 0,
    neededCeRs: null,
    neededCe: '',
    neededPeRs: null,
    neededPe: '',
    neededLot: 0,
    neededAtAsk: false,
    lossesToday: 0,
    cooldownUntil: -1,
  };
}

function isOptionBuy(cfg: LiveAssumeBookCfg): boolean {
  return cfg.buyOption === true;
}

/** Median high−low of the last completed option bars, or null when there are too few to trust. */
export function optionRangePts(bars: LiveAssumeBar[]): number | null {
  const ranges = bars
    .slice(-RANGE_LOOKBACK_BARS)
    .map((b) => b.high - b.low)
    .filter((r) => Number.isFinite(r) && r >= 0)
    .sort((a, b) => a - b);
  if (ranges.length < MIN_RANGE_BARS) return null;
  const mid = Math.floor(ranges.length / 2);
  const med = ranges.length % 2 ? ranges[mid] : (ranges[mid - 1] + ranges[mid]) / 2;
  return med > 0 ? med : null;
}

/** Stop and target distances in premium points: wider of the plan stop and 1.5× the option's range. */
export function optionStopPts(cfg: LiveAssumeBookCfg, rangePts: number | null): { sl: number; tp: number } {
  const sl = Math.max(cfg.sl, rangePts != null ? LIVE_PAPER_STOP_RANGE_MULT * rangePts : 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { sl: r(sl), tp: r(Math.max(cfg.tp, LIVE_PAPER_TARGET_R * sl)) };
}

export function bindOptionFill(
  book: LivePaperBookState,
  cfg: LiveAssumeBookCfg,
  prem: number,
  pick: CheapOtmPick,
  rangePts: number | null = null,
): LivePaperBookState {
  if (book.side === 'flat' || prem <= 0) return book;
  const next: LivePaperBookState = { ...book, fills: [...book.fills] };
  const stop = optionStopPts(cfg, rangePts);
  next.entry = prem;
  next.sl = Math.max(0.05, Math.round((prem - stop.sl) * 100) / 100);
  next.tp = Math.round((prem + stop.tp) * 100) / 100;
  next.scratch = next.sl;
  next.instrument = pick.instrument.tradingSymbol;
  next.optionSymbol = pick.instrument.tradingSymbol;
  next.optionType = pick.side;
  next.strike = pick.strike;
  next.expiry = pick.expiry;
  next.lot = pick.lotSize;
  next.optionToken = pick.instrument.instrumentToken;
  next.last = prem;
  next.reason = `open ${pick.side} ${pick.instrument.tradingSymbol}`;
  markLive(next, prem, cfg);
  return next;
}

/** Re-derives today's loss count and cooldown from the fills, so a reload or an older saved state cannot reset them. */
export function restoreDayStops(book: LivePaperBookState, day: string): LivePaperBookState {
  const losers = book.fills.filter((f) => f.day === day && f.rs < 0);
  const lastLossMin = losers.reduce((m, f) => {
    const t = f.exitAt ? Date.parse(f.exitAt) : NaN;
    return Number.isFinite(t) ? Math.max(m, istMinutes(new Date(t))) : m;
  }, -1);
  return {
    ...book,
    lossesToday: Math.max(book.lossesToday || 0, losers.length),
    cooldownUntil: Math.max(book.cooldownUntil ?? -1, lastLossMin >= 0 ? lastLossMin + LIVE_PAPER_COOLDOWN_MIN : -1),
  };
}

export function emptySession(day: string, asOf = new Date().toISOString()): LivePaperSession {
  const books = LIVE_PAPER_BOOKS.map((cfg) => emptyBook(cfg));
  return summarizePaper(books, {
    running: false,
    day,
    startedAt: null,
    asOf,
    source: 'idle',
    kiteFunds: null,
    kiteError: null,
  });
}

export function istDay(d = new Date()): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function istMinutes(d = new Date()): number {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function completedBars(bars: LiveAssumeBar[], day: string, nowMin: number): LiveAssumeBar[] {
  return bars.filter((b) => b.day < day || (b.day === day && b.min + 5 <= nowMin));
}

/** Rupee P/L of one round trip after charges: exact Zerodha schedule for option buys, flat charge otherwise. */
export function netRs(cfg: LiveAssumeBookCfg, book: Pick<LivePaperBookState, 'lot'>, entry: number, exit: number, pts: number): number {
  if (!isOptionBuy(cfg)) return Math.round((pts * cfg.rsPt - LIVE_PAPER_CHARGE) * 10) / 10;
  const qty = book.lot || cfg.rsPt;
  const charges = optionRoundTripCharges(entry, Math.max(0, exit), qty, venueForBook(cfg.id));
  return Math.round((pts * qty - charges) * 10) / 10;
}

function markLive(book: LivePaperBookState, last: number | null, cfg: LiveAssumeBookCfg): void {
  book.last = last;
  if (book.side === 'flat' || book.entry == null) {
    book.livePts = 0;
    book.liveRs = 0;
    return;
  }
  const px = last ?? book.entry;
  const pts = isOptionBuy(cfg) ? px - book.entry : (book.side === 'long' ? 1 : -1) * (px - book.entry);
  book.livePts = Math.round(pts * 10) / 10;
  book.liveRs = netRs(cfg, book, book.entry, px, pts);
}

function closeAt(
  book: LivePaperBookState,
  cfg: LiveAssumeBookCfg,
  exitPx: number,
  reason: string,
  day: string,
): void {
  if (book.side === 'flat' || book.entry == null) return;
  const pts = isOptionBuy(cfg)
    ? exitPx - book.entry
    : (book.side === 'long' ? 1 : -1) * (exitPx - book.entry);
  const rs = netRs(cfg, book, book.entry, exitPx, pts);
  book.fills.push({
    day,
    book: book.id,
    label: book.label,
    side: book.side,
    entry: book.entry,
    exit: exitPx,
    sl: book.sl || 0,
    tp: book.tp || 0,
    pts: Math.round(pts * 10) / 10,
    rs,
    reason,
    mode: book.mode,
    optionSymbol: book.optionSymbol,
    optionType: book.optionType,
    strike: book.strike,
    expiry: book.expiry,
    lot: book.lot,
    structure: book.structure,
    entryBid: book.entryBid ?? null,
    entryAsk: book.entryAsk ?? null,
    entryAt: book.entryAt,
    signal: book.signal ?? null,
  });
  book.closedRs = Math.round((book.closedRs + rs) * 10) / 10;
  book.fund = Math.round((LIVE_PAPER_CAPITAL + book.closedRs) * 10) / 10;
  book.side = 'flat';
  book.entry = null;
  book.sl = null;
  book.tp = null;
  book.scratch = null;
  book.livePts = 0;
  book.liveRs = 0;
  book.status = 'closed';
  book.reason = reason;
  book.pendingDir = 0;
  book.pendingSig = 0;
  book.pendingMode = '';
  book.optionSymbol = '';
  book.optionType = '';
  book.strike = null;
  book.expiry = '';
  book.lot = 0;
  book.optionToken = 0;
  book.entryBid = null;
  book.entryAsk = null;
  book.entryAt = '';
  book.signal = null;
}

function hitExit(
  book: LivePaperBookState,
  high: number,
  low: number,
  close: number,
  cfg: LiveAssumeBookCfg,
  day: string,
  open: number = close,
): boolean {
  if (book.side === 'flat' || book.entry == null || book.sl == null || book.tp == null || book.scratch == null) {
    return false;
  }
  const long = isOptionBuy(cfg) || book.side === 'long';
  if (long) {
    // A stop is a market-style exit: if the price gapped through the level the fill is the open (or the last
    // price on a tick check), never the better stop level. Targets fill at the target level, never better.
    if (low <= book.sl) {
      closeAt(book, cfg, Math.min(book.sl, open), 'sl', day);
      return true;
    }
    if (low <= book.scratch) {
      closeAt(book, cfg, Math.min(book.scratch, open), 'scratch', day);
      return true;
    }
    if (high >= book.tp) {
      closeAt(book, cfg, book.tp, 'tp', day);
      return true;
    }
    return false;
  }
  if (high >= book.sl) {
    closeAt(book, cfg, book.sl, 'sl', day);
    return true;
  }
  if (high >= book.scratch) {
    closeAt(book, cfg, book.scratch, 'scratch', day);
    return true;
  }
  if (low <= book.tp) {
    closeAt(book, cfg, book.tp, 'tp', day);
    return true;
  }
  return false;
}

function canOpen(book: LivePaperBookState, cfg: LiveAssumeBookCfg, atMin: number): string | null {
  if (cfg.id === 'crude' && LIVE_PAPER_CAPITAL < LIVE_ASSUME_CRUDE_MIN) return 'need ₹8,000 free for Crude';
  if ((book.lossesToday || 0) >= LIVE_PAPER_MAX_LOSSES) return `day stop: ${LIVE_PAPER_MAX_LOSSES} losses`;
  if (book.cooldownUntil != null && atMin < book.cooldownUntil) return 'cooldown after loss';
  if (book.fund <= 0) return 'fund empty';
  return null;
}

function openAt(
  book: LivePaperBookState,
  cfg: LiveAssumeBookCfg,
  dir: number,
  entry: number,
  mode: string,
  atMin: number,
): void {
  const block = canOpen(book, cfg, atMin);
  if (block) {
    book.reason = block;
    book.status = 'watching';
    book.pendingDir = 0;
    return;
  }
  const d = dir === 1 ? 1 : -1;
  book.side = d === 1 ? 'long' : 'short';
  book.entry = entry;
  if (isOptionBuy(cfg)) {
    book.sl = Math.max(0.05, entry - cfg.sl);
    book.tp = entry + cfg.tp;
    book.scratch = book.sl;
  } else {
    book.sl = entry - d * cfg.sl;
    book.tp = entry + d * cfg.tp;
    book.scratch = entry - d * cfg.scratch;
  }
  book.mode = mode;
  book.status = 'open';
  book.reason = 'open';
  book.pendingDir = 0;
  book.pendingSig = 0;
  book.pendingMode = '';
}

function pickSignal(bars: LiveAssumeBar[], i: number, cfg: LiveAssumeBookCfg, structure: string): { dir: number; mode: string } {
  const primary = cfg.primary[structure];
  if (primary) {
    const dir = bookSignal(primary, bars, i, cfg);
    if (dir) return { dir, mode: primary };
  }
  for (const alt of cfg.backup[structure] || []) {
    const dir = bookSignal(alt, bars, i, cfg);
    if (dir) return { dir, mode: alt };
  }
  return { dir: 0, mode: primary || 'stand' };
}

export function tickBook(
  book: LivePaperBookState,
  cfg: LiveAssumeBookCfg,
  bars: LiveAssumeBar[],
  last: number | null,
  day: string,
  nowMin: number,
  instrument: string,
  optionBars: LiveAssumeBar[] = [],
): LivePaperBookState {
  const next: LivePaperBookState = {
    ...book,
    fills: [...book.fills],
    instrument: instrument || book.instrument,
  };
  const done = completedBars(bars, day, nowMin);
  if (nowMin >= cfg.orE) {
    next.structure = morningStructure(done, day, cfg.orS, cfg.orE, cfg.quietW);
  }

  const fillsBefore = next.fills.length;
  if (next.side === 'long' || next.side === 'short') {
    // SL / TP / scratch are premium levels. Index bars (e.g. 76,500) must never be tested against them.
    const exitBars = isOptionBuy(cfg) ? completedBars(optionBars, day, nowMin) : done;
    for (const bar of exitBars) {
      if (bar.day !== day || bar.min <= next.lastBarMin) continue;
      if (hitExit(next, bar.high, bar.low, bar.close, cfg, day, bar.open)) {
        next.lastBarMin = bar.min;
        break;
      }
      next.lastBarMin = bar.min;
    }
    if ((next.side === 'long' || next.side === 'short') && nowMin >= cfg.flat && last != null) {
      closeAt(next, cfg, last, 'eod', day);
    }
    if ((next.side === 'long' || next.side === 'short') && last != null) {
      hitExit(next, last, last, last, cfg, day);
    }
  }

  const closedNow = next.fills.slice(fillsBefore);
  if (closedNow.length) {
    const losses = closedNow.filter((f) => f.rs < 0).length;
    if (losses) {
      next.lossesToday = (next.lossesToday || 0) + losses;
      next.cooldownUntil = nowMin + LIVE_PAPER_COOLDOWN_MIN;
    }
    // A close must not re-open on the same tick at a stale bar open; skip the bars already seen.
    const today = done.filter((b) => b.day === day);
    if (today.length) next.lastBarMin = Math.max(next.lastBarMin, today[today.length - 1].min);
  }

  if (next.side === 'flat' && !closedNow.length) {
    for (let i = 0; i < done.length; i++) {
      const bar = done[i];
      if (bar.day !== day || bar.min <= next.lastBarMin) continue;
      next.lastBarMin = bar.min;
      if (next.pendingDir) {
        const ok =
          next.pendingDir === 1
            ? bar.close > bar.open && bar.close > next.pendingSig
            : bar.close < bar.open && bar.close < next.pendingSig;
        if (ok) {
          openAt(next, cfg, next.pendingDir, bar.open, next.pendingMode || next.mode, bar.min);
        } else {
          next.pendingDir = 0;
          next.pendingSig = 0;
          next.status = 'watching';
          next.reason = 'confirm failed';
        }
        if (next.side !== 'flat') break;
        continue;
      }
      if (bar.min < cfg.entryS || bar.min > cfg.flat - 30) continue;
      const st = next.structure === 'wait' ? 'stand' : next.structure;
      const hit = pickSignal(done, i, cfg, st);
      if (!hit.dir) continue;
      next.pendingDir = hit.dir;
      next.pendingSig = bar.close;
      next.pendingMode = hit.mode;
      next.mode = hit.mode;
      next.status = 'pending';
      next.reason = `confirm ${hit.mode}`;
    }
  }

  markLive(next, last, cfg);
  return next;
}

export function summarizePaper(
  books: LivePaperBookState[],
  extra: Pick<
    LivePaperSession,
    'running' | 'day' | 'startedAt' | 'asOf' | 'source' | 'kiteFunds' | 'kiteError'
  >,
): LivePaperSession {
  const liveRs = Math.round(books.reduce((s, b) => s + (b.side === 'flat' ? 0 : b.liveRs), 0) * 10) / 10;
  const closedRs = Math.round(books.reduce((s, b) => s + b.closedRs, 0) * 10) / 10;
  const fundsLine = extra.kiteFunds
    ? `Kite equity ₹${extra.kiteFunds.equityCash.toLocaleString('en-IN')} · commodity ₹${extra.kiteFunds.commodityCash.toLocaleString('en-IN')}. `
    : '';
  return {
    assumed: true,
    liveOrders: false,
    guaranteed: false,
    armedOnCrudeBest: false,
    running: extra.running,
    day: extra.day,
    startedAt: extra.startedAt,
    asOf: extra.asOf,
    source: extra.source,
    kiteFunds: extra.kiteFunds,
    kiteError: extra.kiteError,
    books,
    liveRs,
    closedRs,
    honest:
      `Paper only — no Kite order is placed. Each book takes 1 lot at the live ask and shows that cash. ` +
      `Motto: buy CE/PE. Cheap next-expiry OTM on all four. SL, target, and live P/L come from the option. ${fundsLine}` +
      `${OPTION_14K_HONEST}`,
  };
}

export function allClosedFills(books: LivePaperBookState[]): LivePaperFill[] {
  return books.flatMap((b) => b.fills);
}

export function booksFundEnd(books: LivePaperBookState[]): number {
  return Math.round(books.reduce((s, b) => s + b.fund, 0) * 10) / 10;
}

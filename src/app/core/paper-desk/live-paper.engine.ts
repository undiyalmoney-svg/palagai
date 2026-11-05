/** Live paper: isolated ₹14k books, Kite watch, no Kite order. Motto: buy CE/PE. */

import {
  LIVE_ASSUME_CAPITAL,
  LIVE_ASSUME_CHARGE,
  LIVE_ASSUME_CRUDE_MIN,
  LiveAssumeBar,
  LiveAssumeBookCfg,
  bookSignal,
  momentumGauge,
  morningStructure,
} from './live-assume.engine';
import { OPTION_14K_BOOKS, OPTION_14K_LIST, Option14kBookId, option14kToPaperCfg } from './option-14k-plan';
import { mixGate } from './paper-mix.util';
import { CheapOtmPick } from '../utils/pick-cheap-otm.util';
import {
  equityMisRoundTripCharges,
  futuresRoundTripCharges,
  optionRoundTripCharges,
  venueForBook,
} from './option-charges.util';
import { SignalCard, SkippedSignal } from './paper-analytics.models';

const ALL = (mode: string) => ({ trend: mode, range: mode, quiet: mode, stand: mode });
/** One failed Nifty ATM cannot take more than this. 40% of a ₹300+ premium is ~₹8k — too much for a ₹14k book. */
export const LIVE_PAPER_MAX_STOP_RS = 3_000;
/** Bank this many rupees and get out. Same rupees on the stop. */
export const LIVE_PAPER_BANK_RS = 375;
const EXIT: Partial<LiveAssumeBookCfg> = {
  backup: {},
  stopPct: 0.4,
  targetPct: 1,
  holdBars: 24,
  maxTradesPerDay: 3,
  minGapBars: 12,
  atm: true,
  noConfirm: false,
  dayStops: false,
  expiryAfterTomorrow: false,
  freshCross: true,
};

/** Cards stay so the blotter can show watches. Only Nifty momentum may open — that is the 3-year tape pick. */
export const PAPER_DESKS: { id: string; label: string; rule: string }[] = [
  { id: 'momentum', label: 'Momentum', rule: 'Nifty only — bank ₹375, stop ₹375, 5 trades, done at 3 wins' },
  { id: 'orb', label: 'Opening range', rule: 'Watch — 3-year test −₹114/trade, CI crosses zero' },
  { id: 'pdhl', label: 'Prev-day break', rule: 'Watch — test CI crosses zero; not the pick' },
  { id: 'vwap', label: 'VWAP fade', rule: 'Watch — 3-year test −₹18/trade (AVGREJECT)' },
  { id: 'trap', label: 'Failed break', rule: 'Watch — no 3-year edge on this exit' },
];

function deskPatch(desk: string, under: string): Partial<LiveAssumeBookCfg> {
  const crude = under === 'crude';
  const open = crude ? 9 * 60 : 9 * 60 + 15;
  const afterOpen = crude ? 9 * 60 + 30 : 9 * 60 + 45;
  if (desk === 'momentum' && under === 'nifty') {
    return {
      strategy: 'momentum',
      primary: ALL('momentum'),
      orS: 9 * 60 + 15,
      orE: 9 * 60 + 30,
      entryS: 9 * 60 + 45,
      maxTradesPerDay: 5,
      maxWinsPerDay: 3,
      minGapBars: 6,
      stopRs: LIVE_PAPER_BANK_RS,
      targetRs: LIVE_PAPER_BANK_RS,
    };
  }
  if (desk === 'orb') {
    return { strategy: 'watch', primary: ALL('orb_break'), orS: open, orE: open + 15, entryS: open + 15 };
  }
  if (desk === 'pdhl') {
    return { strategy: 'watch', primary: ALL('pdhl'), entryS: afterOpen };
  }
  if (desk === 'vwap') {
    return { strategy: 'watch', primary: ALL('vwap_fade'), entryS: afterOpen };
  }
  if (desk === 'trap') {
    return { strategy: 'watch', primary: ALL('trap'), entryS: afterOpen };
  }
  return { strategy: 'watch', primary: ALL('momentum'), entryS: afterOpen };
}

export const PAPER_MOMENTUM: Partial<LiveAssumeBookCfg> = { ...EXIT, ...deskPatch('momentum', 'nifty') };
export const PAPER_TEST_HONEST =
  'Historical pick, not a proven live edge: Nifty 50 momentum only. ATM CE (up) or PE (down), nearest expiry that is not today, ' +
  '1 lot at the live ask, bank ₹375 / stop ₹375, next-bar fill, exact charges. ' +
  'Up to 5 trades a day, stop when 3 have won. The 8-month 5-min tape is red at this 1R. ' +
  'The last 12 live 1-min fills tagged +₹375 nine times and −₹375 three times. ' +
  'Sensex, Bank Nifty, Crude, the other four desks and Scalp are watch-only. The 3-year tape is modelled (previous-day VIX). ' +
  'Forward paper is unproven until 400 trades and a one-sided 95% lower bound above zero on live asks. Not a guaranteed profit.';

export const LIVE_PAPER_BOOKS: LiveAssumeBookCfg[] = PAPER_DESKS.flatMap((desk) =>
  OPTION_14K_LIST.map((plan) => ({
    ...option14kToPaperCfg(plan),
    ...EXIT,
    ...deskPatch(desk.id, plan.id),
    id: `${plan.id}-${desk.id}`,
    under: plan.id,
    desk: desk.id,
    product: `ATM CE/PE ×${plan.lot}`,
  })),
);

/** Separate from the five CE/PE desks. VWAP fade on Crude Mini futures + three cash stocks. */
export const PAPER_SCALP = {
  id: 'scalp',
  label: 'Scalp',
  rule: 'Watch — no 3-year after-cost edge on Crude Mini or the three cash names',
};
const SCALP_EXIT: Partial<LiveAssumeBookCfg> = {
  buyOption: false,
  strategy: 'watch',
  primary: ALL('vwap_fade'),
  backup: {},
  stopPct: 0.0015,
  targetPct: 0.0025,
  vwapPct: 0.0025,
  holdBars: 12,
  maxTradesPerDay: 3,
  minGapBars: 6,
  noConfirm: true,
  dayStops: true,
  desk: 'scalp',
  freshCross: true,
  atm: false,
};
const NIFTY_PLAN = option14kToPaperCfg(OPTION_14K_BOOKS.nifty);
const CRUDE_PLAN = option14kToPaperCfg(OPTION_14K_BOOKS.crude);

function scalpStock(id: string, label: string, symbol: string, qty: number): LiveAssumeBookCfg {
  return {
    ...NIFTY_PLAN,
    ...SCALP_EXIT,
    id: `${id}-scalp`,
    under: id,
    desk: 'scalp',
    label,
    product: `MIS ×${qty}`,
    kind: 'eq',
    qty,
    rsPt: qty,
    nseSymbol: symbol,
    misPct: 0.2,
    sl: 2,
    tp: 4,
    scratch: 2,
    entryS: 9 * 60 + 30,
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 30,
    flat: 15 * 60 + 15,
  };
}

export const PAPER_SCALP_BOOKS: LiveAssumeBookCfg[] = [
  {
    ...CRUDE_PLAN,
    ...SCALP_EXIT,
    id: 'crude-scalp',
    under: 'crude',
    desk: 'scalp',
    label: 'Crude Mini',
    product: 'FUT ×10',
    kind: 'fut',
    qty: 10,
    rsPt: 10,
    nseSymbol: 'CRUDEOILM',
    capitalRs: 28_450,
    sl: 15,
    tp: 25,
    scratch: 15,
    entryS: 9 * 60 + 15,
    orS: 9 * 60,
    orE: 9 * 60 + 15,
    flat: 23 * 60 + 10,
  },
  scalpStock('reliance', 'Reliance', 'RELIANCE', 50),
  scalpStock('hdfcbank', 'HDFC Bank', 'HDFCBANK', 50),
  scalpStock('infy', 'Infosys', 'INFY', 50),
];

export const ALL_PAPER_BOOKS: LiveAssumeBookCfg[] = [...LIVE_PAPER_BOOKS, ...PAPER_SCALP_BOOKS];

export function paperCfg(id: string): LiveAssumeBookCfg {
  return ALL_PAPER_BOOKS.find((b) => b.id === id) || LIVE_PAPER_BOOKS[0];
}

export function underOf(id: string): Option14kBookId {
  const u = id.split('-')[0];
  return (u === 'crude' || u === 'nifty' || u === 'bank' || u === 'sensex' ? u : 'nifty') as Option14kBookId;
}

export function deskOf(id: string): string {
  return id.split('-').slice(1).join('-') || 'momentum';
}
export const LIVE_PAPER_CAPITAL = LIVE_ASSUME_CAPITAL;
export const LIVE_PAPER_CHARGE = LIVE_ASSUME_CHARGE;
export const LIVE_PAPER_COOLDOWN_MIN = 60;
/** A signal bar older than this (e.g. the tab slept) is not traded on catch-up. */
export const LIVE_PAPER_MAX_SIGNAL_AGE_MIN = 10;
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
  desk?: string;
  under?: string;
  charges?: number;
  underEntry?: number | null;
  holdMin?: number;
  gaugeMove?: number | null;
  gaugeNeed?: number | null;
  exitMin?: number;
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
  const name = OPTION_14K_BOOKS[underOf(pick.id)]?.name ?? pick.id.toUpperCase();
  const exp = expiryShort(pick.expiry);
  return `${name} ${pick.strike} ${pick.optionType}${exp ? ` · exp ${exp}` : ''}`;
}

export interface LivePaperBookState {
  id: string;
  desk?: string;
  under?: string;
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
  /** MIS / NRML rupees this scalp book is using. */
  capitalUsed?: number;
  /** Losing closes today; the book stands down at LIVE_PAPER_MAX_LOSSES. */
  lossesToday?: number;
  /** IST minute before which no new entry is taken (set after a losing close). */
  cooldownUntil?: number;
  /** IST minute the current trade's fill bar opened (drives the time exit). */
  entryMin?: number | null;
  /** IST minute of the last momentum signal bar (signals must be minGapBars apart). */
  lastSignalMin?: number;
  /** Momentum gauge on the latest completed bar: 30-min move vs the move needed (index points). */
  gauge?: { move: number; need: number; barMin: number; sessionBars: number } | null;
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
    desk: cfg.desk || deskOf(cfg.id),
    under: cfg.under || underOf(cfg.id),
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
    lot: cfg.qty || 0,
    optionToken: 0,
    neededCeRs: null,
    neededCe: '',
    neededPeRs: null,
    neededPe: '',
    neededLot: 0,
    neededAtAsk: false,
    lossesToday: 0,
    cooldownUntil: -1,
    entryMin: null,
    lastSignalMin: -1,
    capitalUsed: capitalUsedOf(cfg, { last: null, entry: null }),
  };
}

export function capitalUsedOf(
  cfg: LiveAssumeBookCfg,
  book: Pick<LivePaperBookState, 'last' | 'entry'>,
): number {
  if (cfg.capitalRs) return cfg.capitalRs;
  const px = book.last ?? book.entry ?? 0;
  const qty = cfg.qty || cfg.rsPt || 0;
  const pct = cfg.misPct ?? 0.2;
  if (!(px > 0) || !(qty > 0)) return 0;
  return Math.round(px * qty * pct);
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

/** Percent stop, optionally capped in rupees so an expensive ATM cannot risk ~₹8k. */
export function optionPctStopPts(cfg: LiveAssumeBookCfg, prem: number, lot: number): { sl: number; tp: number } {
  let sl = prem * (cfg.stopPct ?? 0);
  if (cfg.maxStopRs != null && lot > 0) sl = Math.min(sl, cfg.maxStopRs / lot);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { sl: r(sl), tp: r(prem * (cfg.targetPct ?? 0)) };
}

/** Fixed-rupee stop / target in premium points. */
export function optionRupeeStopPts(cfg: LiveAssumeBookCfg, lot: number): { sl: number; tp: number } {
  const r = (n: number) => Math.round(n * 100) / 100;
  return { sl: r((cfg.stopRs ?? 0) / lot), tp: r((cfg.targetRs ?? 0) / lot) };
}

export function optionBoundStops(
  cfg: LiveAssumeBookCfg,
  prem: number,
  lot: number,
  rangePts: number | null = null,
): { sl: number; tp: number } {
  if (cfg.stopRs != null && cfg.targetRs != null && lot > 0) return optionRupeeStopPts(cfg, lot);
  if (cfg.stopPct != null && cfg.targetPct != null) return optionPctStopPts(cfg, prem, lot);
  return optionStopPts(cfg, rangePts);
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
  const stop = optionBoundStops(cfg, prem, pick.lotSize, rangePts);
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
  const books = ALL_PAPER_BOOKS.map((cfg) => emptyBook(cfg));
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

export function hhmm(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
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
  const qty = book.lot || cfg.qty || cfg.rsPt;
  if (cfg.kind === 'eq') {
    const charges = equityMisRoundTripCharges(entry, Math.max(0, exit), qty);
    return Math.round((pts * qty - charges) * 10) / 10;
  }
  if (cfg.kind === 'fut') {
    const charges = futuresRoundTripCharges(entry, Math.max(0, exit), qty, venueForBook(cfg.under || cfg.id));
    return Math.round((pts * qty - charges) * 10) / 10;
  }
  if (!isOptionBuy(cfg)) return Math.round((pts * cfg.rsPt - LIVE_PAPER_CHARGE) * 10) / 10;
  const charges = optionRoundTripCharges(entry, Math.max(0, exit), qty, venueForBook(cfg.under || cfg.id));
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
  const qty = book.lot || cfg.qty || cfg.rsPt;
  const charges = cfg.kind === 'eq'
    ? equityMisRoundTripCharges(book.entry, Math.max(0, exitPx), qty)
    : cfg.kind === 'fut'
      ? futuresRoundTripCharges(book.entry, Math.max(0, exitPx), qty, venueForBook(cfg.under || cfg.id))
      : isOptionBuy(cfg)
        ? optionRoundTripCharges(book.entry, Math.max(0, exitPx), qty, venueForBook(cfg.under || cfg.id))
        : LIVE_PAPER_CHARGE;
  book.fills.push({
    day,
    book: book.id,
    label: book.label,
    desk: book.desk || deskOf(book.id),
    under: book.under || underOf(book.id),
    side: book.side,
    entry: book.entry,
    exit: exitPx,
    sl: book.sl || 0,
    tp: book.tp || 0,
    pts: Math.round(pts * 10) / 10,
    rs,
    charges: Math.round(charges * 10) / 10,
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
    holdMin: book.entryMin != null ? Math.max(0, (book.lastBarMin || 0) - book.entryMin) : undefined,
    gaugeMove: book.gauge?.move ?? null,
    gaugeNeed: book.gauge?.need ?? null,
    exitMin: book.lastBarMin,
    underEntry: book.last != null && book.optionSymbol ? null : book.last,
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
  book.entryMin = null;
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
  if (cfg.strategy === 'watch') return 'watch only: no tested edge';
  if (underOf(cfg.id) === 'crude' && LIVE_PAPER_CAPITAL < LIVE_ASSUME_CRUDE_MIN) return 'need ₹8,000 free for Crude';
  if (cfg.maxTradesPerDay != null || cfg.maxWinsPerDay != null) {
    const modes = new Set(Object.values(cfg.primary));
    const today = book.fills.filter((f) => modes.has(f.mode));
    if (cfg.maxWinsPerDay != null && today.filter((f) => f.rs > 0).length >= cfg.maxWinsPerDay) {
      return `banked ${cfg.maxWinsPerDay} wins today`;
    }
    if (cfg.maxTradesPerDay != null && today.length >= cfg.maxTradesPerDay) {
      return `max ${cfg.maxTradesPerDay} trade${cfg.maxTradesPerDay === 1 ? '' : 's'} today`;
    }
  }
  if (cfg.dayStops !== false) {
    if ((book.lossesToday || 0) >= LIVE_PAPER_MAX_LOSSES) return `day stop: ${LIVE_PAPER_MAX_LOSSES} losses`;
    if (book.cooldownUntil != null && atMin < book.cooldownUntil) return 'cooldown after loss';
  }
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
  if (cfg.kind === 'eq' || cfg.kind === 'fut') {
    const stop = entry * (cfg.stopPct || 0.0015);
    const tgt = entry * (cfg.targetPct || 0.0025);
    book.sl = Math.round((entry - d * stop) * 100) / 100;
    book.tp = Math.round((entry + d * tgt) * 100) / 100;
    book.scratch = book.sl;
    book.lot = cfg.qty || book.lot;
  } else if (isOptionBuy(cfg)) {
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
  book.entryMin = atMin + 5;
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
  if (cfg.strategy === 'momentum' && done.length) {
    const g = done[done.length - 1].day === day ? momentumGauge(done, done.length - 1) : null;
    next.gauge = g
      ? {
          move: Math.round(g.move * 10) / 10,
          need: Math.round(g.need * 10) / 10,
          barMin: done[done.length - 1].min,
          sessionBars: g.sessionBars,
        }
      : null;
  }
  if (nowMin >= cfg.orE) {
    const st = morningStructure(done, day, cfg.orS, cfg.orE, cfg.quietW);
    if (st !== 'stand' || next.structure === 'wait' || !next.structure) next.structure = st;
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
    if (
      (next.side === 'long' || next.side === 'short') &&
      cfg.holdBars != null &&
      next.entryMin != null &&
      nowMin >= next.entryMin + cfg.holdBars * 5 &&
      last != null
    ) {
      closeAt(next, cfg, last, 'time', day);
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
      if (cfg.skipStructures?.includes(st)) {
        next.reason = `skipped: ${st} morning`;
        continue;
      }
      const blocked = canOpen(next, cfg, bar.min);
      if (blocked) {
        next.reason = blocked;
        continue;
      }
      const mix = mixGate(done, i, cfg, hit, st);
      if (!mix.ok) {
        next.reason = mix.reason;
        continue;
      }
      if (cfg.minGapBars != null) {
        if (next.lastSignalMin != null && next.lastSignalMin >= 0 && bar.min - next.lastSignalMin <= cfg.minGapBars * 5) continue;
        next.lastSignalMin = bar.min;
      }
      if (cfg.noConfirm) {
        if (nowMin - (bar.min + 5) > LIVE_PAPER_MAX_SIGNAL_AGE_MIN) {
          next.reason = `missed ${hit.dir === 1 ? 'up' : 'down'} signal at ${hhmm(bar.min + 5)} (desk was not checking)`;
          continue;
        }
        next.mode = hit.mode;
        openAt(next, cfg, hit.dir, bar.close, hit.mode, bar.min);
        if (next.side !== 'flat') break;
        continue;
      }
      next.pendingDir = hit.dir;
      next.pendingSig = bar.close;
      next.pendingMode = hit.mode;
      next.mode = hit.mode;
      next.status = 'pending';
      next.reason = `confirm ${hit.mode}`;
    }
  }

  markLive(next, last, cfg);
  next.capitalUsed = capitalUsedOf(cfg, next);
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
      `Motto: buy CE/PE. SL, target, and live P/L come from the option. ` +
      `Scalp is watch-only. ${fundsLine}${PAPER_TEST_HONEST}`,
  };
}

export function allClosedFills(books: LivePaperBookState[]): LivePaperFill[] {
  return books.flatMap((b) => b.fills);
}

export function booksFundEnd(books: LivePaperBookState[]): number {
  return Math.round(books.reduce((s, b) => s + b.fund, 0) * 10) / 10;
}

/** One night-research dump: every closed fill plus desk totals. Copy from Closed today. */
export function nightLog(session: LivePaperSession) {
  const fills = allClosedFills(session.books);
  const desks = [...PAPER_DESKS, PAPER_SCALP].map((d) => {
    const books = session.books.filter((b) => (b.desk || deskOf(b.id)) === d.id);
    const rows = fills.filter((f) => (f.desk || deskOf(f.book)) === d.id);
    const wins = rows.filter((f) => f.rs > 0);
    const losses = rows.filter((f) => f.rs < 0);
    const closedRs = Math.round(books.reduce((s, b) => s + b.closedRs, 0) * 10) / 10;
    return {
      desk: d.id,
      label: d.label,
      rule: d.rule,
      trades: rows.length,
      wins: wins.length,
      losses: losses.length,
      closedRs,
      liveRs: Math.round(books.reduce((s, b) => s + (b.side === 'flat' ? 0 : b.liveRs), 0) * 10) / 10,
      avgRs: rows.length ? Math.round((rows.reduce((s, f) => s + f.rs, 0) / rows.length) * 10) / 10 : 0,
      maxLoss: rows.length ? Math.min(...rows.map((f) => f.rs)) : 0,
      maxWin: rows.length ? Math.max(...rows.map((f) => f.rs)) : 0,
    };
  });
  return {
    day: session.day,
    asOf: session.asOf,
    closedRs: session.closedRs,
    liveRs: session.liveRs,
    desks,
    fills: fills.map((f) => ({
      desk: f.desk || deskOf(f.book),
      under: f.under || underOf(f.book),
      book: f.book,
      label: f.label,
      contract: optionPickLabel({ id: f.book, optionType: f.optionType, strike: f.strike, expiry: f.expiry, optionSymbol: f.optionSymbol }),
      optionSymbol: f.optionSymbol || '',
      optionType: f.optionType || '',
      strike: f.strike ?? null,
      expiry: f.expiry || '',
      lot: f.lot || 0,
      side: f.side,
      mode: f.mode,
      structure: f.structure || '',
      entry: f.entry,
      exit: f.exit,
      sl: f.sl,
      tp: f.tp,
      pts: f.pts,
      rs: f.rs,
      charges: f.charges ?? null,
      reason: f.reason,
      entryAt: f.entryAt || '',
      exitAt: f.exitAt || '',
      holdMin: f.holdMin ?? null,
      gaugeMove: f.gaugeMove ?? null,
      gaugeNeed: f.gaugeNeed ?? null,
      entryBid: f.entryBid ?? null,
      entryAsk: f.entryAsk ?? null,
      exitBid: f.exitBid ?? null,
      exitAsk: f.exitAsk ?? null,
    })),
  };
}

export function nightLogJson(session: LivePaperSession): string {
  return JSON.stringify(nightLog(session), null, 2);
}

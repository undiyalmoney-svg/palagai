import { ChargeVenue } from '../paper-desk/option-charges.util';
import { sniperCharges, sniperGrossRs, sniperNetRs } from './sniper-charges';
import {
  barAt,
  completedSniperBars,
  hhmm,
  sniperIntervalStart,
  sniperIstDay,
  sniperPrevCandleMin,
} from './sniper-clock';
import {
  SNIPER_BAR_MIN,
  SNIPER_BOOKS,
  SNIPER_CAPITAL_RS,
  SNIPER_DAY_FLOOR_RS,
  SNIPER_ENTRY_GRACE_MIN,
  SNIPER_HONEST,
  SNIPER_MAX_LOSS_RS,
  SniperBar,
  SniperBookCfg,
  SniperBookState,
  SniperDir,
  SniperExit,
  SniperFill,
  SniperPick,
  SniperQuote,
  SniperSession,
  SniperUnder,
} from './sniper.models';
import { sniperSize } from './sniper-size';

export function candleDir(bar: SniperBar): SniperDir {
  if (bar.close > bar.open) return 'green';
  if (bar.close < bar.open) return 'red';
  return 'doji';
}

export function emptySniperBook(cfg: SniperBookCfg, capital = SNIPER_CAPITAL_RS): SniperBookState {
  return {
    id: cfg.id,
    label: cfg.label,
    capital,
    peakCapital: capital,
    troughCapital: capital,
    side: 'flat',
    dir: '',
    optionType: '',
    strike: null,
    expiry: '',
    optionSymbol: '',
    optionToken: 0,
    lotSize: 0,
    lots: 0,
    qty: 0,
    entry: null,
    sl: null,
    entryMin: null,
    entryAt: '',
    intervalEnd: null,
    underOpen: null,
    underClose: null,
    entryBid: null,
    entryAsk: null,
    last: null,
    liveRs: 0,
    status: 'watching',
    reason: '',
    fills: [],
    skips: [],
    kiteBuyOrderId: '',
    kiteSlOrderId: '',
    kiteNote: '',
    kiteHalt: false,
    exception: false,
  };
}

export function emptySniperSession(day: string, asOf = new Date().toISOString()): SniperSession {
  return {
    day,
    running: false,
    mode: 'paper',
    liveArmed: false,
    replayDay: '',
    startedAt: '',
    asOf,
    source: 'idle',
    kiteError: null,
    honest: SNIPER_HONEST,
    books: SNIPER_BOOKS.map((cfg) => emptySniperBook(cfg)),
    incomplete: false,
  };
}

function rupee(n: number): number {
  return Math.round(n * 10) / 10;
}

function markBook(book: SniperBookState, px: number | null, venue: ChargeVenue): void {
  if (book.side !== 'long' || book.entry == null || !(book.qty > 0) || px == null) {
    book.liveRs = 0;
    book.last = px;
    return;
  }
  book.last = px;
  book.liveRs = rupee(sniperNetRs(book.entry, px, book.qty, venue));
}

function skip(book: SniperBookState, min: number, at: string, reason: string): SniperBookState {
  return {
    ...book,
    status: 'watching',
    reason,
    skips: [...book.skips, { at, min, reason }].slice(-400),
  };
}

function closeFill(
  book: SniperBookState,
  cfg: SniperBookCfg,
  exit: number,
  exitMin: number,
  at: string,
  day: string,
  reason: SniperExit,
  bid: number | null,
  ask: number | null,
  incomplete = false,
): SniperBookState {
  if (book.side !== 'long' || book.entry == null || !(book.qty > 0)) return { ...book, side: 'flat', exception: false };
  const charges = sniperCharges(book.entry, exit, book.qty, cfg.venue);
  const grossRs = rupee(sniperGrossRs(book.entry, exit, book.qty));
  const netRs = rupee(grossRs - charges.total);
  const capital = rupee(book.capital + netRs);
  const fill: SniperFill = {
    n: book.fills.length + 1,
    under: book.id,
    label: book.label,
    day,
    entryAt: book.entryAt || at,
    exitAt: at,
    entryMin: book.entryMin || exitMin,
    exitMin,
    underOpen: book.underOpen || 0,
    underClose: book.underClose || 0,
    dir: book.dir || 'doji',
    optionType: book.optionType === 'PE' ? 'PE' : 'CE',
    strike: book.strike || 0,
    expiry: book.expiry,
    optionSymbol: book.optionSymbol,
    entry: book.entry,
    exit,
    qty: book.qty,
    lots: book.lots,
    grossRs,
    charges,
    netRs,
    capitalAfter: capital,
    reason,
    entryBid: book.entryBid,
    entryAsk: book.entryAsk,
    exitBid: bid,
    exitAsk: ask,
    incomplete,
  };
  return {
    ...book,
    side: 'flat',
    dir: '',
    optionType: '',
    strike: null,
    expiry: '',
    optionSymbol: '',
    optionToken: 0,
    lotSize: 0,
    lots: 0,
    qty: 0,
    entry: null,
    sl: null,
    entryMin: null,
    entryAt: '',
    intervalEnd: null,
    underOpen: null,
    underClose: null,
    entryBid: null,
    entryAsk: null,
    last: exit,
    liveRs: 0,
    status: 'watching',
    reason,
    capital,
    peakCapital: Math.max(book.peakCapital, capital),
    troughCapital: Math.min(book.troughCapital, capital),
    fills: [...book.fills, fill],
    kiteHalt: false,
    exception: reason === 'exception',
  };
}

export function tickSniperBook(
  book: SniperBookState,
  cfg: SniperBookCfg,
  bars: SniperBar[],
  day: string,
  nowMin: number,
  nowIso: string,
  spot: number | null,
  opt: SniperQuote,
  pick: SniperPick | null,
): SniperBookState {
  const next: SniperBookState = { ...book, fills: [...book.fills], skips: [...book.skips] };
  const done = completedSniperBars(bars, day, nowMin);
  const bid = opt.bid;
  const ask = opt.ask;
  const last = opt.last;
  const mark = bid ?? last;

  if (next.side === 'long' && next.entry != null) {
    markBook(next, mark, cfg.venue);
    const end = next.intervalEnd ?? (next.entryMin || 0) + SNIPER_BAR_MIN;
    if (mark == null) {
      if (nowMin >= end || nowMin >= cfg.flatMin) {
        next.exception = true;
        next.reason = 'execution exception: no exit quote';
        next.status = 'exception';
      }
      return next;
    }
    const net = sniperNetRs(next.entry, mark, next.qty, cfg.venue);
    if (net <= -SNIPER_MAX_LOSS_RS || (next.sl != null && mark <= next.sl)) {
      return closeFill(next, cfg, mark, nowMin, nowIso, day, 'sl', bid, ask);
    }
    if (nowMin >= cfg.flatMin) {
      return closeFill(next, cfg, mark, nowMin, nowIso, day, 'eod', bid, ask);
    }
    if (nowMin >= end) {
      return closeFill(next, cfg, mark, nowMin, nowIso, day, 'time', bid, ask);
    }
    next.reason = `holding · ${hhmm(end)} exit · SL ₹${next.sl}`;
    next.status = 'open';
    return next;
  }

  if (nowMin >= cfg.flatMin) {
    next.reason = 'session closed';
    next.status = 'watching';
    return next;
  }
  if (nowMin < cfg.openMin + SNIPER_BAR_MIN) {
    next.reason = `waiting first candle (${hhmm(cfg.openMin)}–${hhmm(cfg.openMin + SNIPER_BAR_MIN)})`;
    return next;
  }
  if (nowMin > cfg.lastEntryMin + SNIPER_ENTRY_GRACE_MIN) {
    next.reason = 'last entry passed';
    return next;
  }

  const slot = sniperIntervalStart(cfg, nowMin);
  if (slot < cfg.openMin + SNIPER_BAR_MIN || slot > cfg.lastEntryMin) {
    next.reason = 'outside entry window';
    return next;
  }
  if (nowMin - slot > SNIPER_ENTRY_GRACE_MIN) {
    return skip(next, slot, nowIso, `missed ${hhmm(slot)} open (desk was not checking)`);
  }
  if (next.fills.some((f) => f.entryMin === slot) || next.skips.some((s) => s.min === slot)) {
    next.reason = next.reason || 'slot already used';
    return next;
  }
  if (next.capital < SNIPER_DAY_FLOOR_RS) {
    return skip(next, slot, nowIso, `day floor ₹${SNIPER_DAY_FLOOR_RS}`);
  }

  const prevMin = sniperPrevCandleMin(cfg, nowMin);
  const candle = barAt(done, day, prevMin);
  if (!candle) {
    return skip(next, slot, nowIso, `skipped: no completed candle at ${hhmm(prevMin)}`);
  }
  const dir = candleDir(candle);
  if (dir === 'doji') {
    return skip(next, slot, nowIso, `skipped: doji at ${hhmm(prevMin)}`);
  }
  if (spot == null || !(spot > 0)) {
    return skip(next, slot, nowIso, 'skipped: no spot');
  }
  if (!pick || !pick.listed || !pick.optionSymbol) {
    return skip(next, slot, nowIso, 'skipped: no listed ATM');
  }
  const fillPx = ask ?? last;
  if (fillPx == null || !(fillPx > 0)) {
    return skip(next, slot, nowIso, 'skipped: no option quote');
  }
  const size = sniperSize(next.capital, fillPx, pick.lotSize, cfg.venue);
  if (!size.lots) {
    return skip(next, slot, nowIso, `skipped: ${size.skip}`);
  }
  next.side = 'long';
  next.dir = dir;
  next.optionType = pick.optionType;
  next.strike = pick.strike;
  next.expiry = pick.expiry;
  next.optionSymbol = pick.optionSymbol;
  next.optionToken = pick.optionToken;
  next.lotSize = pick.lotSize;
  next.lots = size.lots;
  next.qty = size.qty;
  next.entry = fillPx;
  next.sl = size.sl;
  next.entryMin = slot;
  next.entryAt = nowIso;
  next.intervalEnd = slot + SNIPER_BAR_MIN;
  next.underOpen = candle.open;
  next.underClose = candle.close;
  next.entryBid = bid;
  next.entryAsk = ask;
  next.last = fillPx;
  next.status = 'open';
  next.reason = `${dir} ${pick.optionType} ${pick.strike} · hold to ${hhmm(slot + SNIPER_BAR_MIN)}`;
  next.exception = false;
  markBook(next, fillPx, cfg.venue);
  return next;
}

export function flattenSniperBook(
  book: SniperBookState,
  cfg: SniperBookCfg,
  nowMin: number,
  nowIso: string,
  px: number | null,
): SniperBookState {
  if (book.side !== 'long' || book.entry == null) return book;
  if (px == null) {
    return { ...book, exception: true, status: 'exception', reason: 'execution exception: no exit quote' };
  }
  return closeFill(book, cfg, px, nowMin, nowIso, sniperIstDay(new Date(nowIso)), nowMin >= cfg.flatMin ? 'eod' : 'time', px, null);
}

export function summarizeSniper(session: SniperSession, patch: Partial<SniperSession> = {}): SniperSession {
  const books = session.books.map((b) => ({
    ...b,
    peakCapital: Math.max(b.peakCapital, b.capital),
    troughCapital: Math.min(b.troughCapital, b.capital),
  }));
  return {
    ...session,
    ...patch,
    books,
    honest: SNIPER_HONEST,
    incomplete: books.some((b) => b.fills.some((f) => f.incomplete) || /no completed candle|no listed ATM|no option quote/.test(b.reason)),
  };
}

export function allSniperFills(session: SniperSession): SniperFill[] {
  return session.books.flatMap((b) => b.fills.map((f) => ({ ...f, day: f.day || session.day })));
}

export function sniperBookCfg(id: SniperUnder): SniperBookCfg {
  return SNIPER_BOOKS.find((b) => b.id === id) || SNIPER_BOOKS[0];
}

export { sniperIstDay };

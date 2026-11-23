import { ChargeVenue } from '../paper-desk/option-charges.util';
import { sniperCharges, sniperGrossRs, sniperNetRs } from './sniper-charges';
import { completedSniperBars, hhmm, sniperIstDay, sniperOrBars, sniperOrbReady } from './sniper-clock';
import {
  SNIPER_BAR_MIN,
  SNIPER_BOOKS,
  SNIPER_DEFAULT_LOTS,
  SNIPER_HONEST,
  SNIPER_OPEN_MIN,
  SNIPER_OR_END_MIN,
  SNIPER_STOP_RS,
  SNIPER_STRONG_RED,
  SNIPER_TARGET_RS,
  SniperBar,
  SniperBookCfg,
  SniperBookState,
  SniperBreak,
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

export function sniperStrongRed(bar: SniperBar): boolean {
  if (candleDir(bar) !== 'red') return false;
  const range = bar.high - bar.low;
  if (!(range > 0)) return false;
  return (bar.open - bar.close) / range >= SNIPER_STRONG_RED;
}

export function sniperOrbLevels(bars: SniperBar[], day: string): { high: number; low: number } | null {
  const orBars = sniperOrBars(bars, day);
  if (!orBars.length) return null;
  return {
    high: Math.max(...orBars.map((b) => b.high)),
    low: Math.min(...orBars.map((b) => b.low)),
  };
}

/** Completed 5m after 09:30 whose close is through the OR. Wick-only does not count. */
export function sniperClearCut(
  bar: SniperBar,
  or: { high: number; low: number } | null,
): SniperBreak {
  if (!or || bar.min < SNIPER_OR_END_MIN) return '';
  if (bar.close > or.high) return 'up';
  if (bar.close < or.low) return 'down';
  return '';
}

export function sniperHighGreen(bars: SniperBar[], redMin: number): SniperBar | null {
  const greens = bars.filter((b) => b.min <= redMin && candleDir(b) === 'green');
  if (!greens.length) return null;
  return greens.reduce((a, b) => (b.high >= a.high ? b : a));
}

export function emptySniperBook(cfg: SniperBookCfg): SniperBookState {
  return {
    id: cfg.id,
    label: cfg.label,
    watch: true,
    orHigh: null,
    orLow: null,
    orReady: false,
    cut: '',
    cutMin: null,
    cutColor: '',
    event: 'watching',
    bars: [],
    capital: 0,
    peakCapital: 0,
    troughCapital: 0,
    side: 'flat',
    dir: '',
    breakDir: '',
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
    tp: null,
    stopRs: null,
    indexSl: null,
    redHigh: null,
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

export function emptySniperSession(
  day: string,
  asOf = new Date().toISOString(),
  keep?: Partial<Pick<SniperSession, 'lots' | 'stopRs' | 'targetRs' | 'paperOn' | 'liveArmed' | 'mode' | 'books'>>,
): SniperSession {
  const books = SNIPER_BOOKS.map((cfg) => {
    const b = emptySniperBook(cfg);
    const prev = keep?.books?.find((x) => x.id === cfg.id);
    if (prev) b.watch = prev.watch !== false;
    return b;
  });
  return {
    day,
    running: false,
    mode: keep?.mode === 'live' ? 'live' : 'paper',
    paperOn: keep?.paperOn !== false,
    liveArmed: keep?.liveArmed === true,
    lots: Math.max(1, Math.floor(Number(keep?.lots) || SNIPER_DEFAULT_LOTS)),
    stopRs: Number(keep?.stopRs) > 0 ? Number(keep?.stopRs) : SNIPER_STOP_RS,
    targetRs: Number(keep?.targetRs) > 0 ? Number(keep?.targetRs) : SNIPER_TARGET_RS,
    selected: '',
    replayDay: '',
    startedAt: '',
    asOf,
    source: 'idle',
    kiteError: null,
    honest: SNIPER_HONEST,
    books,
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
    dir: book.dir || 'red',
    breakDir: book.breakDir || '',
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
    qty: 0,
    last: exit,
    liveRs: 0,
    status: 'done',
    event: 'trade_closed',
    reason,
    capital,
    peakCapital: Math.max(book.peakCapital, capital),
    troughCapital: Math.min(book.troughCapital, capital),
    fills: [...book.fills, fill],
    kiteHalt: false,
    exception: reason === 'exception',
  };
}

function nearbyBars(bars: SniperBar[]): SniperBar[] {
  return bars.filter((b) => b.min >= SNIPER_OPEN_MIN).slice(-12);
}

function paintOrb(book: SniperBookState, bars: SniperBar[], day: string, nowMin: number): SniperBookState {
  const next = { ...book, bars: nearbyBars(bars) };
  const or = sniperOrbLevels(bars, day);
  next.orReady = sniperOrbReady(nowMin) && !!or;
  next.orHigh = or?.high ?? null;
  next.orLow = or?.low ?? null;
  if (!next.watch) {
    next.event = 'off';
    next.status = 'off';
    next.reason = 'off';
    return next;
  }
  if (next.cut || next.side === 'long' || next.fills.length > 0 || next.event === 'parked') {
    return next;
  }
  next.event = 'watching';
  next.status = 'watching';
  next.reason =
    nowMin < SNIPER_OPEN_MIN || !next.orReady
      ? `ORB ${hhmm(SNIPER_OPEN_MIN)}–${hhmm(SNIPER_OR_END_MIN)}`
      : `ORB ${next.orLow}–${next.orHigh}`;
  return next;
}

function firstCut(
  books: SniperBookState[],
  barsBy: Record<SniperUnder, SniperBar[]>,
  day: string,
): { id: SniperUnder; dir: SniperBreak; min: number; color: SniperDir } | null {
  let best: { id: SniperUnder; dir: SniperBreak; min: number; dist: number; color: SniperDir } | null = null;
  for (const book of books) {
    if (!book.watch || !book.orReady || book.orHigh == null || book.orLow == null) continue;
    const or = { high: book.orHigh, low: book.orLow };
    for (const bar of barsBy[book.id] || []) {
      const dir = sniperClearCut(bar, or);
      if (!dir) continue;
      const dist = dir === 'up' ? bar.close - or.high : or.low - bar.close;
      if (!best || bar.min < best.min || (bar.min === best.min && dist > best.dist)) {
        best = { id: book.id, dir, min: bar.min, dist, color: candleDir(bar) };
      }
      break;
    }
  }
  return best ? { id: best.id, dir: best.dir, min: best.min, color: best.color } : null;
}

function parkBook(book: SniperBookState, winner: string): SniperBookState {
  if (book.side === 'long' || book.fills.length) return book;
  return {
    ...book,
    event: 'parked',
    status: 'parked',
    reason: `idle · ${winner} first`,
  };
}

function manageOpen(
  book: SniperBookState,
  cfg: SniperBookCfg,
  day: string,
  nowMin: number,
  nowIso: string,
  opt: SniperQuote,
  stopRs: number,
  targetRs: number,
): SniperBookState {
  const next = { ...book, fills: [...book.fills], skips: [...book.skips] };
  const bid = opt.bid;
  const mark = bid ?? opt.last;
  markBook(next, mark, cfg.venue);
  if (mark == null) {
    if (nowMin >= cfg.flatMin) {
      next.exception = true;
      next.reason = 'no exit quote';
      next.status = 'exception';
    }
    return next;
  }
  const net = sniperNetRs(next.entry!, mark, next.qty, cfg.venue);
  if (net >= targetRs || (next.tp != null && mark >= next.tp)) {
    return closeFill(next, cfg, mark, nowMin, nowIso, day, 'tp', bid, opt.ask);
  }
  if (net <= -stopRs || (next.sl != null && mark <= next.sl)) {
    return closeFill(next, cfg, next.sl != null ? next.sl : mark, nowMin, nowIso, day, 'sl', bid, opt.ask);
  }
  if (nowMin >= cfg.flatMin) {
    return closeFill(next, cfg, mark, nowMin, nowIso, day, 'eod', bid, opt.ask);
  }
  next.reason = `open ${next.optionType} · SL ₹${next.sl}`;
  next.status = 'open';
  next.event = 'trade_taken';
  return next;
}

export function tickSniperDesk(
  session: SniperSession,
  barsBy: Record<SniperUnder, SniperBar[]>,
  spots: Partial<Record<SniperUnder, number | null>>,
  feed: Partial<Record<SniperUnder, { opt: SniperQuote; pick: SniperPick | null }>>,
  day: string,
  nowMin: number,
  nowIso: string,
): SniperSession {
  const lots = Math.max(1, Math.floor(Number(session.lots) || SNIPER_DEFAULT_LOTS));
  const stopRs = Number(session.stopRs) > 0 ? Number(session.stopRs) : SNIPER_STOP_RS;
  const targetRs = Number(session.targetRs) > 0 ? Number(session.targetRs) : SNIPER_TARGET_RS;
  const allowEntry = session.paperOn !== false || session.liveArmed === true;
  const done: Record<SniperUnder, SniperBar[]> = {
    nifty: completedSniperBars(barsBy.nifty || [], day, nowMin),
    bank: completedSniperBars(barsBy.bank || [], day, nowMin),
    sensex: completedSniperBars(barsBy.sensex || [], day, nowMin),
  };

  let books = session.books.map((b) =>
    paintOrb({ ...b, fills: [...b.fills], skips: [...b.skips] }, done[b.id], day, nowMin),
  );

  const taken = books.some((b) => b.side === 'long' || b.fills.length > 0);
  let selected = session.selected;
  if (!selected && !taken) {
    const cut = firstCut(books, done, day);
    if (cut) {
      selected = cut.id;
      books = books.map((b) =>
        b.id === cut.id
          ? {
              ...b,
              cut: cut.dir,
              cutMin: cut.min,
              cutColor: cut.color,
              breakDir: cut.dir,
              event: 'orb_break',
              status: 'cut',
              reason: `ORB break ${cut.dir} ${hhmm(cut.min)}`,
            }
          : b,
      );
    }
  } else if (selected) {
    books = books.map((b) => (b.id === selected && !b.cut ? { ...b, cut: b.breakDir || b.cut, status: b.status } : b));
  }
  const winner = books.find((b) => b.id === selected)?.label || selected;

  books = books.map((book) => {
    const cfg = SNIPER_BOOKS.find((c) => c.id === book.id) || SNIPER_BOOKS[0];
    const opt = feed[book.id]?.opt || { bid: null, ask: null, last: null };
    const pick = feed[book.id]?.pick || null;
    const spot = spots[book.id] ?? null;
    const bars = done[book.id];

    if (book.side === 'long' && book.entry != null) {
      return manageOpen(book, cfg, day, nowMin, nowIso, opt, stopRs, targetRs);
    }

    if (book.fills.length) {
      return { ...book, event: 'trade_closed', status: 'done', reason: book.reason || 'done' };
    }

    if (selected && book.id !== selected) {
      return parkBook(book, winner);
    }

    if (book.id !== selected) return book;

    if (nowMin >= cfg.flatMin) return { ...book, event: book.event || 'orb_break', reason: 'session closed' };
    if (nowMin > cfg.lastEntryMin) return { ...book, event: book.event || 'orb_break', reason: 'last entry passed' };
    if (!allowEntry) return { ...book, event: book.event || 'orb_break', reason: book.reason || 'paper off' };

    const breakDir: SniperBreak = book.cut || book.breakDir;
    if (!breakDir || book.cutMin == null) {
      return { ...book, event: 'orb_break', reason: 'ORB break' };
    }

    const after = bars.filter((b) => b.min >= book.cutMin!);
    const red = after.find((b) => sniperStrongRed(b)) || null;
    if (!red) {
      return { ...book, breakDir, event: 'orb_break', reason: `ORB break ${breakDir} · wait red` };
    }
    const green = sniperHighGreen(bars, red.min);
    const indexSl = green ? green.low : red.low;
    const triggered = (spot != null && spot >= red.high) || after.some((b) => b.min > red.min && b.high >= red.high);
    if (!triggered) {
      return {
        ...book,
        breakDir,
        redHigh: red.high,
        indexSl,
        event: 'breakout_candle',
        reason: `breakout ${hhmm(red.min)} · wait ${red.high}`,
      };
    }
    if (spot == null || !(spot > 0)) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'found_entry', reason: 'waiting spot' };
    }
    const want: 'CE' | 'PE' = breakDir === 'up' ? 'CE' : 'PE';
    if (!pick || !pick.listed || !pick.optionSymbol) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'found_entry', reason: 'waiting ATM' };
    }
    if (pick.optionType !== want) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'found_entry', reason: `waiting ${want}` };
    }
    const fillPx = opt.ask ?? opt.last;
    if (fillPx == null || !(fillPx > 0)) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'found_entry', reason: 'waiting quote' };
    }
    const size = sniperSize(lots, pick.lotSize, fillPx, cfg.venue, stopRs, targetRs);
    if (!size.lots) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'found_entry', reason: size.skip || 'lots' };
    }
    const next: SniperBookState = {
      ...book,
      side: 'long',
      dir: 'red',
      breakDir,
      optionType: pick.optionType,
      strike: pick.strike,
      expiry: pick.expiry,
      optionSymbol: pick.optionSymbol,
      optionToken: pick.optionToken,
      lotSize: pick.lotSize,
      lots: size.lots,
      qty: size.qty,
      entry: fillPx,
      sl: size.sl,
      tp: size.tp,
      indexSl,
      redHigh: red.high,
      entryMin: nowMin,
      entryAt: nowIso,
      intervalEnd: cfg.flatMin,
      underOpen: red.open,
      underClose: red.close,
      entryBid: opt.bid,
      entryAsk: opt.ask,
      last: fillPx,
      status: 'open',
      event: 'trade_taken',
      reason: `open ${pick.optionType} · SL ₹${size.sl}`,
      exception: false,
    };
    markBook(next, fillPx, cfg.venue);
    return next;
  });

  return summarizeSniper(session, {
    day,
    lots,
    stopRs,
    targetRs,
    selected: selected || '',
    books,
    asOf: nowIso,
  });
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
    return { ...book, exception: true, status: 'exception', reason: 'no exit quote' };
  }
  return closeFill(book, cfg, px, nowMin, nowIso, sniperIstDay(new Date(nowIso)), nowMin >= cfg.flatMin ? 'eod' : 'sl', px, null);
}

export function summarizeSniper(session: SniperSession, patch: Partial<SniperSession> = {}): SniperSession {
  const src = patch.books ?? session.books;
  const books = src.map((b) => ({
    ...b,
    peakCapital: Math.max(b.peakCapital, b.capital),
    troughCapital: Math.min(b.troughCapital, b.capital),
  }));
  return {
    ...session,
    ...patch,
    books,
    honest: SNIPER_HONEST,
    incomplete: books.some(
      (b) =>
        b.fills.some((f) => f.incomplete) ||
        /waiting ATM|waiting quote|waiting spot/.test(b.reason),
    ),
  };
}

export function allSniperFills(session: SniperSession): SniperFill[] {
  return session.books.flatMap((b) => b.fills.map((f) => ({ ...f, day: f.day || session.day })));
}

export function sniperBookCfg(id: SniperUnder): SniperBookCfg {
  return SNIPER_BOOKS.find((b) => b.id === id) || SNIPER_BOOKS[0];
}

export function sniperWantType(dir: SniperBreak): 'CE' | 'PE' | null {
  if (dir === 'up') return 'CE';
  if (dir === 'down') return 'PE';
  return null;
}

export { sniperIstDay };

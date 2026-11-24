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
  SNIPER_PULSE_KEEP,
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
  SniperPulse,
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
    spot: null,
    minute: null,
    minutes: [],
    forming5m: null,
    peBid: null,
    peAsk: null,
    peLast: null,
    pulse: [],
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
    if (prev) {
      b.pulse = Array.isArray(prev.pulse) ? prev.pulse.slice(-SNIPER_PULSE_KEEP) : [];
    }
    return b;
  });
  return {
    day,
    running: false,
    mode: keep?.mode === 'live' ? 'live' : 'paper',
    paperOn: keep?.paperOn !== false,
    liveArmed: keep?.liveArmed === true,
    lots: Math.max(1, Math.floor(Number(keep?.lots) || SNIPER_DEFAULT_LOTS)),
    stopRs: SNIPER_STOP_RS,
    targetRs: SNIPER_TARGET_RS,
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
  return bars.filter((b) => b.min >= SNIPER_OPEN_MIN).slice(-24);
}

function completedMinutes(bars: SniperBar[], day: string, nowMin: number): SniperBar[] {
  return (bars || []).filter((b) => b.day < day || (b.day === day && b.min + 1 <= nowMin));
}

export function formingMinuteBar(
  bars: SniperBar[],
  day: string,
  nowMin: number,
  spot: number | null,
): SniperBar | null {
  const exact = (bars || []).find((b) => b.day === day && b.min === nowMin);
  if (exact) return exact;
  const done = completedMinutes(bars, day, nowMin);
  const last = done.length ? done[done.length - 1] : null;
  if (spot == null && !last) return null;
  const open = last ? last.close : spot!;
  const px = spot != null ? spot : last!.close;
  return {
    day,
    min: nowMin,
    open,
    high: Math.max(open, px),
    low: Math.min(open, px),
    close: px,
  };
}

export function formingFiveBar(minutes: SniperBar[], day: string, nowMin: number): SniperBar | null {
  const start = nowMin - (nowMin % SNIPER_BAR_MIN);
  const slice = (minutes || []).filter((b) => b.day === day && b.min >= start && b.min <= nowMin);
  if (!slice.length) return null;
  return {
    day,
    min: start,
    open: slice[0].open,
    high: Math.max(...slice.map((b) => b.high)),
    low: Math.min(...slice.map((b) => b.low)),
    close: slice[slice.length - 1].close,
  };
}

export function sniperPulseLine(book: SniperBookState, nowMin: number): string {
  const t = hhmm(nowMin);
  const spot = book.spot != null ? `Bank ${book.spot}` : 'Bank —';
  const pe =
    book.optionSymbol
      ? ` · ${book.optionSymbol}${book.peAsk != null ? ` ask ${book.peAsk}` : book.peLast != null ? ` last ${book.peLast}` : ''}`
      : '';
  if (book.side === 'long') {
    const live = book.liveRs ? ` · live ₹${book.liveRs}` : '';
    return `${t} ${spot}${pe}${live} · SL ₹${book.sl ?? SNIPER_STOP_RS} sell ₹${book.tp ?? SNIPER_TARGET_RS}`;
  }
  if (book.fills.length) {
    const last = book.fills[book.fills.length - 1];
    return `${t} ${spot} · closed ${last.reason} ₹${last.netRs}${pe}`;
  }
  if (book.cut === 'up') {
    return `${t} ${spot} · up ORB · skip CE · no trade today`;
  }
  return `${t} ${spot}${pe} · ${book.reason || 'watching'}`;
}

function appendPulse(book: SniperBookState, nowMin: number, nowIso: string): SniperPulse[] {
  const text = sniperPulseLine(book, nowMin);
  const row: SniperPulse = { min: nowMin, at: nowIso, spot: book.spot, peLast: book.peLast, text };
  const prev = Array.isArray(book.pulse) ? book.pulse.filter((p) => p.min !== nowMin) : [];
  return [...prev, row].slice(-SNIPER_PULSE_KEEP);
}

function paintOrb(book: SniperBookState, bars: SniperBar[], day: string, nowMin: number): SniperBookState {
  const next = { ...book, bars: nearbyBars(bars), watch: true };
  const or = sniperOrbLevels(bars, day);
  next.orReady = sniperOrbReady(nowMin) && !!or;
  next.orHigh = or?.high ?? null;
  next.orLow = or?.low ?? null;
  if (next.cut || next.side === 'long' || next.fills.length > 0 || next.event === 'parked') {
    return next;
  }
  next.event = 'watching';
  next.status = 'watching';
  next.reason =
    nowMin < SNIPER_OPEN_MIN || !next.orReady
      ? `ORB ${hhmm(SNIPER_OPEN_MIN)}–${hhmm(SNIPER_OR_END_MIN)}`
      : `ORB ${next.orLow}–${next.orHigh} · wait first close below`;
  return next;
}

function firstCut(
  books: SniperBookState[],
  barsBy: Partial<Record<SniperUnder, SniperBar[]>>,
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
  next.reason = `open PE · SL ₹${next.sl} · sell ₹${next.tp}`;
  next.status = 'open';
  next.event = 'trade_taken';
  return next;
}

function stampLive(
  book: SniperBookState,
  spots: Partial<Record<SniperUnder, number | null>>,
  feed: Partial<Record<SniperUnder, { opt: SniperQuote; pick: SniperPick | null }>>,
  minutesBy: Partial<Record<SniperUnder, SniperBar[]>>,
  day: string,
  nowMin: number,
  nowIso: string,
): SniperBookState {
  const opt = feed[book.id]?.opt || { bid: null, ask: null, last: null };
  const pick = feed[book.id]?.pick || null;
  const spot = spots[book.id] ?? book.spot ?? null;
  const rawMins = minutesBy[book.id] || [];
  const minute = formingMinuteBar(rawMins, day, nowMin, spot);
  const doneMins = completedMinutes(rawMins, day, nowMin);
  const minutes = [...doneMins, ...(minute && minute.min === nowMin ? [minute] : [])];
  const next: SniperBookState = {
    ...book,
    watch: true,
    spot,
    minute,
    minutes: nearbyBars(minutes).slice(-20),
    forming5m: formingFiveBar(minutes, day, nowMin),
    peBid: opt.bid,
    peAsk: opt.ask,
    peLast: opt.last ?? book.last,
  };
  if (next.side === 'flat' && !next.fills.length && pick?.listed) {
    next.optionType = pick.optionType;
    next.strike = pick.strike;
    next.expiry = pick.expiry;
    next.optionSymbol = pick.optionSymbol;
    next.optionToken = pick.optionToken;
    next.lotSize = pick.lotSize;
  }
  next.pulse = appendPulse(next, nowMin, nowIso);
  return next;
}

export function tickSniperDesk(
  session: SniperSession,
  barsBy: Partial<Record<SniperUnder, SniperBar[]>>,
  spots: Partial<Record<SniperUnder, number | null>>,
  feed: Partial<Record<SniperUnder, { opt: SniperQuote; pick: SniperPick | null }>>,
  day: string,
  nowMin: number,
  nowIso: string,
  minutesBy: Partial<Record<SniperUnder, SniperBar[]>> = {},
): SniperSession {
  const lots = Math.max(1, Math.floor(Number(session.lots) || SNIPER_DEFAULT_LOTS));
  const stopRs = SNIPER_STOP_RS;
  const targetRs = SNIPER_TARGET_RS;
  const allowEntry = session.paperOn !== false || session.liveArmed === true;
  const done: Partial<Record<SniperUnder, SniperBar[]>> = {};
  for (const cfg of SNIPER_BOOKS) {
    done[cfg.id] = completedSniperBars(barsBy[cfg.id] || [], day, nowMin);
  }

  let books = SNIPER_BOOKS.map((cfg) => {
    const prev = session.books.find((b) => b.id === cfg.id) || emptySniperBook(cfg);
    return paintOrb({ ...prev, fills: [...prev.fills], skips: [...prev.skips], pulse: [...(prev.pulse || [])] }, done[cfg.id] || [], day, nowMin);
  });

  const taken = books.some((b) => b.side === 'long' || b.fills.length > 0);
  let selected: SniperUnder | '' = session.selected === 'bank' ? 'bank' : '';
  if (!selected && !taken) {
    const cut = firstCut(books, done);
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
              event: cut.dir === 'up' ? 'parked' : 'orb_break',
              status: cut.dir === 'up' ? 'skip' : 'cut',
              reason:
                cut.dir === 'up'
                  ? `up ORB ${hhmm(cut.min)} · skip CE · no trade today`
                  : `ORB break down ${hhmm(cut.min)} · wait 40% red`,
            }
          : b,
      );
    }
  } else if (selected) {
    books = books.map((b) => (b.id === selected && !b.cut ? { ...b, cut: b.breakDir || b.cut, status: b.status } : b));
  }

  books = books.map((book) => {
    const cfg = SNIPER_BOOKS.find((c) => c.id === book.id) || SNIPER_BOOKS[0];
    const opt = feed[book.id]?.opt || { bid: null, ask: null, last: null };
    const pick = feed[book.id]?.pick || null;
    const spot = spots[book.id] ?? null;
    const bars = done[book.id] || [];

    if (book.side === 'long' && book.entry != null) {
      return manageOpen(book, cfg, day, nowMin, nowIso, opt, stopRs, targetRs);
    }

    if (book.fills.length) {
      return { ...book, event: 'trade_closed', status: 'done', reason: book.reason || 'done' };
    }

    if (book.id !== selected) return book;

    const breakDir: SniperBreak = book.cut || book.breakDir;
    if (breakDir === 'up') {
      return {
        ...book,
        event: 'parked',
        status: 'skip',
        reason: book.reason || `up ORB · skip CE · no trade today`,
      };
    }

    if (nowMin >= cfg.flatMin) return { ...book, event: book.event || 'orb_break', reason: 'session closed' };
    if (nowMin > cfg.lastEntryMin) return { ...book, event: book.event || 'orb_break', reason: 'last entry passed' };
    if (!allowEntry) return { ...book, event: book.event || 'orb_break', reason: book.reason || 'paper off' };

    if (!breakDir || book.cutMin == null) {
      return { ...book, event: 'orb_break', reason: 'ORB break' };
    }

    const after = bars.filter((b) => b.min >= book.cutMin!);
    const red = after.find((b) => sniperStrongRed(b)) || null;
    if (!red) {
      return { ...book, breakDir, event: 'orb_break', reason: `ORB break down · wait 40% red` };
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
        reason: `40% red ${hhmm(red.min)} · wait tag ${red.high}`,
      };
    }
    if (spot == null || !(spot > 0)) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'found_entry', reason: 'waiting Bank spot' };
    }
    const want = sniperWantType(breakDir);
    if (want !== 'PE') {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'parked', reason: 'skip CE · no trade today' };
    }
    if (!pick || !pick.listed || !pick.optionSymbol) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'found_entry', reason: 'waiting ATM PE' };
    }
    if (pick.optionType !== 'PE') {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'found_entry', reason: 'waiting PE' };
    }
    const fillPx = opt.ask ?? opt.last;
    if (fillPx == null || !(fillPx > 0)) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: 'found_entry', reason: 'waiting PE quote' };
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
      optionType: 'PE',
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
      stopRs,
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
      reason: `open PE · SL ₹${size.sl} · sell ₹${size.tp}`,
      exception: false,
    };
    markBook(next, fillPx, cfg.venue);
    return next;
  });

  books = books.map((b) => stampLive(b, spots, feed, minutesBy, day, nowMin, nowIso));

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
    stopRs: SNIPER_STOP_RS,
    targetRs: SNIPER_TARGET_RS,
    books,
    honest: SNIPER_HONEST,
    incomplete: books.some(
      (b) =>
        b.fills.some((f) => f.incomplete) ||
        /waiting ATM|waiting quote|waiting PE|waiting Bank/.test(b.reason),
    ),
  };
}

export function allSniperFills(session: SniperSession): SniperFill[] {
  return session.books.flatMap((b) => b.fills.map((f) => ({ ...f, day: f.day || session.day })));
}

export function sniperBookCfg(id: SniperUnder): SniperBookCfg {
  return SNIPER_BOOKS.find((b) => b.id === id) || SNIPER_BOOKS[0];
}

/** Bank PE only. Up ORB is a skip, never CE. */
export function sniperWantType(dir: SniperBreak): 'CE' | 'PE' | null {
  if (dir === 'down') return 'PE';
  return null;
}

export { sniperIstDay };

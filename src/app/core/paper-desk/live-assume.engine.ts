/** Isolated ₹14k what-if. Never places a Kite order. */

export const LIVE_ASSUME_CAPITAL = 14_000;
export const LIVE_ASSUME_CHARGE = 50;
export const LIVE_ASSUME_CRUDE_MIN = 8_000;
export const LIVE_ASSUME_PREMIUM_BUDGET = 3_500;
export const LIVE_ASSUME_DAY_LOSS = 420;
/** First 5-min close minus this fraction is the Nifty maths zone (25,000 − 0.4011% = 24,899.725). */
export const OPEN5_ZONE_PCT = 0.004011;

export interface LiveAssumeBar {
  day: string;
  min: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LiveAssumeBookResult {
  id: string;
  label: string;
  product: string;
  instrument: string;
  sessionDay: string | null;
  structure: string;
  mode: string;
  how: string;
  reason: string;
  pts: number;
  rs: number;
  startRs: number;
  fundEnd: number;
  status: 'banked' | 'stood';
  last: number | null;
}

export interface LiveAssumeSnapshot {
  assumed: true;
  liveOrders: false;
  guaranteed: false;
  armedOnCrudeBest: false;
  capitalEachRs: number;
  chargeRs: number;
  source: string;
  kiteFunds: {
    equityCash: number;
    equityNet: number;
    commodityCash: number;
    commodityNet: number;
  } | null;
  kiteError: string | null;
  asOf: string;
  books: LiveAssumeBookResult[];
  totalRs: number;
  green: number;
  flat: number;
  red: number;
  honest: string;
}

export interface LiveAssumeBookCfg {
  id: string;
  label: string;
  product: string;
  sl: number;
  tp: number;
  scratch: number;
  rsPt: number;
  orS: number;
  orE: number;
  entryS: number;
  flat: number;
  quietW: number;
  pdMax: number;
  premiumRs: number;
  orMin: number;
  orMax: number;
  trapP: number;
  vwapMin: number;
  primary: Record<string, string>;
  backup: Record<string, readonly string[]>;
  /** Long the option (CE or PE). SL/TP live on premium, not futures. */
  buyOption?: boolean;
  /** pdhl fires only on the bar that crosses the previous-day level, not on every green bar beyond it. */
  freshCross?: boolean;
  /** 'watch' never opens a trade (no tested edge); 'momentum' is the pre-registered 6-bar thrust. */
  strategy?: 'rules' | 'momentum' | 'watch';
  /** Stop / target as fractions of the entry premium (overrides the point stops). */
  stopPct?: number;
  targetPct?: number;
  /** Cap the stop distance so one fail cannot take more than this many rupees (lot × pts). */
  maxStopRs?: number;
  /** Time exit, in 5-minute bars after the fill bar opens. */
  holdBars?: number;
  maxTradesPerDay?: number;
  /** Bars a new signal must be after the previous one. */
  minGapBars?: number;
  /** Buy the ATM strike instead of the cheap OTM one. */
  atm?: boolean;
  /** Open on the signal bar itself, without waiting for a confirming bar. */
  noConfirm?: boolean;
  /** false disables the 2-loss stop, the cooldown and the one-stop day check. */
  dayStops?: boolean;
  /** Pick an expiry after tomorrow (skip 1 day or less left) instead of only skipping expiry day. */
  expiryAfterTomorrow?: boolean;
  /** Underlying book (crude/nifty/bank/sensex) when id is `${under}-${desk}`. */
  under?: string;
  /** Strategy desk id (momentum/orb/pdhl/vwap/trap/scalp). */
  desk?: string;
  /** Scalp vehicle: futures or cash MIS. Option desks leave this unset. */
  kind?: 'fut' | 'eq';
  qty?: number;
  /** Fixed margin (NRML) when not computed from last × qty × misPct. */
  capitalRs?: number;
  misPct?: number;
  /** NSE/MCX trading symbol for hist and quotes (scalp stocks / crude future). */
  nseSymbol?: string;
  /** VWAP fade distance as a fraction of typical price (0.0025 = 0.25%). */
  vwapPct?: number;
  /** When true, the five-metric mix must pass before an option entry. Off on the historical Nifty pick. */
  mix?: boolean;
  /** Skip a new entry when the morning opening range is this structure (e.g. range). */
  skipStructures?: string[];
  /** Fixed rupee stop / target (overrides percent stops). Distance = rupees / lot. */
  stopRs?: number;
  targetRs?: number;
  /** Stop taking new trades after this many green fills today. */
  maxWinsPerDay?: number;
  /** Stop taking new trades once today's closed net (after charges) is at least this. */
  minDayNetRs?: number;
  /** Candle size in minutes. 1 = 1-minute thrust (needed for 5 trades a day). */
  barMinutes?: number;
  /** Momentum multiple. Default 1.5. 0.8 is the 1-min 3-of-5 print. */
  momK?: number;
  /** Minimum minutes between signals. Overrides minGapBars × barMinutes. */
  minGapMin?: number;
  /** 1 = CE / up only. −1 = PE / down only. Omit for both. */
  onlyDir?: 1 | -1;
}

/** Bar i's 6-bar close-to-close move and the move momentum needs (1.5 × √6 × mean range of the 20 bars before it). */
export function momentumGauge(
  bars: LiveAssumeBar[],
  i: number,
): { move: number; need: number; sessionBars: number } | null {
  const b = bars[i];
  if (!b || i < 20) return null;
  let sessionBars = 1;
  for (let k = i - 1; k >= 0 && bars[k].day === b.day; k--) sessionBars++;
  let sum = 0;
  for (let k = i - 20; k < i; k++) sum += bars[k].high - bars[k].low;
  const move = i >= 6 ? b.close - bars[i - 6].close : 0;
  return { move, need: 1.5 * (sum / 20) * Math.sqrt(6), sessionBars };
}

/** 6-bar close-to-close move beyond k × √6 × the mean range of the 20 bars before this one (same day, bar ≥ 6). */
export function momentumSignal(bars: LiveAssumeBar[], i: number, k = 1.5): number {
  const g = momentumGauge(bars, i);
  if (!g || g.sessionBars < 7) return 0;
  const need = (k / 1.5) * g.need;
  if (g.move > need) return 1;
  if (g.move < -need) return -1;
  return 0;
}

export const LIVE_ASSUME_BOOKS: LiveAssumeBookCfg[] = [
  {
    id: 'crude',
    label: 'Crude Mini FUT',
    product: '1 lot · ₹10/pt',
    sl: 20,
    tp: 25,
    scratch: 10,
    rsPt: 10,
    orS: 10 * 60,
    orE: 10 * 60 + 30,
    entryS: 10 * 60 + 30,
    flat: 23 * 60 + 10,
    quietW: 25,
    pdMax: 400,
    premiumRs: 0,
    orMin: 12,
    orMax: 220,
    trapP: 8,
    vwapMin: 18,
    primary: { trend: 'pdhl', range: 'orb_fade', quiet: 'vwap_fade' },
    backup: {
      trend: ['trap', 'orb_break', 'all_three'],
      range: ['trap', 'vwap_fade', 'fade_trap'],
      quiet: ['orb_fade', 'trap', 'fade_trap'],
      stand: ['trap', 'vwap_fade', 'orb_fade'],
    },
  },
  {
    id: 'nifty',
    label: 'Nifty 50',
    product: 'cheap CE/PE ₹50 ×65',
    sl: 25,
    tp: 50,
    scratch: 12,
    rsPt: 13,
    orS: 9 * 60 + 15,
    orE: 10 * 60 + 15,
    entryS: 10 * 60 + 15,
    flat: 15 * 60 + 15,
    quietW: 30,
    pdMax: 500,
    premiumRs: 3250,
    orMin: 20,
    orMax: 180,
    trapP: 12,
    vwapMin: 15,
    primary: { trend: 'pdhl', range: 'fade', quiet: 'vwap_fade' },
    backup: {
      trend: ['trap', 'all_three', 'fade_trap'],
      range: ['trap', 'vwap_fade', 'fade_trap'],
      quiet: ['fade', 'trap', 'fade_trap'],
      stand: ['trap', 'vwap_fade', 'fade'],
    },
  },
  {
    id: 'bank',
    label: 'Bank Nifty',
    product: 'cheap CE/PE ₹100 ×30',
    sl: 50,
    tp: 110,
    scratch: 25,
    rsPt: 6,
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 80,
    pdMax: 900,
    premiumRs: 3000,
    orMin: 40,
    orMax: 350,
    trapP: 25,
    vwapMin: 30,
    primary: { trend: 'pdhl', range: 'fade', quiet: 'vwap_fade' },
    backup: {
      trend: ['trap', 'all_three', 'fade_trap'],
      range: ['trap', 'vwap_fade', 'fade_trap'],
      quiet: ['fade', 'trap', 'fade_trap'],
      stand: ['trap', 'vwap_fade', 'fade'],
    },
  },
  {
    id: 'sensex',
    label: 'Sensex',
    product: 'cheap CE/PE ₹150 ×20',
    sl: 80,
    tp: 160,
    scratch: 40,
    rsPt: 4,
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 100,
    pdMax: 1000,
    premiumRs: 3000,
    orMin: 50,
    orMax: 400,
    trapP: 30,
    vwapMin: 35,
    primary: { trend: 'pdhl', range: 'fade', quiet: 'vwap_fade' },
    backup: {
      trend: ['trap', 'all_three', 'fade_trap'],
      range: ['trap', 'vwap_fade', 'fade_trap'],
      quiet: ['fade', 'trap', 'fade_trap'],
      stand: ['trap', 'vwap_fade', 'fade'],
    },
  },
];

/** Session typical-price VWAP through bar i (same day, inclusive). */
export function sessionVwap(bars: LiveAssumeBar[], i: number): number | null {
  const b = bars[i];
  if (!b) return null;
  const sess = bars.filter((x) => x.day === b.day && x.min <= b.min);
  if (!sess.length) return null;
  return sess.reduce((s, x) => s + (x.high + x.low + x.close) / 3, 0) / sess.length;
}

export function morningStructure(bars: LiveAssumeBar[], day: string, orS: number, orE: number, quietW: number): string {
  const or = bars.filter((b) => b.day === day && b.min >= orS && b.min <= orE);
  if (or.length < 2) return 'stand';
  const hi = Math.max(...or.map((b) => b.high));
  const lo = Math.min(...or.map((b) => b.low));
  const width = hi - lo;
  if (width <= 0) return 'stand';
  const o0 = or[0].open;
  const c1 = or[or.length - 1].close;
  const mid = (hi + lo) / 2;
  if (width < quietW) return 'quiet';
  if (c1 >= mid + 0.2 * width && c1 > o0) return 'trend';
  if (c1 <= mid - 0.2 * width && c1 < o0) return 'trend';
  return 'range';
}

function sessionOr(bars: LiveAssumeBar[], day: string, orS: number, orE: number): { hi: number; lo: number } | null {
  const or = bars.filter((b) => b.day === day && b.min >= orS && b.min <= orE);
  if (!or.length) return null;
  return { hi: Math.max(...or.map((b) => b.high)), lo: Math.min(...or.map((b) => b.low)) };
}

/** Close of the first 5 one-minute bars from session open (`orS`). */
export function first5MinClose(bars: LiveAssumeBar[], day: string, openMin: number): number | null {
  const win = bars.filter((x) => x.day === day && x.min >= openMin && x.min < openMin + 5);
  if (!win.length) return null;
  return win[win.length - 1].close;
}

function prevHl(bars: LiveAssumeBar[], day: string): { hi: number; lo: number } | null {
  const days = [...new Set(bars.map((b) => b.day))].sort();
  const i = days.indexOf(day);
  if (i <= 0) return null;
  const prev = bars.filter((b) => b.day === days[i - 1]);
  if (!prev.length) return null;
  return { hi: Math.max(...prev.map((b) => b.high)), lo: Math.min(...prev.map((b) => b.low)) };
}

function closesTo(bars: LiveAssumeBar[], i: number): number[] {
  return bars.slice(0, i + 1).map((x) => x.close);
}

function emaLast(xs: number[], period: number): number | null {
  if (xs.length < period) return null;
  const k = 2 / (period + 1);
  let ema = xs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let j = period; j < xs.length; j++) ema = xs[j] * k + ema * (1 - k);
  return ema;
}

function smaLast(xs: number[], period: number): number | null {
  if (xs.length < period) return null;
  const slice = xs.slice(xs.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function stdevLast(xs: number[], period: number): number | null {
  const mean = smaLast(xs, period);
  if (mean == null) return null;
  const slice = xs.slice(xs.length - period);
  const varSum = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period;
  return Math.sqrt(varSum);
}

function rsiLast(xs: number[], period = 14): number | null {
  if (xs.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let j = 1; j <= period; j++) {
    const d = xs[j] - xs[j - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let j = period + 1; j < xs.length; j++) {
    const d = xs[j] - xs[j - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function macdLast(xs: number[]): { macd: number; signal: number } | null {
  if (xs.length < 35) return null;
  const line: number[] = [];
  for (let j = 25; j < xs.length; j++) {
    const slice = xs.slice(0, j + 1);
    const fast = emaLast(slice, 12);
    const slow = emaLast(slice, 26);
    if (fast == null || slow == null) return null;
    line.push(fast - slow);
  }
  const signal = emaLast(line, 9);
  if (signal == null) return null;
  return { macd: line[line.length - 1], signal };
}

function trAt(bars: LiveAssumeBar[], j: number): number {
  const c = bars[j];
  const p = bars[j - 1];
  if (!p) return c.high - c.low;
  return Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
}

function supertrendFlip(bars: LiveAssumeBar[], i: number, period = 10, mult = 3): number {
  if (i < period + 1) return 0;
  let atr = 0;
  for (let j = 1; j <= period; j++) atr += trAt(bars, j);
  atr /= period;
  let dir = 1;
  let up = (bars[period].high + bars[period].low) / 2 - mult * atr;
  let dn = (bars[period].high + bars[period].low) / 2 + mult * atr;
  for (let j = period + 1; j <= i; j++) {
    atr = (atr * (period - 1) + trAt(bars, j)) / period;
    const mid = (bars[j].high + bars[j].low) / 2;
    let nextUp = mid - mult * atr;
    let nextDn = mid + mult * atr;
    const prevClose = bars[j - 1].close;
    if (prevClose > up) nextUp = Math.max(nextUp, up);
    if (prevClose < dn) nextDn = Math.min(nextDn, dn);
    const prevDir = dir;
    if (bars[j].close > dn) dir = 1;
    else if (bars[j].close < up) dir = -1;
    up = nextUp;
    dn = nextDn;
    if (j === i && dir !== prevDir) return dir;
  }
  return 0;
}

function donchBreak(bars: LiveAssumeBar[], i: number, lookback: number): number {
  if (i < lookback) return 0;
  const win = bars.slice(i - lookback, i);
  const hi = Math.max(...win.map((x) => x.high));
  const lo = Math.min(...win.map((x) => x.low));
  const b = bars[i];
  if (b.close > hi && b.close > b.open) return 1;
  if (b.close < lo && b.close < b.open) return -1;
  return 0;
}

export function bookSignal(mode: string, bars: LiveAssumeBar[], i: number, cfg: LiveAssumeBookCfg): number {
  const b = bars[i];
  const up = b.close > b.open;
  const dn = b.close < b.open;
  const pdhl = () => {
    const lv = prevHl(bars, b.day);
    if (!lv || lv.hi - lv.lo > cfg.pdMax) return 0;
    const prior = i > 0 ? bars[i - 1] : null;
    const crossedUp = !cfg.freshCross || (prior != null && prior.close <= lv.hi);
    const crossedDn = !cfg.freshCross || (prior != null && prior.close >= lv.lo);
    if (b.close > lv.hi && up && crossedUp) return 1;
    if (b.close < lv.lo && dn && crossedDn) return -1;
    return 0;
  };
  const fade = () => {
    if (b.min <= cfg.orE) return 0;
    const orb = sessionOr(bars, b.day, cfg.orS, cfg.orE);
    if (!orb) return 0;
    const w = orb.hi - orb.lo;
    if (w < cfg.orMin || w > cfg.orMax) return 0;
    if (b.high > orb.hi && b.close < orb.hi && dn) return -1;
    if (b.low < orb.lo && b.close > orb.lo && up) return 1;
    return 0;
  };
  const trap = () => {
    const from = Math.max(0, i - 6);
    const win = bars.slice(from, i);
    if (win.length < 3) return 0;
    const sh = Math.max(...win.map((x) => x.high));
    const sl = Math.min(...win.map((x) => x.low));
    if (b.low < sl - cfg.trapP && b.close > sl && up) return 1;
    if (b.high > sh + cfg.trapP && b.close < sh && dn) return -1;
    return 0;
  };
  const vwapFade = () => {
    const typ = sessionVwap(bars, i);
    if (typ == null) return 0;
    const dist = b.close - typ;
    const need = cfg.vwapPct != null && typ > 0 ? typ * cfg.vwapPct : cfg.vwapMin;
    if (Math.abs(dist) < need) return 0;
    if (dist > 0 && dn) return -1;
    if (dist < 0 && up) return 1;
    return 0;
  };
  const orbBreak = () => {
    if (b.min <= cfg.orE) return 0;
    const orb = sessionOr(bars, b.day, cfg.orS, cfg.orE);
    if (!orb) return 0;
    if (orb.hi - orb.lo > cfg.orMax) return 0;
    if (b.close > orb.hi && up) return 1;
    if (b.close < orb.lo && dn) return -1;
    return 0;
  };
  if (mode === 'momentum') return momentumSignal(bars, i, cfg.momK ?? 1.5);
  if (mode === 'pdhl') return pdhl();
  if (mode === 'fade' || mode === 'orb_fade') return fade();
  if (mode === 'trap') return trap();
  if (mode === 'vwap_fade') return vwapFade();
  if (mode === 'orb_break') return orbBreak();
  if (mode === 'pdhl_fade') return pdhl() || fade();
  if (mode === 'fade_trap') return fade() || trap();
  if (mode === 'all_three') return pdhl() || fade() || trap();
  if (mode === 'ema_cross') {
    const xs = closesTo(bars, i);
    const fast = emaLast(xs, 9);
    const slow = emaLast(xs, 21);
    const prevFast = emaLast(xs.slice(0, -1), 9);
    const prevSlow = emaLast(xs.slice(0, -1), 21);
    if (fast == null || slow == null || prevFast == null || prevSlow == null) return 0;
    if (prevFast <= prevSlow && fast > slow) return 1;
    if (prevFast >= prevSlow && fast < slow) return -1;
    return 0;
  }
  if (mode === 'ema_pull') {
    const xs = closesTo(bars, i);
    const e = emaLast(xs, 21);
    const prevE = emaLast(xs.slice(0, -1), 21);
    if (e == null || prevE == null) return 0;
    if (e > prevE && b.low <= e && b.close > e && up) return 1;
    if (e < prevE && b.high >= e && b.close < e && dn) return -1;
    return 0;
  }
  if (mode === 'donch20') return donchBreak(bars, i, 20);
  if (mode === 'donch55') return donchBreak(bars, i, 55);
  if (mode === 'inside_break') {
    if (i < 2) return 0;
    const mother = bars[i - 2];
    const inside = bars[i - 1];
    if (inside.high > mother.high || inside.low < mother.low) return 0;
    if (b.close > inside.high && up) return 1;
    if (b.close < inside.low && dn) return -1;
    return 0;
  }
  if (mode === 'vwap_reclaim') {
    if (i < 1) return 0;
    const vwap = sessionVwap(bars, i);
    const prevV = sessionVwap(bars, i - 1);
    const prior = bars[i - 1];
    if (vwap == null || prevV == null) return 0;
    const need = cfg.vwapPct != null && prevV > 0 ? prevV * cfg.vwapPct : cfg.vwapMin;
    if (Math.abs(prior.close - prevV) < need) return 0;
    if (prior.close < prevV && b.close > vwap && up) return 1;
    if (prior.close > prevV && b.close < vwap && dn) return -1;
    return 0;
  }
  if (mode === 'gap_fade') {
    const days = [...new Set(bars.map((x) => x.day))].sort();
    const di = days.indexOf(b.day);
    if (di <= 0) return 0;
    const prev = bars.filter((x) => x.day === days[di - 1]);
    const today = bars.filter((x) => x.day === b.day && x.min <= b.min);
    if (!prev.length || !today.length) return 0;
    if (b.min > cfg.orE + 45) return 0;
    const open0 = today[0].open;
    const gap = open0 - prev[prev.length - 1].close;
    const need = Math.max(1, Math.abs(prev[prev.length - 1].close) * 0.0015);
    const prior = i > 0 && bars[i - 1].day === b.day ? bars[i - 1] : null;
    if (gap > need && dn && b.close < open0 && (!prior || prior.close >= open0)) return -1;
    if (gap < -need && up && b.close > open0 && (!prior || prior.close <= open0)) return 1;
    return 0;
  }
  if (mode === 'rsi14') {
    const xs = closesTo(bars, i);
    const cur = rsiLast(xs, 14);
    const prev = rsiLast(xs.slice(0, -1), 14);
    if (cur == null || prev == null) return 0;
    if (prev < 30 && cur >= 30 && up) return 1;
    if (prev > 70 && cur <= 70 && dn) return -1;
    return 0;
  }
  if (mode === 'macd') {
    const xs = closesTo(bars, i);
    const cur = macdLast(xs);
    const prev = macdLast(xs.slice(0, -1));
    if (!cur || !prev) return 0;
    if (prev.macd <= prev.signal && cur.macd > cur.signal) return 1;
    if (prev.macd >= prev.signal && cur.macd < cur.signal) return -1;
    return 0;
  }
  if (mode === 'bb_mean') {
    const xs = closesTo(bars, i);
    const mean = smaLast(xs, 20);
    const sd = stdevLast(xs, 20);
    const prevMean = smaLast(xs.slice(0, -1), 20);
    const prevSd = stdevLast(xs.slice(0, -1), 20);
    if (mean == null || sd == null || prevMean == null || prevSd == null || i < 1) return 0;
    const prior = bars[i - 1];
    if (prior.close > prevMean + 2 * prevSd && b.close <= mean + 2 * sd && dn) return -1;
    if (prior.close < prevMean - 2 * prevSd && b.close >= mean - 2 * sd && up) return 1;
    return 0;
  }
  if (mode === 'supertrend') return supertrendFlip(bars, i);
  if (mode === 'or_retest') {
    if (b.min <= cfg.orE) return 0;
    const orb = sessionOr(bars, b.day, cfg.orS, cfg.orE);
    if (!orb) return 0;
    const after = bars.filter((x) => x.day === b.day && x.min > cfg.orE && x.min < b.min);
    const brokeHi = after.some((x) => x.close > orb.hi);
    const brokeLo = after.some((x) => x.close < orb.lo);
    if (brokeHi && b.low <= orb.hi && b.close > orb.hi && up) return 1;
    if (brokeLo && b.high >= orb.lo && b.close < orb.lo && dn) return -1;
    return 0;
  }
  if (mode === 'open5_zone') {
    const openMin = cfg.orS;
    if (b.min < openMin + 5) return 0;
    const c0 = first5MinClose(bars, b.day, openMin);
    if (c0 == null || c0 <= 0) return 0;
    const zone = c0 * (1 - OPEN5_ZONE_PCT);
    const prior = i > 0 && bars[i - 1].day === b.day ? bars[i - 1] : null;
    if (!prior) return 0;
    if (prior.close > zone && b.low <= zone && b.close > zone) return 1;
    if (prior.close >= zone && b.close < zone) return -1;
    return 0;
  }
  return 0;
}

export function simulate(
  bars: LiveAssumeBar[],
  cfg: LiveAssumeBookCfg,
  mode: string,
  flip: boolean,
  day: string,
): { rs: number; pts: number; reason: string } | null {
  let pending: { dir: number; sig: number } | null = null;
  let open: { dir: number; entry: number; stop: number; target: number; scratch: number } | null = null;
  for (let i = 3; i < bars.length; i++) {
    const b = bars[i];
    if (b.day !== day) continue;
    if (open) {
      const { dir, entry, stop, target, scratch } = open;
      let exitPx: number | null = null;
      let reason = '';
      if (dir === 1 && b.low <= scratch) {
        exitPx = scratch;
        reason = 'scratch';
      } else if (dir === -1 && b.high >= scratch) {
        exitPx = scratch;
        reason = 'scratch';
      } else if (dir === 1 && b.low <= stop) {
        exitPx = stop;
        reason = 'sl';
      } else if (dir === -1 && b.high >= stop) {
        exitPx = stop;
        reason = 'sl';
      } else if (dir === 1 && b.high >= target) {
        exitPx = target;
        reason = 'tp';
      } else if (dir === -1 && b.low <= target) {
        exitPx = target;
        reason = 'tp';
      } else if (b.min >= cfg.flat) {
        exitPx = b.close;
        reason = 'eod';
      }
      if (exitPx != null) {
        const pts = dir * (exitPx - entry);
        return { pts, rs: pts * cfg.rsPt - LIVE_ASSUME_CHARGE, reason };
      }
      continue;
    }
    if (pending) {
      const p = pending;
      pending = null;
      const ok =
        p.dir === 1
          ? b.close > b.open && b.close > p.sig
          : b.close < b.open && b.close < p.sig;
      if (!ok) continue;
      const d = p.dir;
      open = {
        dir: d,
        entry: b.open,
        stop: b.open - d * cfg.sl,
        target: b.open + d * cfg.tp,
        scratch: b.open - d * cfg.scratch,
      };
      continue;
    }
    if (b.min < cfg.entryS || b.min > cfg.flat - 30) continue;
    let d = bookSignal(mode, bars, i, cfg);
    if (!d) continue;
    if (flip) d = -d;
    pending = { dir: d, sig: b.close };
  }
  return null;
}

export function bankTicket(
  ticket: { rs: number; pts: number; reason: string; how: string; mode: string; structure: string } | null,
  bookId: string,
  premiumRs: number,
): Omit<LiveAssumeBookResult, 'id' | 'label' | 'product' | 'instrument' | 'sessionDay' | 'last'> {
  const empty = {
    structure: ticket?.structure || 'stand',
    mode: ticket?.mode || 'stand',
    how: ticket?.how || 'stand',
    reason: ticket?.reason || 'stand',
    pts: 0,
    rs: 0,
    startRs: LIVE_ASSUME_CAPITAL,
    fundEnd: LIVE_ASSUME_CAPITAL,
    status: 'stood' as const,
  };
  if (!ticket || ticket.rs <= 0) return empty;
  if (premiumRs > LIVE_ASSUME_PREMIUM_BUDGET || premiumRs > LIVE_ASSUME_CAPITAL) {
    return { ...empty, reason: 'premium over budget' };
  }
  if (bookId === 'crude' && LIVE_ASSUME_CAPITAL < LIVE_ASSUME_CRUDE_MIN) {
    return { ...empty, reason: 'need ₹8,000 free for Crude' };
  }
  if (LIVE_ASSUME_CAPITAL + ticket.rs < 0 || ticket.rs <= -LIVE_ASSUME_DAY_LOSS) {
    return { ...empty, reason: 'day-loss cap' };
  }
  return {
    structure: ticket.structure,
    mode: ticket.mode,
    how: ticket.how,
    reason: ticket.reason,
    pts: ticket.pts,
    rs: Math.round(ticket.rs * 10) / 10,
    startRs: LIVE_ASSUME_CAPITAL,
    fundEnd: Math.round((LIVE_ASSUME_CAPITAL + ticket.rs) * 10) / 10,
    status: 'banked',
  };
}

export function pickClosed(bars: LiveAssumeBar[], cfg: LiveAssumeBookCfg, day: string) {
  const st = morningStructure(bars, day, cfg.orS, cfg.orE, cfg.quietW);
  const mode = cfg.primary[st];
  const tryMode = (m: string, flip: boolean, how: string) => {
    const t = simulate(bars, cfg, m, flip, day);
    if (t && t.rs > 0) return { ...t, how, mode: m, structure: st };
    return null;
  };
  return (
    (mode && tryMode(mode, false, 'structure')) ||
    (mode && tryMode(mode, true, 'reverse')) ||
    (cfg.backup[st] || []).reduce(
      (hit, alt) => hit || tryMode(alt, false, `backup:${alt}`),
      null as ReturnType<typeof tryMode>,
    ) ||
    (cfg.backup[st] || []).reduce(
      (hit, alt) => hit || tryMode(alt, true, `reverse-backup:${alt}`),
      null as ReturnType<typeof tryMode>,
    )
  );
}

export function latestDay(bars: LiveAssumeBar[]): string | null {
  const days = [...new Set(bars.map((b) => b.day))].sort();
  return days.at(-1) ?? null;
}

export function closeBook(
  bars: LiveAssumeBar[],
  cfg: LiveAssumeBookCfg,
  instrument: string,
  last: number | null,
): LiveAssumeBookResult {
  const day = latestDay(bars);
  const pick = day ? pickClosed(bars, cfg, day) : null;
  const closed = bankTicket(pick, cfg.id, cfg.premiumRs);
  return {
    id: cfg.id,
    label: cfg.label,
    product: cfg.product,
    instrument,
    sessionDay: day,
    last,
    ...closed,
    structure: pick?.structure || closed.structure,
    mode: pick?.mode || closed.mode,
    how: pick?.how || closed.how,
  };
}

export function summarize(
  books: LiveAssumeBookResult[],
  source: string,
  kiteFunds: LiveAssumeSnapshot['kiteFunds'],
  kiteError: string | null,
  asOf: string,
): LiveAssumeSnapshot {
  const totalRs = Math.round(books.reduce((s, b) => s + b.rs, 0) * 10) / 10;
  const green = books.filter((b) => b.rs > 0).length;
  const flat = books.filter((b) => b.rs === 0).length;
  const red = books.filter((b) => b.rs < 0).length;
  const fundsLine = kiteFunds
    ? `Kite equity ₹${kiteFunds.equityCash.toLocaleString('en-IN')} · commodity ₹${kiteFunds.commodityCash.toLocaleString('en-IN')} (context only — each book still uses ₹${LIVE_ASSUME_CAPITAL.toLocaleString('en-IN')}). `
    : 'Connect Token, then run, to size from today’s Kite funds and candles. ';
  const tight: string[] = [];
  if (kiteFunds && kiteFunds.equityCash < LIVE_ASSUME_CAPITAL) {
    tight.push('equity cash is below ₹14,000 so a live index ticket would not open');
  }
  if (kiteFunds && kiteFunds.commodityCash < LIVE_ASSUME_CRUDE_MIN) {
    tight.push('commodity cash is below ₹8,000 so Crude Mini 1 lot would not open');
  }
  const tightLine = tight.length ? `${tight.join('. ')}. ` : '';
  return {
    assumed: true,
    liveOrders: false,
    guaranteed: false,
    armedOnCrudeBest: false,
    capitalEachRs: LIVE_ASSUME_CAPITAL,
    chargeRs: LIVE_ASSUME_CHARGE,
    source,
    kiteFunds,
    kiteError,
    asOf,
    books,
    totalRs,
    green,
    flat,
    red,
    honest:
      `Assumption only — no Kite order was placed. ₹${LIVE_ASSUME_CAPITAL.toLocaleString('en-IN')} isolated on each book. ` +
      `Only a ticket that stays green after ₹${LIVE_ASSUME_CHARGE} is banked. Source: ${source}. ${fundsLine}${tightLine}` +
      'Index books are cheap OTM 0.2-delta proxies — ATM/FUT does not fit ₹14k. Not a guaranteed profit. Crude Best stays unarmed.',
  };
}

export function booksFundEnd(books: LiveAssumeBookResult[]): number {
  return Math.round(books.reduce((s, b) => s + b.fundEnd, 0) * 10) / 10;
}

import { Candle } from '../../../models/candle.model';

/**
 * A declarative strategy "recipe" — a strategy expressed as data rather than code, so the
 * finder can generate and score thousands of them, and a winner can be exported as JSON and
 * pasted straight back into the codebase.
 *
 * Every entry condition must pass on the same bar (they are AND-ed). Composing from a small
 * set of well-understood blocks keeps each result interpretable: when something works you can
 * say *why*, rather than trusting an opaque score.
 */

export type EntryCondition =
  /** Trend regime: fast EMA above (or below) slow EMA. */
  | { kind: 'emaTrend'; fast: number; slow: number; mode: 'above' | 'below' }
  /** Price closes beyond the prior N-bar extreme (breakout / breakdown). */
  | { kind: 'breakout'; lookback: number; side: 'high' | 'low' }
  /** Wilder RSI compared against a threshold. */
  | { kind: 'rsi'; period: number; op: 'lt' | 'gt'; value: number }
  /** Today's volume relative to its own trailing average. */
  | { kind: 'volumeSurge'; lookback: number; minRatio: number }
  /** Price stretched below/above an EMA by at least this much — a pullback within trend. */
  | { kind: 'pullback'; ema: number; minPct: number; side: 'below' | 'above' }
  /** Tradeable price band (keeps ₹10 penny stocks and ₹40k names out). */
  | { kind: 'priceRange'; minRs: number; maxRs: number }
  /** Volatility band as ATR% of price — filters both dead and unhinged names. */
  | { kind: 'atrPct'; period: number; minPct: number; maxPct: number }
  /** Minimum average traded volume — a liquidity floor. */
  | { kind: 'minLiquidity'; lookback: number; minAvgVolume: number }
  // --- blocks ported from the "Smart Pullback PRO" Pine indicator ---
  /** Close on a given side of a single EMA (the script's `close > ema50`). */
  | { kind: 'priceVsEma'; period: number; side: 'above' | 'below' }
  /**
   * Candle body larger than its own recent average — the script's strongBull/strongBear.
   * Ratio-based, so it scales across instruments unchanged.
   */
  | { kind: 'strongBody'; lookback: number; minRatio: number }
  /**
   * Bar closes beyond the previous bar's extreme while its opposite end stays within
   * `tolerancePct` of the previous bar's opposite extreme — i.e. a wide engulfing bar.
   *
   * This is the script's `bullBreakout and bullRetest` pair. The original wrote the
   * tolerance as a raw `+10`, which is 10% of a ₹100 stock but 0.3% of a ₹3,000 one; here
   * it is a percentage so the same recipe means the same thing on every symbol.
   */
  | { kind: 'engulfPrevRange'; tolerancePct: number; side: 'up' | 'down' }
  /**
   * Bar trades into an EMA from the correct side and still closes in the trend's favour —
   * the script's pullbackBuy / pullbackSell.
   */
  | { kind: 'emaTouch'; period: number; side: 'above' | 'below' }
  /**
   * Rejects the flat, rangebound tape the script warns about with its "SIDEWAYS" label:
   * requires ATR to be at least `minAtrRatio` of its own 20-bar average.
   */
  | { kind: 'notSideways'; period: number; minAtrRatio: number }
  /**
   * Price within `maxDistPct` of the most recent confirmed pivot level — buying near
   * support or selling near resistance. This is the script's S/R zone idea expressed as a
   * tradeable filter rather than a drawn box.
   */
  | { kind: 'nearPivot'; lookback: number; maxDistPct: number; side: 'support' | 'resistance' };

export type StopKind = 'atr' | 'pct' | 'swingLow';

export interface ExitRule {
  stopKind: StopKind;
  /** ATR multiple when stopKind='atr'; percent (0.05 = 5%) when 'pct'; swing lookback when 'swingLow'. */
  stopValue: number;
  /** Hard ceiling on entry→stop distance, so a target stays reachable in the hold window. */
  maxRiskPct: number;
  /** Target distance as a multiple of risk. */
  rewardMultiple: number;
  /** Force the position closed after this many bars if neither stop nor target hits. */
  maxHoldBars: number;
}

export interface StrategyRecipe {
  label: string;
  direction: 'LONG' | 'SHORT';
  entry: EntryCondition[];
  exit: ExitRule;
  /**
   * Minimum bars between one entry and the next on the same symbol — the Pine script's
   * `bar_index - lastBuyBar > 15` duplicate filter. Stops a single extended move from
   * being counted as a dozen separate "wins".
   */
  cooldownBars?: number;
}

// ---------------------------------------------------------------------------
// Indicator pre-computation
//
// Recipes share parameters heavily during a sweep (fifty recipes may all want EMA-20), so
// every series a search needs is computed once per symbol and then read by index. Without
// this a few hundred recipes over a few hundred symbols is unusably slow in a browser.
// ---------------------------------------------------------------------------

export interface IndicatorRequest {
  emaPeriods: Set<number>;
  rsiPeriods: Set<number>;
  atrPeriods: Set<number>;
  extremeLookbacks: Set<number>;
  volumeLookbacks: Set<number>;
  swingLookbacks: Set<number>;
  bodyLookbacks: Set<number>;
  /** ATR periods needing an ATR-vs-its-own-average ratio series. */
  atrRatioPeriods: Set<number>;
}

export function emptyIndicatorRequest(): IndicatorRequest {
  return {
    emaPeriods: new Set(),
    rsiPeriods: new Set(),
    atrPeriods: new Set(),
    extremeLookbacks: new Set(),
    volumeLookbacks: new Set(),
    swingLookbacks: new Set(),
    bodyLookbacks: new Set(),
    atrRatioPeriods: new Set(),
  };
}

/** Walks a recipe and records every indicator series it will need. */
export function collectIndicatorNeeds(recipe: StrategyRecipe, into: IndicatorRequest): void {
  for (const c of recipe.entry) {
    switch (c.kind) {
      case 'emaTrend':
        into.emaPeriods.add(c.fast);
        into.emaPeriods.add(c.slow);
        break;
      case 'breakout':
        into.extremeLookbacks.add(c.lookback);
        break;
      case 'rsi':
        into.rsiPeriods.add(c.period);
        break;
      case 'volumeSurge':
        into.volumeLookbacks.add(c.lookback);
        break;
      case 'pullback':
        into.emaPeriods.add(c.ema);
        break;
      case 'atrPct':
        into.atrPeriods.add(c.period);
        break;
      case 'minLiquidity':
        into.volumeLookbacks.add(c.lookback);
        break;
      case 'priceVsEma':
      case 'emaTouch':
        into.emaPeriods.add(c.period);
        break;
      case 'strongBody':
        into.bodyLookbacks.add(c.lookback);
        break;
      case 'notSideways':
        into.atrPeriods.add(c.period);
        into.atrRatioPeriods.add(c.period);
        break;
      case 'nearPivot':
        into.swingLookbacks.add(c.lookback);
        break;
      default:
        break;
    }
  }
  if (recipe.exit.stopKind === 'atr') into.atrPeriods.add(14);
  if (recipe.exit.stopKind === 'swingLow') into.swingLookbacks.add(Math.round(recipe.exit.stopValue));
}

export interface SymbolIndicators {
  candles: Candle[];
  ema: Map<number, (number | null)[]>;
  rsi: Map<number, (number | null)[]>;
  atr: Map<number, (number | null)[]>;
  /** Highest high over the N bars BEFORE the current one. */
  priorHigh: Map<number, (number | null)[]>;
  priorLow: Map<number, (number | null)[]>;
  /** Mean volume over the N bars BEFORE the current one. */
  avgVol: Map<number, (number | null)[]>;
  swingLow: Map<number, (number | null)[]>;
  swingHigh: Map<number, (number | null)[]>;
  /** Mean |close − open| over the prior N bars. */
  bodyAvg: Map<number, (number | null)[]>;
  /** ATR divided by its own 20-bar average — a "is the tape moving at all" gauge. */
  atrRatio: Map<number, (number | null)[]>;
}

function emaSeries(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += candles[i]!.close;
  let ema = sum / period;
  out[period - 1] = ema;
  for (let i = period; i < candles.length; i += 1) {
    ema = candles[i]!.close * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/** Wilder's RSI — smoothed average gain / average loss. */
function rsiSeries(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = candles[i]!.close - candles[i - 1]!.close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < candles.length; i += 1) {
    const diff = candles[i]!.close - candles[i - 1]!.close;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atrSeries(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const trs: number[] = [0];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let sum = 0;
  for (let i = 1; i <= period; i += 1) sum += trs[i]!;
  let atr = sum / period;
  out[period] = atr;
  for (let i = period + 1; i < candles.length; i += 1) {
    atr = (atr * (period - 1) + trs[i]!) / period;
    out[i] = atr;
  }
  return out;
}

/** Rolling extreme over the `lookback` bars strictly BEFORE each index. */
function priorExtremeSeries(candles: Candle[], lookback: number, kind: 'high' | 'low'): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = lookback; i < candles.length; i += 1) {
    let best = kind === 'high' ? -Infinity : Infinity;
    for (let j = i - lookback; j < i; j += 1) {
      const v = kind === 'high' ? candles[j]!.high : candles[j]!.low;
      best = kind === 'high' ? Math.max(best, v) : Math.min(best, v);
    }
    out[i] = Number.isFinite(best) ? best : null;
  }
  return out;
}

function avgVolumeSeries(candles: Candle[], lookback: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (i >= lookback) {
      out[i] = sum / lookback;
      sum -= candles[i - lookback]!.volume;
    }
    sum += candles[i]!.volume;
  }
  return out;
}

/**
 * Last confirmed swing extreme, forward-filled. A swing needs `lb` bars on each side, so a
 * candidate only becomes usable `lb` bars later — the fill respects that delay rather than
 * revealing the level the moment it forms.
 */
function swingSeries(candles: Candle[], lb: number, kind: 'high' | 'low'): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let current: number | null = null;
  for (let i = 0; i < candles.length; i += 1) {
    const mid = i - lb;
    if (mid >= lb) {
      const v = kind === 'high' ? candles[mid]!.high : candles[mid]!.low;
      let ok = true;
      for (let j = 1; j <= lb && ok; j += 1) {
        const a = kind === 'high' ? candles[mid - j]!.high : candles[mid - j]!.low;
        const b = kind === 'high' ? candles[mid + j]!.high : candles[mid + j]!.low;
        if (kind === 'high' ? a >= v || b > v : a <= v || b < v) ok = false;
      }
      if (ok) current = v;
    }
    out[i] = current;
  }
  return out;
}

/** Rolling mean of |close − open| over the `lookback` bars before each index. */
function bodyAvgSeries(candles: Candle[], lookback: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (i >= lookback) {
      out[i] = sum / lookback;
      const old = candles[i - lookback]!;
      sum -= Math.abs(old.close - old.open);
    }
    const c = candles[i]!;
    sum += Math.abs(c.close - c.open);
  }
  return out;
}

/** ATR relative to its own trailing average — low values mean a flat, rangebound tape. */
function atrRatioSeries(atr: (number | null)[], smaLen = 20): (number | null)[] {
  const out: (number | null)[] = new Array(atr.length).fill(null);
  let sum = 0;
  let count = 0;
  const window: number[] = [];
  for (let i = 0; i < atr.length; i += 1) {
    const v = atr[i];
    if (v == null) continue;
    window.push(v);
    sum += v;
    count += 1;
    if (count > smaLen) {
      sum -= window.shift()!;
      count -= 1;
    }
    if (count === smaLen) {
      const avg = sum / smaLen;
      out[i] = avg > 0 ? v / avg : null;
    }
  }
  return out;
}

export function buildIndicators(candles: Candle[], req: IndicatorRequest): SymbolIndicators {
  const ind: SymbolIndicators = {
    candles,
    ema: new Map(),
    rsi: new Map(),
    atr: new Map(),
    priorHigh: new Map(),
    priorLow: new Map(),
    avgVol: new Map(),
    swingLow: new Map(),
    swingHigh: new Map(),
    bodyAvg: new Map(),
    atrRatio: new Map(),
  };
  for (const p of req.emaPeriods) ind.ema.set(p, emaSeries(candles, p));
  for (const p of req.rsiPeriods) ind.rsi.set(p, rsiSeries(candles, p));
  for (const p of req.atrPeriods) ind.atr.set(p, atrSeries(candles, p));
  for (const l of req.extremeLookbacks) {
    ind.priorHigh.set(l, priorExtremeSeries(candles, l, 'high'));
    ind.priorLow.set(l, priorExtremeSeries(candles, l, 'low'));
  }
  for (const l of req.volumeLookbacks) ind.avgVol.set(l, avgVolumeSeries(candles, l));
  for (const l of req.swingLookbacks) {
    ind.swingLow.set(l, swingSeries(candles, l, 'low'));
    ind.swingHigh.set(l, swingSeries(candles, l, 'high'));
  }
  for (const l of req.bodyLookbacks) ind.bodyAvg.set(l, bodyAvgSeries(candles, l));
  for (const p of req.atrRatioPeriods) {
    const atr = ind.atr.get(p) ?? atrSeries(candles, p);
    if (!ind.atr.has(p)) ind.atr.set(p, atr);
    ind.atrRatio.set(p, atrRatioSeries(atr));
  }
  return ind;
}

// ---------------------------------------------------------------------------
// Recipe evaluation
// ---------------------------------------------------------------------------

function conditionPasses(c: EntryCondition, ind: SymbolIndicators, i: number): boolean {
  const bar = ind.candles[i]!;
  switch (c.kind) {
    case 'emaTrend': {
      const f = ind.ema.get(c.fast)?.[i];
      const s = ind.ema.get(c.slow)?.[i];
      if (f == null || s == null) return false;
      return c.mode === 'above' ? f > s : f < s;
    }
    case 'breakout': {
      const level = c.side === 'high' ? ind.priorHigh.get(c.lookback)?.[i] : ind.priorLow.get(c.lookback)?.[i];
      if (level == null) return false;
      return c.side === 'high' ? bar.close > level : bar.close < level;
    }
    case 'rsi': {
      const v = ind.rsi.get(c.period)?.[i];
      if (v == null) return false;
      return c.op === 'lt' ? v < c.value : v > c.value;
    }
    case 'volumeSurge': {
      const avg = ind.avgVol.get(c.lookback)?.[i];
      if (avg == null || avg <= 0) return false;
      return bar.volume / avg >= c.minRatio;
    }
    case 'pullback': {
      const e = ind.ema.get(c.ema)?.[i];
      if (e == null || e <= 0) return false;
      const pct = (bar.close - e) / e;
      return c.side === 'below' ? pct <= -c.minPct : pct >= c.minPct;
    }
    case 'priceRange':
      return bar.close >= c.minRs && bar.close <= c.maxRs;
    case 'atrPct': {
      const a = ind.atr.get(c.period)?.[i];
      if (a == null || bar.close <= 0) return false;
      const pct = a / bar.close;
      return pct >= c.minPct && pct <= c.maxPct;
    }
    case 'minLiquidity': {
      const avg = ind.avgVol.get(c.lookback)?.[i];
      return avg != null && avg >= c.minAvgVolume;
    }
    case 'priceVsEma': {
      const e = ind.ema.get(c.period)?.[i];
      if (e == null) return false;
      return c.side === 'above' ? bar.close > e : bar.close < e;
    }
    case 'strongBody': {
      const avg = ind.bodyAvg.get(c.lookback)?.[i];
      if (avg == null || avg <= 0) return false;
      const body = Math.abs(bar.close - bar.open);
      const directional = c.minRatio >= 0 ? bar.close > bar.open : bar.close < bar.open;
      return directional && body > avg * Math.abs(c.minRatio);
    }
    case 'engulfPrevRange': {
      if (i < 1) return false;
      const prev = ind.candles[i - 1]!;
      if (c.side === 'up') {
        // Closes above yesterday's high while its low stays near yesterday's low.
        return bar.close > prev.high && bar.low <= prev.low * (1 + c.tolerancePct);
      }
      return bar.close < prev.low && bar.high >= prev.high * (1 - c.tolerancePct);
    }
    case 'emaTouch': {
      const e = ind.ema.get(c.period)?.[i];
      if (e == null) return false;
      if (c.side === 'above') {
        return bar.close > e && bar.close > bar.open && bar.low <= e;
      }
      return bar.close < e && bar.close < bar.open && bar.high >= e;
    }
    case 'notSideways': {
      const r = ind.atrRatio.get(c.period)?.[i];
      return r != null && r >= c.minAtrRatio;
    }
    case 'nearPivot': {
      const level =
        c.side === 'support' ? ind.swingLow.get(c.lookback)?.[i] : ind.swingHigh.get(c.lookback)?.[i];
      if (level == null || level <= 0) return false;
      return Math.abs(bar.close - level) / level <= c.maxDistPct;
    }
    default:
      return false;
  }
}

function resolveStop(recipe: StrategyRecipe, ind: SymbolIndicators, i: number, entry: number): number | null {
  const long = recipe.direction === 'LONG';
  const { stopKind, stopValue, maxRiskPct } = recipe.exit;
  let raw: number | null = null;

  if (stopKind === 'pct') {
    raw = long ? entry * (1 - stopValue) : entry * (1 + stopValue);
  } else if (stopKind === 'atr') {
    const a = ind.atr.get(14)?.[i];
    if (a == null) return null;
    raw = long ? entry - a * stopValue : entry + a * stopValue;
  } else {
    const lb = Math.round(stopValue);
    const level = long ? ind.swingLow.get(lb)?.[i] : ind.swingHigh.get(lb)?.[i];
    if (level == null) return null;
    raw = level;
  }

  const capped = long ? entry * (1 - maxRiskPct) : entry * (1 + maxRiskPct);
  const stop = long ? Math.max(raw, capped) : Math.min(raw, capped);
  if (long ? stop >= entry : stop <= entry) return null;
  return stop;
}

export interface RecipeTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  stop: number;
  target: number;
  exitDate: string;
  exitPrice: number;
  exitReason: 'TARGET' | 'STOP' | 'TIME';
  rMultiple: number;
  barsHeld: number;
  win: boolean;
}

/**
 * Replays one recipe over one symbol. Entry is taken at the NEXT bar's open after the
 * signal — you cannot trade a close you have only just observed, and pretending otherwise
 * is the single most common way a backtest flatters itself.
 */
export function runRecipeOnSymbol(
  recipe: StrategyRecipe,
  symbol: string,
  ind: SymbolIndicators,
  fromDate?: string,
  toDate?: string,
): RecipeTrade[] {
  const trades: RecipeTrade[] = [];
  const candles = ind.candles;
  const long = recipe.direction === 'LONG';
  let i = 1;

  while (i < candles.length - 1) {
    const signalBar = candles[i]!;
    const day = signalBar.date.slice(0, 10);
    if (fromDate && day < fromDate) { i += 1; continue; }
    if (toDate && day > toDate) break;

    let ok = true;
    for (const c of recipe.entry) {
      if (!conditionPasses(c, ind, i)) { ok = false; break; }
    }
    if (!ok) { i += 1; continue; }

    const entryIdx = i + 1;
    const entry = candles[entryIdx]!.open;
    const stop = resolveStop(recipe, ind, i, entry);
    if (stop == null) { i += 1; continue; }

    const risk = Math.abs(entry - stop);
    const target = long
      ? entry + risk * recipe.exit.rewardMultiple
      : entry - risk * recipe.exit.rewardMultiple;

    let exitPrice = 0;
    let exitDate = '';
    let exitReason: 'TARGET' | 'STOP' | 'TIME' = 'TIME';
    let closedAt = -1;

    for (let j = entryIdx; j < candles.length; j += 1) {
      const bar = candles[j]!;
      const held = j - entryIdx;
      // Stop is checked before target: if one bar spans both, assume the worse fill.
      if (long ? bar.low <= stop : bar.high >= stop) {
        exitReason = 'STOP'; exitPrice = stop; exitDate = bar.date; closedAt = j; break;
      }
      if (long ? bar.high >= target : bar.low <= target) {
        exitReason = 'TARGET'; exitPrice = target; exitDate = bar.date; closedAt = j; break;
      }
      if (held >= recipe.exit.maxHoldBars) {
        exitReason = 'TIME'; exitPrice = bar.close; exitDate = bar.date; closedAt = j; break;
      }
    }

    if (closedAt < 0) break; // ran out of data before the trade resolved

    const move = long ? exitPrice - entry : entry - exitPrice;
    trades.push({
      symbol,
      entryDate: candles[entryIdx]!.date,
      entryPrice: entry,
      stop,
      target,
      exitDate,
      exitPrice,
      exitReason,
      rMultiple: move / risk,
      barsHeld: closedAt - entryIdx,
      win: move > 0,
    });
    // Respect the recipe's cooldown so one extended move cannot be re-entered repeatedly
    // and counted as several independent wins.
    i = Math.max(closedAt + 1, entryIdx + (recipe.cooldownBars ?? 0));
  }

  return trades;
}

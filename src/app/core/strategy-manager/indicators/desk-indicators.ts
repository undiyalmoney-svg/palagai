import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
import { extractTradeDate } from '../../utils/trade-date.util';

/** Flatten series available at ctx (includes current bar). */
export function seriesAt(ctx: StrategyContext): Candle[] {
  return [...ctx.previous5m, ctx.candle5m];
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function emaLast(closes: number[], period: number): number | null {
  if (closes.length < period) {
    return null;
  }
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i += 1) {
    ema = closes[i]! * k + ema * (1 - k);
  }
  return ema;
}

export function atrAt(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) {
    return null;
  }
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  if (trs.length < period) {
    return null;
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function donchian(candles: Candle[], lookback: number, excludeLast = true): {
  high: number;
  low: number;
} | null {
  const end = excludeLast ? candles.length - 1 : candles.length;
  const start = end - lookback;
  if (start < 0 || end <= start) {
    return null;
  }
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = start; i < end; i += 1) {
    hi = Math.max(hi, candles[i]!.high);
    lo = Math.min(lo, candles[i]!.low);
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    return null;
  }
  return { high: hi, low: lo };
}

/** Confirmed swing high/low with `lb` bars on each side (excludes current forming bar). */
export function swingLevels(candles: Candle[], lb: number): { high: number; low: number } | null {
  const n = candles.length;
  if (n < lb * 2 + 2) {
    return null;
  }
  // Evaluate at i = n - 2 - lb (last confirmed)
  const i = n - 2 - lb;
  if (i < lb) {
    return null;
  }
  const midH = candles[i]!.high;
  const midL = candles[i]!.low;
  let isSwingH = true;
  let isSwingL = true;
  for (let j = 1; j <= lb; j += 1) {
    if (candles[i - j]!.high >= midH || candles[i + j]!.high > midH) {
      isSwingH = false;
    }
    if (candles[i - j]!.low <= midL || candles[i + j]!.low < midL) {
      isSwingL = false;
    }
  }
  // Walk back for last confirmed swings
  let sh: number | null = null;
  let sl: number | null = null;
  for (let k = n - 2 - lb; k >= lb; k -= 1) {
    const h = candles[k]!.high;
    const l = candles[k]!.low;
    let okH = true;
    let okL = true;
    for (let j = 1; j <= lb; j += 1) {
      if (candles[k - j]!.high >= h || candles[k + j]!.high > h) {
        okH = false;
      }
      if (candles[k - j]!.low <= l || candles[k + j]!.low < l) {
        okL = false;
      }
    }
    if (okH && sh == null) {
      sh = h;
    }
    if (okL && sl == null) {
      sl = l;
    }
    if (sh != null && sl != null) {
      break;
    }
  }
  if (sh == null || sl == null) {
    // fallback: use isSwing at last confirmed if partial
    if (isSwingH) {
      sh = midH;
    }
    if (isSwingL) {
      sl = midL;
    }
  }
  if (sh == null || sl == null) {
    return null;
  }
  return { high: sh, low: sl };
}

/**
 * Last confirmed 3-bar fractal swing high/low (1 bar each side).
 * Causal: evaluates candidates that have a right-hand neighbor in `candles`.
 * Prefer `researchSwingAt` for DONCH trail exits (matches research swing3).
 */
export function lastSwing3(candles: Candle[]): { high: number | null; low: number | null } {
  const n = candles.length;
  let high: number | null = null;
  let low: number | null = null;
  for (let i = n - 2; i >= 1; i -= 1) {
    const h = candles[i]!.high;
    const l = candles[i]!.low;
    if (high == null && candles[i - 1]!.high < h && candles[i + 1]!.high < h) {
      high = h;
    }
    if (low == null && candles[i - 1]!.low > l && candles[i + 1]!.low > l) {
      low = l;
    }
    if (high != null && low != null) {
      break;
    }
  }
  return { high, low };
}

/**
 * Research `precompute_swings(lookback)` at the last bar.
 * Swing extreme needs `lookback` bars on each side; value appears at
 * confirmation index i+lookback and is forward-filled (strategy-universe-search).
 * Trail exit uses lookback=3 (`inst.swing3_*`).
 */
export function researchSwingAt(
  candles: Candle[],
  lookback: number,
): { high: number | null; low: number | null } {
  const n = candles.length;
  if (n < lookback * 2 + 1 || lookback < 1) {
    return { high: null, low: null };
  }
  const lastSh = new Array<number>(n).fill(Number.NaN);
  const lastSl = new Array<number>(n).fill(Number.NaN);
  let curH = Number.NaN;
  let curL = Number.NaN;
  for (let i = lookback; i < n - lookback; i += 1) {
    const h = candles[i]!.high;
    const l = candles[i]!.low;
    let isH = true;
    let isL = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) {
        continue;
      }
      if (candles[j]!.high >= h) {
        isH = false;
      }
      if (candles[j]!.low <= l) {
        isL = false;
      }
      if (!isH && !isL) {
        break;
      }
    }
    const conf = i + lookback;
    if (isH) {
      curH = h;
    }
    if (isL) {
      curL = l;
    }
    if (conf < n) {
      lastSh[conf] = curH;
      lastSl[conf] = curL;
    }
  }
  for (let i = 1; i < n; i += 1) {
    if (Number.isNaN(lastSh[i]) && !Number.isNaN(lastSh[i - 1]!)) {
      lastSh[i] = lastSh[i - 1]!;
    }
    if (Number.isNaN(lastSl[i]) && !Number.isNaN(lastSl[i - 1]!)) {
      lastSl[i] = lastSl[i - 1]!;
    }
  }
  const hi = lastSh[n - 1]!;
  const lo = lastSl[n - 1]!;
  return {
    high: Number.isNaN(hi) ? null : hi,
    low: Number.isNaN(lo) ? null : lo,
  };
}

export interface DayOrRange {
  high: number;
  low: number;
  mid: number;
  firstOpen: number;
  lastClose: number;
}

export function openingRange(
  dayBars: Candle[],
  marketOpen: string,
  orEnd: string,
): DayOrRange | null {
  const openM = toMin(marketOpen);
  const endM = toMin(orEnd);
  let hi = -Infinity;
  let lo = Infinity;
  let firstOpen: number | null = null;
  let lastClose: number | null = null;
  for (const b of dayBars) {
    const m = toMin(extractHhMm(b.date));
    if (m < openM) {
      continue;
    }
    if (m >= endM) {
      break;
    }
    hi = Math.max(hi, b.high);
    lo = Math.min(lo, b.low);
    if (firstOpen == null) {
      firstOpen = b.open;
    }
    lastClose = b.close;
  }
  if (firstOpen == null || lastClose == null || !(hi > lo)) {
    return null;
  }
  return { high: hi, low: lo, mid: (hi + lo) / 2, firstOpen, lastClose };
}

export function barsOnDay(series: Candle[], day: string): Candle[] {
  return series.filter((c) => extractTradeDate(c.date) === day);
}

export function previousDayBars(series: Candle[], day: string): Candle[] {
  const days = [...new Set(series.map((c) => extractTradeDate(c.date)))].sort();
  const idx = days.indexOf(day);
  if (idx <= 0) {
    return [];
  }
  return barsOnDay(series, days[idx - 1]!);
}

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

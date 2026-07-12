import type { Candle } from './types.ts';

export function parseTs(dateTime: string): number {
  return new Date(dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')).getTime();
}

export function extractDate(dateTime: string): string {
  const n = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
  return n.slice(0, 10);
}

export function extractHhMm(dateTime: string): string {
  const n = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
  return (n.split(' ')[1] ?? '').slice(0, 5);
}

export function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function atrSeries(candles: Candle[], period = 14): number[] {
  const out = new Array(candles.length).fill(NaN);
  if (candles.length < 2) return out;
  const tr: number[] = [candles[0]!.high - candles[0]!.low];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let sum = 0;
  for (let i = 0; i < Math.min(period, tr.length); i += 1) sum += tr[i]!;
  if (tr.length < period) return out;
  let atr = sum / period;
  out[period - 1] = atr;
  for (let i = period; i < tr.length; i += 1) {
    atr = (atr * (period - 1) + tr[i]!) / period;
    out[i] = atr;
  }
  return out;
}

export function supertrendSeries(
  candles: Candle[],
  atr: number[],
  multiplier = 3,
): { value: number[]; dir: (1 | -1)[] } {
  const value = new Array(candles.length).fill(NaN);
  const dir = new Array(candles.length).fill(1) as (1 | -1)[];
  let prevUpper = NaN;
  let prevLower = NaN;
  let prevSt = NaN;
  let prevDir: 1 | -1 = 1;

  for (let i = 0; i < candles.length; i += 1) {
    const a = atr[i];
    if (!Number.isFinite(a)) continue;
    const mid = (candles[i]!.high + candles[i]!.low) / 2;
    let upper = mid + multiplier * a!;
    let lower = mid - multiplier * a!;
    if (Number.isFinite(prevLower) && candles[i - 1]!.close > prevLower) {
      lower = Math.max(lower, prevLower);
    }
    if (Number.isFinite(prevUpper) && candles[i - 1]!.close < prevUpper) {
      upper = Math.min(upper, prevUpper);
    }
    let st: number;
    let d: 1 | -1;
    if (!Number.isFinite(prevSt)) {
      d = candles[i]!.close >= mid ? 1 : -1;
      st = d === 1 ? lower : upper;
    } else if (prevDir === 1) {
      d = candles[i]!.close < lower ? -1 : 1;
      st = d === 1 ? lower : upper;
    } else {
      d = candles[i]!.close > upper ? 1 : -1;
      st = d === 1 ? lower : upper;
    }
    value[i] = st;
    dir[i] = d;
    prevUpper = upper;
    prevLower = lower;
    prevSt = st;
    prevDir = d;
  }
  return { value, dir };
}

export function rollingSwing(candles: Candle[], lookback = 5): { high: number[]; low: number[] } {
  const high = new Array(candles.length).fill(NaN);
  const low = new Array(candles.length).fill(NaN);
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j += 1) {
      if (candles[i]!.high <= candles[i - j]!.high || candles[i]!.high <= candles[i + j]!.high) {
        isHigh = false;
      }
      if (candles[i]!.low >= candles[i - j]!.low || candles[i]!.low >= candles[i + j]!.low) {
        isLow = false;
      }
    }
    if (isHigh) high[i] = candles[i]!.high;
    if (isLow) low[i] = candles[i]!.low;
  }
  // forward-fill last known swing
  let lastH = NaN;
  let lastL = NaN;
  const fh = new Array(candles.length).fill(NaN);
  const fl = new Array(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i += 1) {
    if (Number.isFinite(high[i])) lastH = high[i]!;
    if (Number.isFinite(low[i])) lastL = low[i]!;
    fh[i] = lastH;
    fl[i] = lastL;
  }
  return { high: fh, low: fl };
}

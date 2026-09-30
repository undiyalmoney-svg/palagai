import { Candle } from '../../models/candle.model';

const BASE = Date.parse('2026-03-02T09:15:00+05:30');
const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Continuous IST stamp `n` bars after the base, `minutes` apart. */
export function stamp(n: number, minutes: number): string {
  const ms = BASE + n * minutes * 60_000;
  return `${new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 19)}+05:30`;
}

/**
 * Candles that travel in straight lines between `points`, `perLeg` bars each.
 * Wicks are `wick` beyond the body so pivots are unambiguous.
 */
export function walk(
  points: number[],
  perLeg: number,
  opts: { minutes?: number; startBar?: number; wick?: number } = {},
): Candle[] {
  const minutes = opts.minutes ?? 15;
  const wick = opts.wick ?? 0.2;
  const out: Candle[] = [];
  let bar = opts.startBar ?? 0;
  let prev = points[0]!;
  for (let p = 1; p < points.length; p += 1) {
    const target = points[p]!;
    for (let k = 1; k <= perLeg; k += 1) {
      const close = points[p - 1]! + ((target - points[p - 1]!) * k) / perLeg;
      out.push({
        date: stamp(bar, minutes),
        open: prev,
        high: Math.max(prev, close) + wick,
        low: Math.min(prev, close) - wick,
        close,
        volume: 1000,
      });
      prev = close;
      bar += 1;
    }
  }
  return out;
}

/** Deterministic pseudo random numbers, so a failing seed can be replayed. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trending, mean-reverting random walk with real wicks. */
export function randomWalk(count: number, seed: number, minutes = 15): Candle[] {
  const rand = rng(seed);
  const out: Candle[] = [];
  let price = 24_000;
  let drift = 0;
  for (let i = 0; i < count; i += 1) {
    if (i % 40 === 0) drift = (rand() - 0.5) * 6;
    const open = price;
    const close = open + drift + (rand() - 0.5) * 24;
    const high = Math.max(open, close) + rand() * 10;
    const low = Math.min(open, close) - rand() * 10;
    out.push({ date: stamp(i, minutes), open, high, low, close, volume: 1000 });
    price = close;
  }
  return out;
}

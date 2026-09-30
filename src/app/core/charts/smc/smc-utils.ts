import { Candle } from '../../models/candle.model';

/**
 * Epoch ms of a Kite candle stamp. Stamps with no zone are IST wall clock,
 * which is how Kite returns them and how the rest of the desk reads them.
 */
export function candleTs(date: string | null | undefined): number {
  if (!date) return 0;
  const raw = String(date).trim().replace(' ', 'T');
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const ms = Date.parse(hasZone ? raw : `${raw}+05:30`);
  return Number.isFinite(ms) ? ms : 0;
}

/** Minutes between two bars' stamps, used to size a bar when no interval is given. */
export function medianStepMinutes(bars: Candle[]): number {
  const steps: number[] = [];
  for (let i = 1; i < bars.length && steps.length < 60; i += 1) {
    const step = (candleTs(bars[i]!.date) - candleTs(bars[i - 1]!.date)) / 60_000;
    if (step > 0) steps.push(step);
  }
  if (!steps.length) return 0;
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)]!;
}

/**
 * Causal ATR: value `i` uses bars `0..i` only. Wilder smoothing, seeded with
 * the mean of the true ranges seen so far so early bars still get a value.
 */
export function causalAtr(bars: Candle[], period: number): number[] {
  const out: number[] = [];
  let atr = 0;
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i]!;
    const prevClose = i > 0 ? bars[i - 1]!.close : bar.open;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose),
    );
    if (i < period) {
      sum += tr;
      atr = sum / (i + 1);
    } else {
      atr = (atr * (period - 1) + tr) / period;
    }
    out.push(atr);
  }
  return out;
}

export function sessionDay(date: string): string {
  return String(date).slice(0, 10);
}

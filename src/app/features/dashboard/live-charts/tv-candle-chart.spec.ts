import { describe, expect, it } from 'vitest';
import { niceTicks } from './tv-candle-chart.component';

describe('niceTicks', () => {
  it('covers the range with 1/2/5 × 10ⁿ steps', () => {
    const ticks = niceTicks(9_500, 10_150, 6);
    expect(ticks.length).toBeGreaterThan(2);
    const step = ticks[1]! - ticks[0]!;
    const mag = Math.pow(10, Math.floor(Math.log10(step)));
    expect([1, 2, 5, 10]).toContain(Math.round(step / mag));
  });

  it('stays inside the range and ascends', () => {
    const ticks = niceTicks(24_120.35, 24_505.9, 5);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
    }
    expect(ticks[0]!).toBeGreaterThanOrEqual(24_120.35);
    expect(ticks[ticks.length - 1]!).toBeLessThanOrEqual(24_505.9);
  });

  it('does not accumulate float drift on fractional steps', () => {
    for (const tick of niceTicks(100.05, 100.55, 5)) {
      expect(tick).toBeCloseTo(Number(tick.toFixed(6)), 9);
    }
  });

  it('degrades to a single tick for a flat or invalid range', () => {
    expect(niceTicks(100, 100, 5)).toEqual([100]);
    expect(niceTicks(Number.NaN, 10, 5)).toHaveLength(1);
  });

  it('handles a Bank Nifty sized range without exploding the tick count', () => {
    expect(niceTicks(54_000, 56_400, 6).length).toBeLessThan(40);
  });
});

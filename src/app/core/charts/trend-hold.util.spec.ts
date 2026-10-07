import { describe, expect, it } from 'vitest';
import { SmcStructureEvent, SmcTrend } from './smc/smc.types';
import { TREND_HOLD_MINUTES, trendHoldCall } from './trend-hold.util';

function series(trend: SmcTrend, bars: number): SmcTrend[] {
  return Array.from({ length: bars }, () => trend);
}

function held(bars = TREND_HOLD_MINUTES, trend: SmcTrend = 'bullish') {
  return {
    snapshot: {
      trend,
      ltfTrend: trend,
      htfTrend: trend,
      lastChoch: null,
    },
    trendAt: series(trend, bars),
    htfTrendAt: series(trend, bars),
    structure: [] as SmcStructureEvent[],
    htfAvailable: true,
  };
}

describe('trendHoldCall', () => {
  it('continues only after 45 minutes on both timeframes', () => {
    expect(trendHoldCall(held(45) as never, 1, 5)).toBe('continue');
    expect(trendHoldCall(held(44) as never, 1, 5)).toBe('wait');
  });

  it('waits when the timeframes disagree or the higher timeframe is missing', () => {
    const split = held();
    split.snapshot.ltfTrend = 'bearish' as never;
    expect(trendHoldCall(split as never, 1, 5)).toBe('wait');

    const noHtf = held();
    noHtf.htfAvailable = false;
    expect(trendHoldCall(noHtf as never, 1, 5)).toBe('wait');
  });

  it('waits on a sideways read', () => {
    const side = held(45, 'sideways');
    side.snapshot.htfTrend = null as never;
    side.htfTrendAt = series('sideways', 45);
    expect(trendHoldCall(side as never, 1, 5)).toBe('wait');
  });

  it('waits when a break against the trend sits inside the window', () => {
    const row = held();
    row.structure = [{ index: row.trendAt.length - 10, dir: 'bear', kind: 'CHoCH' } as SmcStructureEvent];
    expect(trendHoldCall(row as never, 1, 5)).toBe('wait');
  });

  it('ignores a break that is older than the hold window', () => {
    const row = held(60);
    row.structure = [{ index: 0, dir: 'bear', kind: 'CHoCH' } as SmcStructureEvent];
    expect(trendHoldCall(row as never, 1, 5)).toBe('continue');
  });

  it('uses three 15-minute bars for the same 45-minute hold', () => {
    expect(trendHoldCall(held(3) as never, 15, 30)).toBe('continue');
    expect(trendHoldCall(held(2) as never, 15, 30)).toBe('wait');
  });

  it('reads nothing when there is no analysis yet', () => {
    expect(trendHoldCall(null, 1, 5)).toBe('reading');
  });
});

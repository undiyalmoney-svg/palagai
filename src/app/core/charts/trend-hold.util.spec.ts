import { describe, expect, it } from 'vitest';
import { SmcStructureEvent, SmcTrend } from './smc/smc.types';
import { trendContinue } from './trend-hold.util';

function stretch(parts: Array<[SmcTrend, number]>, htf: SmcTrend | null = 'bullish') {
  const trendAt: SmcTrend[] = [];
  for (const [trend, count] of parts) {
    for (let i = 0; i < count; i += 1) trendAt.push(trend);
  }
  const trend = parts[parts.length - 1]?.[0] ?? 'sideways';
  return {
    snapshot: {
      trend,
      ltfTrend: trend,
      htfTrend: htf,
      lastChoch: null,
    },
    trendAt,
    htfTrendAt: trendAt.map(() => htf),
    structure: [] as SmcStructureEvent[],
    htfAvailable: htf != null,
  };
}

describe('trendContinue', () => {
  it('uses the minutes similar trends usually have left', () => {
    const twenty = stretch([
      ['bullish', 40],
      ['sideways', 5],
      ['bullish', 60],
      ['sideways', 5],
      ['bullish', 20],
    ]);
    expect(trendContinue(twenty as never, 1, 5)).toEqual({ call: 'continue', minutes: 20 });

    const fifteen = stretch([
      ['bullish', 30],
      ['sideways', 5],
      ['bullish', 40],
      ['sideways', 5],
      ['bullish', 50],
      ['sideways', 5],
      ['bullish', 25],
    ]);
    expect(trendContinue(fifteen as never, 1, 5)).toEqual({ call: 'continue', minutes: 15 });

    const hour = stretch([
      ['bullish', 80],
      ['sideways', 5],
      ['bullish', 90],
      ['sideways', 5],
      ['bullish', 100],
      ['sideways', 5],
      ['bullish', 30],
    ]);
    expect(trendContinue(hour as never, 1, 5)).toEqual({ call: 'continue', minutes: 60 });

    const twoHours = stretch([
      ['bullish', 140],
      ['sideways', 5],
      ['bullish', 160],
      ['sideways', 5],
      ['bullish', 180],
      ['sideways', 5],
      ['bullish', 20],
    ]);
    expect(trendContinue(twoHours as never, 1, 5)).toEqual({ call: 'continue', minutes: 120 });
  });

  it('does not claim more than 2 hours', () => {
    const long = stretch([
      ['bullish', 200],
      ['sideways', 5],
      ['bullish', 240],
      ['sideways', 5],
      ['bullish', 20],
    ]);
    expect(trendContinue(long as never, 1, 5)).toEqual({ call: 'continue', minutes: 120 });
  });

  it('waits when the usual run is almost over or this run just started', () => {
    const late = stretch([
      ['bullish', 30],
      ['sideways', 5],
      ['bullish', 40],
      ['sideways', 5],
      ['bullish', 30],
    ]);
    expect(trendContinue(late as never, 1, 5)).toEqual({ call: 'wait' });

    const fresh = stretch([
      ['bullish', 80],
      ['sideways', 5],
      ['bullish', 100],
      ['sideways', 5],
      ['bullish', 10],
    ]);
    expect(trendContinue(fresh as never, 1, 5)).toEqual({ call: 'wait' });
  });

  it('waits when the timeframes split or the higher timeframe is missing', () => {
    const row = stretch([
      ['bullish', 40],
      ['sideways', 5],
      ['bullish', 60],
      ['sideways', 5],
      ['bullish', 20],
    ]);
    row.snapshot.ltfTrend = 'bearish' as never;
    expect(trendContinue(row as never, 1, 5)).toEqual({ call: 'wait' });

    const noHtf = stretch(
      [
        ['bullish', 40],
        ['sideways', 5],
        ['bullish', 60],
        ['sideways', 5],
        ['bullish', 20],
      ],
      null,
    );
    expect(trendContinue(noHtf as never, 1, 5)).toEqual({ call: 'wait' });
  });

  it('waits on a break against the current run', () => {
    const row = stretch([
      ['bullish', 40],
      ['sideways', 5],
      ['bullish', 60],
      ['sideways', 5],
      ['bullish', 20],
    ]);
    row.structure = [{ index: row.trendAt.length - 5, dir: 'bear', kind: 'CHoCH' } as SmcStructureEvent];
    expect(trendContinue(row as never, 1, 5)).toEqual({ call: 'wait' });
  });

  it('counts 15-minute bars in minutes', () => {
    const row = stretch([
      ['bullish', 4],
      ['sideways', 1],
      ['bullish', 6],
      ['sideways', 1],
      ['bullish', 2],
    ]);
    expect(trendContinue(row as never, 15, 30)).toEqual({ call: 'continue', minutes: 30 });
  });

  it('reads nothing when there is no analysis yet', () => {
    expect(trendContinue(null, 1, 5)).toEqual({ call: 'reading' });
  });
});

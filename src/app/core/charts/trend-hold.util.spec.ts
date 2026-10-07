import { describe, expect, it } from 'vitest';
import { SmcTrend } from './smc/smc.types';
import { applyTrendPromise, trendContinue } from './trend-hold.util';

function stretch(parts: Array<[SmcTrend, number]>, htf: SmcTrend | null | 'same' = 'same') {
  const trendAt: SmcTrend[] = [];
  for (const [trend, count] of parts) {
    for (let i = 0; i < count; i += 1) trendAt.push(trend);
  }
  const trend = parts[parts.length - 1]?.[0] ?? 'sideways';
  const htfTrend = htf === 'same' ? (trend === 'sideways' ? null : trend) : htf;
  const htfTrendAt =
    htf === 'same'
      ? trendAt.map((bar) => (bar === 'sideways' ? null : bar))
      : trendAt.map(() => htfTrend);
  return {
    snapshot: {
      trend,
      ltfTrend: trend,
      htfTrend,
      lastChoch: null,
    },
    trendAt,
    htfTrendAt,
    structure: [],
    htfAvailable: htfTrend != null,
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

  it('still names the minutes when the downtrend is the only run on the chart', () => {
    const down = stretch([['bearish', 73]]);
    down.trendAt = Array.from({ length: 73 }, (_, i) => (i % 7 === 0 ? 'sideways' : 'bearish')) as never;
    down.htfTrendAt = down.trendAt.map((bar) => (bar === 'sideways' ? null : bar)) as never;
    down.snapshot.ltfTrend = 'sideways' as never;
    expect(trendContinue(down as never, 1, 5)).toEqual({ call: 'continue', minutes: 70 });
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

  it('waits when this run has not held for 15 minutes yet', () => {
    const fresh = stretch([
      ['bullish', 80],
      ['sideways', 5],
      ['bullish', 100],
      ['sideways', 5],
      ['bullish', 10],
    ]);
    expect(trendContinue(fresh as never, 1, 5)).toEqual({ call: 'wait' });
  });

  it('waits when the lower timeframe has turned against the card for 15 minutes', () => {
    const row = stretch([['bearish', 80]]);
    row.trendAt = Array.from({ length: 80 }, (_, i) => (i < 65 ? 'bearish' : 'bullish')) as never;
    row.snapshot.ltfTrend = 'bullish' as never;
    expect(trendContinue(row as never, 1, 5)).toEqual({ call: 'wait' });
  });

  it('keeps the downtrend when only the latest minute has bounced', () => {
    const row = stretch([['bearish', 40]]);
    row.trendAt = Array.from({ length: 40 }, (_, i) => (i === 39 ? 'bullish' : 'bearish')) as never;
    row.snapshot.ltfTrend = 'bullish' as never;
    expect(trendContinue(row as never, 1, 5)).toEqual({ call: 'continue', minutes: 40 });
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

describe('applyTrendPromise', () => {
  const start = 1_700_000_000_000;

  it('counts down a stated 60 minutes instead of switching to wait', () => {
    const issued = applyTrendPromise({ call: 'continue', minutes: 60 }, 'bearish', null, start);
    expect(issued.call).toEqual({ call: 'continue', minutes: 60 });
    expect(issued.next?.untilMs).toBe(start + 60 * 60_000);

    const later = applyTrendPromise({ call: 'wait' }, 'bearish', issued.next, start + 20 * 60_000);
    expect(later.call).toEqual({ call: 'continue', minutes: 40 });
    expect(later.next).toEqual(issued.next);
  });

  it('drops the statement once the stated minutes have passed', () => {
    const issued = applyTrendPromise({ call: 'continue', minutes: 60 }, 'bearish', null, start);
    const done = applyTrendPromise({ call: 'wait' }, 'bearish', issued.next, start + 60 * 60_000);
    expect(done.call).toEqual({ call: 'wait' });
    expect(done.next).toBeNull();
  });

  it('drops the statement when the card trend itself changes', () => {
    const issued = applyTrendPromise({ call: 'continue', minutes: 60 }, 'bearish', null, start);
    const flipped = applyTrendPromise({ call: 'wait' }, 'sideways', issued.next, start + 20 * 60_000);
    expect(flipped.call).toEqual({ call: 'wait' });
    expect(flipped.next).toBeNull();
  });
});

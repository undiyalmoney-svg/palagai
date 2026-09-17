import { describe, expect, it } from 'vitest';
import { Candle } from '../models/candle.model';
import { aggregateCandles, mergeCandles } from './candle-aggregate.util';

/** 15m bars from a given open time on a given day. */
function bars(
  day: string,
  openHour: number,
  openMinute: number,
  rows: [number, number, number, number][],
): Candle[] {
  return rows.map(([o, h, l, c], i) => {
    const mins = openHour * 60 + openMinute + i * 15;
    const hm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    return { date: `${day}T${hm}:00+0530`, open: o, high: h, low: l, close: c, volume: 10 };
  });
}

describe('mergeCandles', () => {
  it('takes the first open, the extremes, the last close and the volume sum', () => {
    const run = bars('2026-09-17', 9, 15, [
      [100, 104, 99, 103],
      [103, 110, 102, 105],
      [105, 107, 95, 96],
    ]);
    expect(mergeCandles(run)).toEqual({
      date: '2026-09-17T09:15:00+0530',
      open: 100,
      high: 110,
      low: 95,
      close: 96,
      volume: 30,
    });
  });

  it('round-trips a single candle', () => {
    const [one] = bars('2026-09-17', 9, 15, [[100, 104, 99, 103]]);
    expect(mergeCandles([one!])).toEqual(one);
  });
});

describe('aggregateCandles', () => {
  it('folds 15m into 45m from the NSE 09:15 open', () => {
    const fifteen = bars('2026-09-17', 9, 15, [
      [100, 104, 99, 103],
      [103, 110, 102, 105],
      [105, 107, 100, 106],
      [106, 112, 105, 111],
      [111, 113, 108, 109],
      [109, 115, 107, 114],
    ]);
    const out = aggregateCandles(fifteen, 3);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: '2026-09-17T09:15:00+0530', open: 100, high: 110, low: 99, close: 106 });
    expect(out[1]).toMatchObject({ date: '2026-09-17T10:00:00+0530', open: 106, high: 115, low: 105, close: 114 });
  });

  it('aligns to the MCX 09:00 open without hardcoding it', () => {
    const fifteen = bars('2026-09-17', 9, 0, [
      [100, 104, 99, 103],
      [103, 110, 102, 105],
      [105, 107, 100, 106],
    ]);
    const [first] = aggregateCandles(fifteen, 3);
    expect(first!.date).toBe('2026-09-17T09:00:00+0530');
  });

  it('restarts buckets at each session instead of running across the gap', () => {
    const series = [
      // Two 15m bars only — day one ends on a short bucket.
      ...bars('2026-09-16', 9, 15, [
        [100, 101, 99, 100],
        [100, 102, 99, 101],
      ]),
      ...bars('2026-09-17', 9, 15, [
        [200, 204, 199, 203],
        [203, 210, 202, 205],
        [205, 207, 200, 206],
      ]),
    ];
    const out = aggregateCandles(series, 3);
    expect(out).toHaveLength(2);
    // Day one's short bucket must not absorb day two's opening bars.
    expect(out[0]).toMatchObject({ date: '2026-09-16T09:15:00+0530', open: 100, close: 101, high: 102 });
    expect(out[1]).toMatchObject({ date: '2026-09-17T09:15:00+0530', open: 200, close: 206 });
  });

  it('emits the trailing partial bucket so the forming bar stays visible', () => {
    const fifteen = bars('2026-09-17', 9, 15, [
      [100, 104, 99, 103],
      [103, 110, 102, 105],
      [105, 107, 100, 106],
      [106, 112, 105, 111], // start of an incomplete 45m bucket
    ]);
    const out = aggregateCandles(fifteen, 3);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ open: 106, high: 112, low: 105, close: 111 });
  });

  it('preserves the series when the group size is 1', () => {
    const fifteen = bars('2026-09-17', 9, 15, [
      [100, 104, 99, 103],
      [103, 110, 102, 105],
    ]);
    expect(aggregateCandles(fifteen, 1)).toEqual(fifteen);
  });

  it('never invents or loses price extremes', () => {
    const fifteen = bars('2026-09-17', 9, 15, [
      [100, 104, 99, 103],
      [103, 110, 102, 105],
      [105, 107, 95, 96],
      [96, 99, 90, 92],
      [92, 120, 91, 119],
    ]);
    const out = aggregateCandles(fifteen, 3);
    expect(Math.max(...out.map((c) => c.high))).toBe(Math.max(...fifteen.map((c) => c.high)));
    expect(Math.min(...out.map((c) => c.low))).toBe(Math.min(...fifteen.map((c) => c.low)));
    // First open and last close survive the fold.
    expect(out[0]!.open).toBe(fifteen[0]!.open);
    expect(out[out.length - 1]!.close).toBe(fifteen[fifteen.length - 1]!.close);
  });

  it('keeps candles in ascending time order', () => {
    const series = [
      ...bars('2026-09-16', 9, 15, [
        [100, 101, 99, 100],
        [100, 102, 99, 101],
        [101, 103, 100, 102],
        [102, 104, 101, 103],
      ]),
      ...bars('2026-09-17', 9, 15, [
        [200, 204, 199, 203],
        [203, 210, 202, 205],
      ]),
    ];
    const out = aggregateCandles(series, 3);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i]!.date > out[i - 1]!.date).toBe(true);
    }
  });

  it('handles an empty series and a degenerate group size', () => {
    expect(aggregateCandles([], 3)).toEqual([]);
    const fifteen = bars('2026-09-17', 9, 15, [[100, 104, 99, 103]]);
    expect(aggregateCandles(fifteen, 0)).toEqual(fifteen);
  });
});

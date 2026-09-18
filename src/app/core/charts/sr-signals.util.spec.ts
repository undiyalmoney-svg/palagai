import { describe, expect, it } from 'vitest';
import { Candle } from '../models/candle.model';
import { SrZone } from './sr-chart.util';
import { detectSrSignals } from './sr-signals.util';

function bar(o: number, h: number, l: number, c: number, i = 0): Candle {
  const mins = 9 * 60 + 15 + i * 15;
  const hm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return { date: `2026-09-17T${hm}:00+0530`, open: o, high: h, low: l, close: c, volume: 0 };
}

function series(rows: [number, number, number, number][]): Candle[] {
  return rows.map((r, i) => bar(r[0], r[1], r[2], r[3], i));
}

function support(lo: number, hi: number, fromIndex = 0, touches = 2): SrZone {
  return { lo, hi, mid: (lo + hi) / 2, kind: 'support', touches, fromIndex };
}

function resistance(lo: number, hi: number, fromIndex = 0, touches = 2): SrZone {
  return { lo, hi, mid: (lo + hi) / 2, kind: 'resistance', touches, fromIndex };
}

describe('detectSrSignals', () => {
  it('buys a candle that dips into support and closes back above it', () => {
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);
    const signals = detectSrSignals(candles, [support(99, 101)], 1);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ index: 1, side: 'BUY', kind: 'bounce' });
    // The arrow hangs off the low it rejected from, not the close.
    expect(signals[0]!.price).toBe(99);
  });

  it('sells a candle that pushes into resistance and closes back below it', () => {
    const candles = series([
      [100, 101, 99, 100],
      [100, 106, 99, 99],
    ]);
    const signals = detectSrSignals(candles, [resistance(104, 106)], 1);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ index: 1, side: 'SELL', kind: 'rejection' });
    expect(signals[0]!.price).toBe(106);
  });

  it('buys a close clear above a resistance band the bar opened under', () => {
    const candles = series([
      [100, 101, 99, 100],
      [100, 108, 100, 107],
    ]);
    const signals = detectSrSignals(candles, [resistance(104, 106)], 1);

    expect(signals[0]).toMatchObject({ index: 1, side: 'BUY', kind: 'breakout' });
  });

  it('sells a close that gives up a support band it was holding', () => {
    const candles = series([
      [100, 101, 99, 100],
      [100, 100, 94, 95],
    ]);
    const signals = detectSrSignals(candles, [support(98, 99)], 1);

    expect(signals[0]).toMatchObject({ index: 1, side: 'SELL', kind: 'breakdown' });
  });

  it('ignores a level that had not formed yet at that bar', () => {
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);
    // Formed on the very bar it would have signalled: the swing that made the
    // level is only visible in hindsight, so it cannot have acted here.
    expect(detectSrSignals(candles, [support(99, 101, 1)], 1)).toEqual([]);
  });

  it('reads a red bar with a long tail as a bounce', () => {
    // Opened 105, closed 104 — red, but it wicked to 99 and finished near its
    // high, which is the level being defended.
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);

    expect(detectSrSignals(candles, [support(99, 101)], 1)[0]).toMatchObject({
      kind: 'bounce',
    });
  });

  it('skips a flat bar idling against a band', () => {
    const candles = series([
      [102, 102.5, 101.5, 102],
      [101.2, 101.6, 100.9, 101.5],
    ]);

    // Range 0.7 against a 10-point ATR: nothing was tested here.
    expect(detectSrSignals(candles, [support(99, 101)], 10)).toEqual([]);
    // The same bar counts on an instrument that only moves that far.
    expect(detectSrSignals(candles, [support(99, 101)], 0.5)).toHaveLength(1);
  });

  it('reports the best tested level when a bar sits against several', () => {
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);
    const signals = detectSrSignals(
      candles,
      [support(99, 101, 0, 2), support(98.5, 101.5, 0, 5)],
      1,
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]!.strength).toBe(5);
  });

  it('holds a same-side signal off until the cooldown has passed', () => {
    // Three consecutive bounces off one band; only the spaced ones survive.
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
      [104, 106, 99, 105],
      [105, 106, 99, 104],
      [104, 105, 103, 104],
      [104, 106, 99, 105],
    ]);
    const signals = detectSrSignals(candles, [support(99, 101)], 1, { cooldownBars: 3 });

    expect(signals.map((s) => s.index)).toEqual([1, 5]);
  });

  it('keeps the newest signals when capped', () => {
    const rows: [number, number, number, number][] = [[105, 106, 104, 105]];
    for (let i = 0; i < 10; i += 1) {
      rows.push([105, 106, 99, 104], [104, 105, 103, 104], [104, 105, 103, 104]);
    }
    const candles = series(rows);
    const signals = detectSrSignals(candles, [support(99, 101)], 1, { maxSignals: 3 });

    expect(signals).toHaveLength(3);
    // Newest-first thinning, returned back in chart order.
    expect(signals.map((s) => s.index)).toEqual([...signals.map((s) => s.index)].sort((a, b) => a - b));
    expect(signals[signals.length - 1]!.index).toBeGreaterThan(candles.length - 6);
  });

  it('returns nothing without candles or zones', () => {
    expect(detectSrSignals([], [support(99, 101)], 1)).toEqual([]);
    expect(detectSrSignals(series([[100, 101, 99, 100]]), [], 1)).toEqual([]);
  });

  it('annotates without ATR rather than drawing nothing', () => {
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);

    expect(detectSrSignals(candles, [support(99, 101)], null)).toHaveLength(1);
  });
});

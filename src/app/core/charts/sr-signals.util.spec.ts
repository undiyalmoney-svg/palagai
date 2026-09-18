import { describe, expect, it } from 'vitest';
import { Candle } from '../models/candle.model';
import { SrZone } from './sr-chart.util';
import {
  CONFIDENCE_CEILING,
  CONFIDENCE_FLOOR,
  confidenceBand,
  detectSrSignals,
  scoreConfidence,
  zoneRoleAt,
} from './sr-signals.util';

function bar(o: number, h: number, l: number, c: number, i = 0, volume = 0): Candle {
  const mins = 9 * 60 + 15 + i * 15;
  const hm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return { date: `2026-09-17T${hm}:00+0530`, open: o, high: h, low: l, close: c, volume };
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

  it('prefers the better-scoring level, not merely the better-touched one', () => {
    // A shallow poke at a five-touch band versus a decisive recovery off a
    // two-touch one. The zones overlap, so the same bar qualifies on both.
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);
    const signals = detectSrSignals(
      candles,
      [support(99, 101, 0, 2), support(90, 91, 0, 5)],
      1,
    );

    // The distant five-touch band was never traded into, so it cannot fire at
    // all; only the level the bar actually tested is annotated.
    expect(signals).toHaveLength(1);
    expect(signals[0]!.strength).toBe(2);
  });

  it('drops signals under a requested confidence floor', () => {
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);
    const all = detectSrSignals(candles, [support(99, 101)], 1);

    expect(all).toHaveLength(1);
    expect(
      detectSrSignals(candles, [support(99, 101)], 1, {
        minConfidence: all[0]!.confidence + 1,
      }),
    ).toEqual([]);
  });

  it('keeps a historical SELL rejection after price has broken above the band', () => {
    // Last close is above the band, so the box is currently drawn as support.
    // The earlier rejection from below must still read SELL, or the arrows
    // flip every time price crosses the level.
    const candles = series([
      [100, 101, 99, 100],
      [100, 106, 99, 99],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 108, 100, 107],
      [107, 110, 108, 109],
    ]);
    const signals = detectSrSignals(candles, [support(104, 106)], 1);

    expect(signals.some((s) => s.side === 'SELL' && s.kind === 'rejection' && s.index === 1)).toBe(
      true,
    );
    expect(signals.some((s) => s.side === 'BUY' && s.kind === 'breakout' && s.index === 5)).toBe(
      true,
    );
  });

  it('does not mark the forming candle', () => {
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);
    // i=1 is 09:30; a 15m bar stamped 09:30 is only closed at 09:45.
    const now = new Date('2026-09-17T09:32:00+05:30');
    expect(detectSrSignals(candles, [support(99, 101)], 1).map((s) => s.index)).toContain(1);
    expect(
      detectSrSignals(candles, [support(99, 101)], 1, { intervalMinutes: 15, now }).map(
        (s) => s.index,
      ),
    ).not.toContain(1);
  });

  it('marks a bounce once that bar has closed', () => {
    const candles = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);
    const signals = detectSrSignals(candles, [support(99, 101)], 1, {
      intervalMinutes: 15,
      now: new Date('2026-09-17T09:46:00+05:30'),
    });
    expect(signals[0]).toMatchObject({ index: 1, side: 'BUY', kind: 'bounce' });
  });
});

describe('scoreConfidence', () => {
  const bounceBar = bar(105, 106, 99, 104);

  function score(overrides: Partial<Parameters<typeof scoreConfidence>[0]> = {}) {
    return scoreConfidence({
      bar: bounceBar,
      zone: support(99, 101),
      kind: 'bounce',
      side: 'BUY',
      atr: 1,
      volumeBaseline: null,
      ...overrides,
    });
  }

  it('reports inside the band it promises', () => {
    const { confidence } = score();
    expect(confidence).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
    expect(confidence).toBeLessThanOrEqual(CONFIDENCE_CEILING);
  });

  it('weights the factors it used to exactly one whole', () => {
    const { factors } = score();
    const total = factors.reduce((sum, f) => sum + f.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('rebuilds the percentage from its own factor breakdown', () => {
    const { confidence, factors } = score();
    const raw = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
    expect(Math.round(CONFIDENCE_FLOOR + raw * (CONFIDENCE_CEILING - CONFIDENCE_FLOOR))).toBe(
      confidence,
    );
  });

  it('rates a well-tested level above a one-touch line', () => {
    const once = score({ zone: support(99, 101, 0, 1), peerTouches: 8 }).confidence;
    const often = score({ zone: support(99, 101, 0, 8), peerTouches: 8 }).confidence;
    expect(often).toBeGreaterThan(once);
  });

  it('ranks a level against the others on the same chart', () => {
    // Six touches is the best band on a quiet chart and an also-ran on a busy
    // one, and the score says so rather than reading the same on both.
    const bestOnChart = score({ zone: support(99, 101, 0, 6), peerTouches: 6 });
    const alsoRan = score({ zone: support(99, 101, 0, 6), peerTouches: 20 });
    expect(bestOnChart.confidence).toBeGreaterThan(alsoRan.confidence);
  });

  it('will not call the best of a set of untested lines a strong level', () => {
    // Top band on the chart, but touched twice: relative standing is 100% and
    // the absolute backstop is what has to win.
    const { factors } = score({ zone: support(99, 101, 0, 2), peerTouches: 2 });
    expect(factors.find((f) => f.key === 'level')!.score).toBe(0.5);
  });

  it('rates a close on the high above one that limped back over the band', () => {
    const strong = score({ bar: bar(105, 106, 99, 106) }).confidence;
    const weak = score({ bar: bar(105, 106, 99, 101.5) }).confidence;
    expect(strong).toBeGreaterThan(weak);
  });

  it('rates a breakout that cleared the band above one that grazed it', () => {
    const clear = scoreConfidence({
      bar: bar(100, 108, 100, 107),
      zone: resistance(104, 106),
      kind: 'breakout',
      side: 'BUY',
      atr: 1,
      volumeBaseline: null,
    }).confidence;
    const graze = scoreConfidence({
      bar: bar(100, 108, 100, 106.05),
      zone: resistance(104, 106),
      kind: 'breakout',
      side: 'BUY',
      atr: 1,
      volumeBaseline: null,
    }).confidence;
    expect(clear).toBeGreaterThan(graze);
  });

  it('counts volume when the instrument reports it', () => {
    const quiet = score({ bar: bar(105, 106, 99, 104, 0, 100), volumeBaseline: 1000 }).confidence;
    const heavy = score({ bar: bar(105, 106, 99, 104, 0, 5000), volumeBaseline: 1000 }).confidence;
    expect(heavy).toBeGreaterThan(quiet);
  });

  it('leaves volume out entirely on an index, which reports none', () => {
    const { factors } = score({ bar: bar(105, 106, 99, 104, 0, 0), volumeBaseline: 1000 });
    expect(factors.map((f) => f.key)).not.toContain('volume');
    expect(factors.reduce((sum, f) => sum + f.weight, 0)).toBeCloseTo(1, 10);
  });

  it('stays neutral on bar size when there is no ATR to measure against', () => {
    const { factors } = score({ atr: null });
    expect(factors.find((f) => f.key === 'range')!.score).toBe(0.5);
  });

  it('leads with the factor that carried the most of the score', () => {
    const { factors } = score();
    const contributions = factors.map((f) => f.score * f.weight);
    expect(contributions).toEqual([...contributions].sort((a, b) => b - a));
  });
});

describe('confidenceBand', () => {
  it('splits low, medium and high at the documented marks', () => {
    expect(confidenceBand(54)).toBe('low');
    expect(confidenceBand(55)).toBe('medium');
    expect(confidenceBand(74)).toBe('medium');
    expect(confidenceBand(75)).toBe('high');
  });
});

describe('zoneRoleAt', () => {
  it('treats a band below the previous close as support and one above as resistance', () => {
    expect(zoneRoleAt(bar(105, 106, 104, 105), support(99, 101))).toBe('support');
    expect(zoneRoleAt(bar(100, 101, 99, 100), resistance(104, 106))).toBe('resistance');
  });

  it('does not follow the zone label when last price has crossed the band', () => {
    // Drawn as support because price is now above it, but this bar approached
    // from below, so it is a resistance test.
    expect(zoneRoleAt(bar(100, 101, 99, 100), support(104, 106))).toBe('resistance');
  });
});

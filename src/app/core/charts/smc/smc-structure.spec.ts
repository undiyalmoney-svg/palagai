import { describe, expect, it } from 'vitest';
import { StructureTracker } from './smc-structure';
import { walk } from './smc-test-utils';

const OPTS = {
  swingLength: 3,
  atrPeriod: 14,
  eqTolAtr: 0.1,
  eqLookbackSwings: 6,
  breakBufferAtr: 0,
  rangeSwings: 4,
  sidewaysRangeAtr: 0.5,
};

function run(points: number[], perLeg = 6, opts = OPTS) {
  const tracker = new StructureTracker(opts);
  for (const bar of walk(points, perLeg)) tracker.step(bar);
  return tracker;
}

describe('StructureTracker swings', () => {
  it('confirms a swing exactly swingLength bars after its pivot', () => {
    const tracker = run([100, 110, 102, 112, 104]);
    const high = tracker.swings.find((s) => s.kind === 'high')!;
    expect(high.confirmedAt).toBe(high.index + OPTS.swingLength);
  });

  it('never reports a swing before its confirmation bar', () => {
    const bars = walk([100, 110, 102, 112, 104, 114], 6);
    const tracker = new StructureTracker(OPTS);
    for (const bar of bars) {
      const step = tracker.step(bar);
      const i = tracker.bars.length - 1;
      for (const swing of step.swings) {
        expect(swing.confirmedAt).toBe(i);
        expect(swing.index).toBe(i - OPTS.swingLength);
      }
    }
  });

  it('labels higher highs / higher lows in an uptrend', () => {
    const tracker = run([100, 110, 103, 116, 108, 122, 113, 128]);
    const highs = tracker.swings.filter((s) => s.kind === 'high').map((s) => s.label);
    const lows = tracker.swings.filter((s) => s.kind === 'low').map((s) => s.label);
    expect(highs.filter(Boolean).every((l) => l === 'HH')).toBe(true);
    expect(lows.filter(Boolean).every((l) => l === 'HL')).toBe(true);
    expect(highs.length).toBeGreaterThan(1);
    expect(lows.length).toBeGreaterThan(1);
  });

  it('labels lower highs / lower lows in a downtrend', () => {
    const tracker = run([130, 120, 127, 112, 119, 104, 110, 96]);
    const highs = tracker.swings.filter((s) => s.kind === 'high').map((s) => s.label);
    const lows = tracker.swings.filter((s) => s.kind === 'low').map((s) => s.label);
    expect(highs.filter(Boolean).every((l) => l === 'LH')).toBe(true);
    expect(lows.filter(Boolean).every((l) => l === 'LL')).toBe(true);
    expect(tracker.structureText()).toBe('LH / LL');
  });

  it('flags equal highs and lows inside the tolerance', () => {
    const tracker = run([100, 110, 102, 110.05, 101, 109.9, 100.02, 108], 6);
    expect(tracker.equalLevels.some((e) => e.kind === 'EQH')).toBe(true);
    expect(tracker.swings.some((s) => s.label === 'EQH')).toBe(true);
  });
});

describe('StructureTracker breaks and trend', () => {
  it('calls the first break a BOS and a later reversal a CHoCH', () => {
    const tracker = run([100, 110, 104, 118, 108, 126, 96, 90, 100, 84], 6);
    const kinds = tracker.events.map((e) => `${e.kind}:${e.dir}`);
    expect(kinds[0]).toBe('BOS:bull');
    expect(kinds).toContain('CHoCH:bear');
    const firstBear = tracker.events.findIndex((e) => e.dir === 'bear');
    expect(tracker.events[firstBear]!.kind).toBe('CHoCH');
  });

  it('needs a CLOSE through the swing — a wick does not break it', () => {
    const bars = walk([100, 110, 102, 109], 6);
    const tracker = new StructureTracker(OPTS);
    for (const bar of bars) tracker.step(bar);
    const spike = { ...bars[bars.length - 1]!, high: 130, close: 108, open: 108, low: 107 };
    tracker.step(spike);
    expect(tracker.events).toHaveLength(0);
    tracker.step({ ...spike, open: 108, high: 112, close: 111, low: 108 });
    expect(tracker.events.map((e) => e.kind)).toEqual(['BOS']);
  });

  it('reads bullish after a bullish break and bearish after a bearish CHoCH', () => {
    const up = run([100, 110, 102, 120, 108, 132, 115, 142], 6);
    expect(up.trend).toBe('bullish');
    const down = run([142, 130, 138, 118, 126, 100, 110, 88], 6);
    expect(down.trend).toBe('bearish');
  });

  it('reads sideways before any break and in a tight compression', () => {
    const tracker = new StructureTracker(OPTS);
    expect(tracker.trend).toBe('sideways');
    const flat = new StructureTracker({ ...OPTS, sidewaysRangeAtr: 6 });
    for (const bar of walk([100, 104, 101, 105, 100.5, 104.5, 101, 105], 6)) flat.step(bar);
    expect(flat.trend).toBe('sideways');
  });

  it('never rewrites the trend recorded on a past bar', () => {
    const bars = walk([100, 110, 102, 120, 108, 132, 96, 90, 100, 84], 6);
    const tracker = new StructureTracker(OPTS);
    const seen: string[] = [];
    for (const bar of bars) {
      tracker.step(bar);
      seen.push(tracker.trend);
      expect(tracker.trendAt.slice(0, seen.length)).toEqual(seen);
    }
  });
});

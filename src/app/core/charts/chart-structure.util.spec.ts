import { describe, expect, it } from 'vitest';
import { Candle } from '../models/candle.model';
import { SrZone } from './sr-chart.util';
import {
  canAutoEnter,
  chartStructureKey,
  detectAllChartStructures,
  detectChartStructure,
  optionStopTrigger,
  optionTargetPremium,
  structureResolvedIndex,
} from './chart-structure.util';

function bar(o: number, h: number, l: number, c: number, i = 0): Candle {
  const mins = 9 * 60 + 15 + i * 15;
  const hm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return { date: `2026-09-17T${hm}:00+0530`, open: o, high: h, low: l, close: c, volume: 0 };
}

function series(rows: [number, number, number, number][]): Candle[] {
  return rows.map((r, i) => bar(r[0], r[1], r[2], r[3], i));
}

function support(lo: number, hi: number, fromIndex = 0, touches = 3): SrZone {
  return { lo, hi, mid: (lo + hi) / 2, kind: 'support', touches, fromIndex };
}

function resistance(lo: number, hi: number, fromIndex = 0, touches = 3): SrZone {
  return { lo, hi, mid: (lo + hi) / 2, kind: 'resistance', touches, fromIndex };
}

describe('detectChartStructure', () => {
  it('draws a CE 1:1 box on a resistance break: teal above pink, equal height', () => {
    const candles = series([
      [100, 101, 96, 100],
      [100, 102, 97, 101],
      [101, 103, 98, 102],
      [102, 110, 102, 109],
    ]);
    const box = detectChartStructure(candles, [resistance(104, 106)], 2);

    expect(box).toMatchObject({
      option: 'CE',
      dir: 1,
      wall: 106,
      sl: 96,
      entry: 106,
      exit: 116,
      height: 10,
      breakIndex: 3,
      fresh: true,
      status: 'live',
    });
    expect(box!.pink).toMatchObject({ lo: 96, hi: 106 });
    expect(box!.teal).toMatchObject({ lo: 106, hi: 116 });
    expect(box!.teal.hi - box!.teal.lo).toBe(box!.pink.hi - box!.pink.lo);
  });

  it('draws a PE 1:1 box on a support break: pink above teal, equal height', () => {
    const candles = series([
      [105, 112, 104, 105],
      [104, 110, 103, 104],
      [103, 108, 102, 103],
      [103, 103, 94, 95],
    ]);
    const box = detectChartStructure(candles, [support(98, 100)], 2);

    expect(box).toMatchObject({
      option: 'PE',
      dir: -1,
      wall: 98,
      sl: 112,
      entry: 98,
      exit: 84,
      height: 14,
      breakIndex: 3,
      fresh: true,
    });
    expect(box!.pink).toMatchObject({ lo: 98, hi: 112 });
    expect(box!.teal).toMatchObject({ lo: 84, hi: 98 });
    expect(box!.pink.hi - box!.pink.lo).toBe(box!.teal.hi - box!.teal.lo);
  });

  it('keeps the latest break, not an older one', () => {
    const candles = series([
      [100, 101, 96, 100],
      [100, 110, 100, 109],
      [109, 110, 108, 109],
      [109, 109, 94, 95],
    ]);
    const box = detectChartStructure(
      candles,
      [resistance(104, 106, 0), support(98, 100, 0)],
      2,
    );
    expect(box).toMatchObject({ option: 'PE', breakIndex: 3, wall: 98 });
  });

  it('ignores bounce and rejection — only a close through the wall counts', () => {
    const bounce = series([
      [105, 106, 104, 105],
      [105, 106, 99, 104],
    ]);
    expect(detectChartStructure(bounce, [support(99, 101)], 1)).toBeNull();

    const rejection = series([
      [100, 101, 99, 100],
      [100, 106, 99, 99],
    ]);
    expect(detectChartStructure(rejection, [resistance(104, 106)], 1)).toBeNull();
  });

  it('skips a forming candle so the box does not flip every poll', () => {
    const candles = series([
      [100, 101, 96, 100],
      [100, 102, 97, 101],
      [102, 110, 102, 109],
    ]);
    // Last bar stamped 09:45 on 15m is still open at 09:50.
    const now = new Date('2026-09-17T09:50:00+05:30');
    expect(
      detectChartStructure(candles, [resistance(104, 106)], 2, {
        intervalMinutes: 15,
        now,
      }),
    ).toBeNull();

    const closed = new Date('2026-09-17T10:01:00+05:30');
    const box = detectChartStructure(candles, [resistance(104, 106)], 2, {
      intervalMinutes: 15,
      now: closed,
    });
    expect(box).toMatchObject({ option: 'CE', breakIndex: 2, fresh: true });
  });

  it('does not mark SL hit just because the break bar printed the adverse wick', () => {
    const candles = series([
      [105, 108, 104, 105],
      [104, 107, 103, 104],
      [103, 112, 94, 95],
    ]);
    const box = detectChartStructure(candles, [support(98, 100)], 2);
    expect(box).toMatchObject({
      option: 'PE',
      sl: 112,
      status: 'live',
      fresh: true,
    });
    expect(canAutoEnter(box)).toBe(true);
  });

  it('marks SL hit when price trades back through the pink far edge', () => {
    const candles = series([
      [100, 101, 96, 100],
      [100, 102, 97, 101],
      [102, 110, 102, 109],
      // Wick the CE stop without closing back through the wall as a new PE.
      [108, 108, 95, 107],
    ]);
    const box = detectChartStructure(candles, [resistance(104, 106)], 2);
    expect(box).toMatchObject({ status: 'hit_sl', fresh: false, breakIndex: 2, option: 'CE' });
  });

  it('marks EXIT hit when price reaches the teal far edge', () => {
    const candles = series([
      [100, 101, 96, 100],
      [100, 102, 97, 101],
      [102, 110, 102, 109],
      [110, 117, 109, 116],
    ]);
    const box = detectChartStructure(candles, [resistance(104, 106)], 2);
    expect(box).toMatchObject({ status: 'hit_exit', exit: 116 });
  });

  it('does not treat a tiny poke through a thin band as a 1R box', () => {
    const candles = series([
      [100, 101, 99.8, 100],
      [100, 101.2, 99.9, 101.1],
    ]);
    expect(detectChartStructure(candles, [resistance(100.5, 101)], 10)).toBeNull();
  });
});

describe('structureResolvedIndex', () => {
  it('returns the bar that tagged SL', () => {
    const candles = series([
      [100, 101, 96, 100],
      [102, 110, 102, 109],
      [108, 108, 95, 107],
    ]);
    const box = detectChartStructure(candles, [resistance(104, 106)], 2)!;
    expect(box.status).toBe('hit_sl');
    expect(structureResolvedIndex(box, candles)).toBe(2);
  });
});

describe('detectAllChartStructures', () => {
  it('keeps every 1:1 break on the series, latest last', () => {
    const candles = series([
      [100, 101, 96, 100],
      [100, 110, 100, 109],
      [109, 110, 108, 109],
      [109, 109, 94, 95],
    ]);
    const all = detectAllChartStructures(
      candles,
      [resistance(104, 106, 0), support(98, 100, 0)],
      2,
    );
    expect(all.map((box) => box.option)).toEqual(['CE', 'PE']);
    expect(all[0]).toMatchObject({ breakIndex: 1, option: 'CE', fresh: false });
    expect(all[1]).toMatchObject({ breakIndex: 3, option: 'PE', fresh: true });
    expect(detectChartStructure(candles, [resistance(104, 106, 0), support(98, 100, 0)], 2)).toEqual(
      all[1],
    );
  });
});

describe('canAutoEnter', () => {
  it('fires only on a live fresh break', () => {
    const live = detectChartStructure(
      series([
        [100, 101, 96, 100],
        [102, 110, 102, 109],
      ]),
      [resistance(104, 106)],
      2,
    );
    expect(canAutoEnter(live)).toBe(true);

    const later = detectChartStructure(
      series([
        [100, 101, 96, 100],
        [102, 110, 102, 109],
        [109, 110, 108, 109],
      ]),
      [resistance(104, 106)],
      2,
    );
    expect(canAutoEnter(later)).toBe(false);
    expect(canAutoEnter(null)).toBe(false);
  });
});

describe('chartStructureKey', () => {
  it('is stable for the same break and distinct per book', () => {
    const box = detectChartStructure(
      series([
        [100, 101, 96, 100],
        [102, 110, 102, 109],
      ]),
      [resistance(104, 106)],
      2,
    )!;
    expect(chartStructureKey('nifty', box)).not.toBe(chartStructureKey('bank', box));
    expect(chartStructureKey('nifty', box)).toBe(chartStructureKey('nifty', box));
  });
});

describe('optionStopTrigger', () => {
  it('uses half the index height as ATM option risk', () => {
    expect(optionStopTrigger(200, 80, 0.05)).toBe(160);
  });

  it('never rests at or above the fill, and never at zero', () => {
    expect(optionStopTrigger(100, 500, 0.05)).toBe(20);
    expect(optionStopTrigger(10, 1, 0.05)).toBeLessThan(10);
    expect(optionStopTrigger(10, 1, 0.05)).toBeGreaterThan(0);
  });

  it('refuses a useless fill', () => {
    expect(optionStopTrigger(0, 80)).toBeNull();
    expect(optionStopTrigger(200, 0)).toBeNull();
  });
});

describe('optionTargetPremium', () => {
  it('books 0.5R as a quarter of the index height on the ATM premium', () => {
    expect(optionTargetPremium(200, 80, 0.5, 0.05)).toBe(220);
  });

  it('never rests at or below the fill', () => {
    expect(optionTargetPremium(10, 0.01, 0.5, 0.05)).toBeGreaterThan(10);
  });

  it('refuses a useless fill', () => {
    expect(optionTargetPremium(0, 80)).toBeNull();
    expect(optionTargetPremium(200, 0)).toBeNull();
  });
});

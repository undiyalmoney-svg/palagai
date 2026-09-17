import { describe, expect, it } from 'vitest';
import { Candle } from '../models/candle.model';
import { detectSwingHighs, detectSwingLows } from '../strategy-engine/utils/swing-level.util';
import {
  averageTrueRange,
  buildLinks,
  buildSrChartModel,
  clusterZones,
  detectPivots,
  previousSessionClose,
  SrPivot,
} from './sr-chart.util';

function bar(date: string, o: number, h: number, l: number, c: number): Candle {
  return { date, open: o, high: h, low: l, close: c, volume: 0 };
}

/** 15m bars on one session, `hm` minutes apart from 09:15. */
function series(prices: [number, number, number, number][], day = '2026-09-17'): Candle[] {
  return prices.map(([o, h, l, c], i) => {
    const mins = 9 * 60 + 15 + i * 15;
    const hm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    return bar(`${day}T${hm}:00+0530`, o, h, l, c);
  });
}

describe('detectPivots', () => {
  it('agrees with the strategy engine fractal at strength 2', () => {
    const candles = series([
      [100, 102, 99, 101],
      [101, 104, 100, 103],
      [103, 110, 102, 109],
      [109, 106, 104, 105],
      [105, 105, 100, 101],
      [101, 103, 95, 96],
      [96, 99, 94, 98],
      [98, 101, 97, 100],
      [100, 104, 99, 103],
    ]);

    const pivots = detectPivots(candles, 2);
    const highs = pivots.filter((p) => p.kind === 'high').map((p) => p.index);
    const lows = pivots.filter((p) => p.kind === 'low').map((p) => p.index);

    expect(highs).toEqual(detectSwingHighs(candles).map((s) => s.index));
    expect(lows).toEqual(detectSwingLows(candles).map((s) => s.index));
  });

  it('finds the obvious swing high and swing low', () => {
    const candles = series([
      [100, 101, 99, 100],
      [100, 102, 99, 101],
      [101, 110, 100, 109], // peak
      [109, 105, 103, 104],
      [104, 104, 102, 103],
      [103, 103, 90, 91], // trough
      [91, 96, 92, 95],
      [95, 99, 94, 98],
      [98, 100, 96, 99],
    ]);
    const pivots = detectPivots(candles, 2);
    expect(pivots.find((p) => p.kind === 'high')).toMatchObject({ index: 2, price: 110 });
    expect(pivots.find((p) => p.kind === 'low')).toMatchObject({ index: 5, price: 90 });
  });

  it('never reports a pivot inside the edge margin', () => {
    const candles = series([
      [100, 120, 80, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 120, 80, 100],
    ]);
    for (const p of detectPivots(candles, 2)) {
      expect(p.index).toBeGreaterThanOrEqual(2);
      expect(p.index).toBeLessThanOrEqual(candles.length - 3);
    }
  });

  it('returns nothing when the series is shorter than the fractal', () => {
    expect(detectPivots(series([[100, 101, 99, 100]]), 2)).toEqual([]);
    expect(detectPivots([], 2)).toEqual([]);
  });
});

describe('clusterZones', () => {
  const pivot = (index: number, price: number, kind: 'high' | 'low' = 'high'): SrPivot => ({
    index,
    price,
    kind,
    date: '2026-09-17T10:00:00+0530',
  });

  it('merges pivots within tolerance into one banded zone', () => {
    const zones = clusterZones([pivot(2, 100), pivot(9, 101), pivot(15, 100.5)], 90, 2);
    expect(zones).toHaveLength(1);
    const [zone] = zones;
    expect(zone!.touches).toBe(3);
    // The three touches span 1.0, narrower than the 2.0 band, so the box is
    // padded out to the full band and still brackets every touch.
    expect(zone!.hi - zone!.lo).toBeCloseTo(2, 5);
    expect(zone!.lo).toBeLessThanOrEqual(100);
    expect(zone!.hi).toBeGreaterThanOrEqual(101);
    expect(zone!.mid).toBeCloseTo(100.5, 5);
    // Box is drawn from the earliest touch.
    expect(zone!.fromIndex).toBe(2);
  });

  it('keeps the band at the pivot spread once the cluster is wider than tolerance', () => {
    // Touches chain 100 → 101.5 → 102.5 within a 2.0 band, so the cluster ends
    // up 2.5 wide and needs no padding.
    const [zone] = clusterZones([pivot(2, 100), pivot(9, 101.5), pivot(15, 102.5)], 90, 2);
    expect(zone!.touches).toBe(3);
    expect(zone!.lo).toBeCloseTo(100, 5);
    expect(zone!.hi).toBeCloseTo(102.5, 5);
  });

  it('never lets a chain of touches drift a zone past 1.5 bands', () => {
    // A long ladder of pivots one step apart would otherwise walk one zone
    // across the whole range as its midpoint kept moving.
    const ladder = Array.from({ length: 30 }, (_, i) => pivot(i * 2 + 2, 100 + i));
    const zones = clusterZones(ladder, 90, 4);
    expect(zones.length).toBeGreaterThan(1);
    for (const zone of zones) {
      expect(zone.hi - zone.lo).toBeLessThanOrEqual(4 * 1.5 + 1e-9);
    }
    // Every touch still lands in exactly one zone.
    expect(zones.reduce((n, z) => n + z.touches, 0)).toBe(ladder.length);
  });

  it('keeps pivots further apart than tolerance separate', () => {
    const zones = clusterZones([pivot(2, 100), pivot(9, 130)], 90, 2);
    expect(zones).toHaveLength(2);
  });

  it('gives a single-touch level the full band so it stays visible', () => {
    const [zone] = clusterZones([pivot(4, 100)], 90, 4);
    expect(zone!.hi - zone!.lo).toBeCloseTo(4, 5);
    expect(zone!.mid).toBeCloseTo(100, 5);
  });

  it('labels zones above price as resistance and below as support', () => {
    const zones = clusterZones([pivot(2, 120), pivot(9, 80, 'low')], 100, 2);
    expect(zones.find((z) => z.mid > 100)?.kind).toBe('resistance');
    expect(zones.find((z) => z.mid < 100)?.kind).toBe('support');
  });

  it('is empty for no pivots', () => {
    expect(clusterZones([], 100, 2)).toEqual([]);
  });
});

describe('buildLinks', () => {
  const pivots: SrPivot[] = [
    { index: 2, price: 110, kind: 'high', date: 'd' },
    { index: 8, price: 108, kind: 'high', date: 'd' },
    { index: 14, price: 104, kind: 'high', date: 'd' },
    { index: 5, price: 90, kind: 'low', date: 'd' },
    { index: 11, price: 94, kind: 'low', date: 'd' },
  ];

  it('joins consecutive pivots of the same kind in time order', () => {
    const links = buildLinks(pivots, 4);
    const highs = links.filter((l) => l.kind === 'high');
    expect(highs).toEqual([
      { kind: 'high', fromIndex: 2, fromPrice: 110, toIndex: 8, toPrice: 108 },
      { kind: 'high', fromIndex: 8, fromPrice: 108, toIndex: 14, toPrice: 104 },
    ]);
    expect(links.filter((l) => l.kind === 'low')).toHaveLength(1);
  });

  it('never links a high to a low', () => {
    for (const link of buildLinks(pivots, 4)) {
      const from = pivots.find((p) => p.index === link.fromIndex && p.price === link.fromPrice);
      const to = pivots.find((p) => p.index === link.toIndex && p.price === link.toPrice);
      expect(from?.kind).toBe(link.kind);
      expect(to?.kind).toBe(link.kind);
    }
  });

  it('keeps only the most recent pivots per side', () => {
    const many: SrPivot[] = Array.from({ length: 8 }, (_, i) => ({
      index: i * 3,
      price: 100 + i,
      kind: 'high' as const,
      date: 'd',
    }));
    const links = buildLinks(many, 3);
    expect(links).toHaveLength(2);
    expect(links[0]!.fromIndex).toBe(15);
  });

  it('produces nothing from a single pivot', () => {
    expect(buildLinks([pivots[0]!], 4)).toEqual([]);
  });
});

describe('previousSessionClose', () => {
  it('uses the last bar of the earlier session', () => {
    const candles = [
      ...series([[100, 101, 99, 100], [100, 102, 99, 98]], '2026-09-16'),
      ...series([[99, 105, 98, 104]], '2026-09-17'),
    ];
    expect(previousSessionClose(candles)).toBe(98);
  });

  it('falls back to the first open within a single session', () => {
    expect(previousSessionClose(series([[100, 101, 99, 100], [100, 102, 99, 101]]))).toBe(100);
  });

  it('is null for an empty series', () => {
    expect(previousSessionClose([])).toBeNull();
  });
});

describe('averageTrueRange', () => {
  it('averages true range over the window', () => {
    const candles = series([
      [100, 110, 100, 105],
      [105, 112, 102, 110],
      [110, 115, 105, 112],
    ]);
    // TR2 = max(10, |112-105|, |102-105|) = 10; TR3 = max(10, 3, 7) = 10
    expect(averageTrueRange(candles, 14)).toBeCloseTo(10, 5);
  });

  it('is null when there is nothing to range over', () => {
    expect(averageTrueRange([], 14)).toBeNull();
    expect(averageTrueRange(series([[100, 101, 99, 100]]), 14)).toBeNull();
  });
});

describe('buildSrChartModel', () => {
  const trending = series(
    Array.from({ length: 40 }, (_, i) => {
      const base = 9_700 - i * 4;
      const wave = Math.sin(i / 2) * 25;
      const o = base + wave;
      return [o, o + 18, o - 18, o + wave / 3] as [number, number, number, number];
    }),
  );

  it('returns an empty model for no candles', () => {
    const model = buildSrChartModel([]);
    expect(model.zones).toEqual([]);
    expect(model.links).toEqual([]);
    expect(model.last).toBeNull();
    expect(model.changePct).toBeNull();
  });

  it('reports the last bar and its change against the prior session', () => {
    const candles = [
      ...series([[100, 101, 99, 100]], '2026-09-16'),
      ...series([[100, 106, 99, 105]], '2026-09-17'),
    ];
    const model = buildSrChartModel(candles);
    expect(model.last).toMatchObject({ index: 1, price: 105 });
    expect(model.changeAbs).toBeCloseTo(5, 5);
    expect(model.changePct).toBeCloseTo(5, 5);
  });

  it('honours the zone cap, strongest first', () => {
    const model = buildSrChartModel(trending, { maxZones: 3 });
    expect(model.zones.length).toBeLessThanOrEqual(3);
    const touches = model.zones.map((z) => z.touches);
    expect([...touches].sort((a, b) => b - a)).toEqual(touches);
  });

  it('builds zones that bracket a real price and sit on the right side of it', () => {
    const model = buildSrChartModel(trending);
    const last = model.last!.price;
    for (const zone of model.zones) {
      expect(zone.hi).toBeGreaterThanOrEqual(zone.lo);
      expect(zone.mid).toBeGreaterThan(0);
      expect(zone.touches).toBeGreaterThanOrEqual(1);
      expect(zone.kind).toBe(zone.mid >= last ? 'resistance' : 'support');
    }
  });

  it('scales the zone band with volatility, not with the instrument price', () => {
    // Same shape, ~6x the price level: bands must scale with ATR, so the ratio
    // of band to price stays comparable rather than the band vanishing.
    const scaled = trending.map((c) => ({
      ...c,
      open: c.open * 6,
      high: c.high * 6,
      low: c.low * 6,
      close: c.close * 6,
    }));
    const base = buildSrChartModel(trending);
    const big = buildSrChartModel(scaled);
    const bandOf = (m: typeof base) => m.zones[0]!.hi - m.zones[0]!.lo;
    expect(bandOf(big) / bandOf(base)).toBeCloseTo(6, 0);
  });

  it('is deterministic for the same input', () => {
    expect(buildSrChartModel(trending)).toEqual(buildSrChartModel(trending));
  });
});

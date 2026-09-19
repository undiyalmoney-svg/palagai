import { describe, expect, it } from 'vitest';
import {
  CHART_INTERVALS,
  CHART_INTERVAL_LABELS,
  KITE_MAX_DAYS_PER_REQUEST,
  KiteInterval,
  chartIntervalMinutes,
  chartIntervalSpec,
  formatIstDateTime,
  formatKiteDateTime,
} from './chart-intervals.util';

/** Exactly what Kite Connect documents for historical candle intervals. */
const KITE_INTERVALS: KiteInterval[] = [
  'minute',
  '3minute',
  '5minute',
  '10minute',
  '15minute',
  '30minute',
  '60minute',
  'day',
];

describe('chart interval specs', () => {
  it('offers the seven intervals the desk asked for, shortest first', () => {
    expect(CHART_INTERVALS).toEqual(['1m', '5m', '10m', '15m', '30m', '45m', '1h']);
    expect(CHART_INTERVALS.map((i) => CHART_INTERVAL_LABELS[i])).toEqual([
      '1m',
      '5m',
      '10m',
      '15m',
      '30m',
      '45m',
      '1h',
    ]);
  });

  it('only ever requests an interval Kite actually serves', () => {
    for (const interval of CHART_INTERVALS) {
      expect(KITE_INTERVALS).toContain(chartIntervalSpec(interval).fetch);
    }
  });

  it('folds 45m from three 15m bars, since Kite has no 45-minute candle', () => {
    const spec = chartIntervalSpec('45m');
    expect(spec.fetch).toBe('15minute');
    expect(spec.groupSize).toBe(3);
  });

  it('reports the displayed bar length in minutes', () => {
    expect(chartIntervalMinutes('1m')).toBe(1);
    expect(chartIntervalMinutes('5m')).toBe(5);
    expect(chartIntervalMinutes('15m')).toBe(15);
    expect(chartIntervalMinutes('45m')).toBe(45);
    expect(chartIntervalMinutes('1h')).toBe(60);
  });

  it('takes every other interval straight from Kite without folding', () => {
    for (const interval of CHART_INTERVALS.filter((i) => i !== '45m')) {
      expect(chartIntervalSpec(interval).groupSize).toBe(1);
    }
  });

  it('maps each interval to the matching Kite interval', () => {
    const expected: Record<string, KiteInterval> = {
      '1m': 'minute',
      '5m': '5minute',
      '10m': '10minute',
      '15m': '15minute',
      '30m': '30minute',
      '45m': '15minute',
      '1h': '60minute',
    };
    for (const [interval, fetch] of Object.entries(expected)) {
      expect(chartIntervalSpec(interval as never).fetch).toBe(fetch);
    }
  });

  it('stays inside Kite per-request day limits', () => {
    for (const interval of CHART_INTERVALS) {
      const spec = chartIntervalSpec(interval);
      expect(spec.lookbackDays).toBeLessThanOrEqual(KITE_MAX_DAYS_PER_REQUEST[spec.fetch]);
      expect(spec.lookbackDays).toBeGreaterThan(0);
    }
  });

  it('asks for more history as the interval gets coarser', () => {
    const days = CHART_INTERVALS.map((i) => chartIntervalSpec(i).lookbackDays);
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i]!).toBeGreaterThanOrEqual(days[i - 1]!);
    }
  });

  it('falls back to 15m for an unknown interval rather than throwing', () => {
    expect(chartIntervalSpec('nonsense' as never)).toEqual(chartIntervalSpec('15m'));
  });
});

describe('formatKiteDateTime', () => {
  it('emits the yyyy-mm-dd hh:mm:ss shape Kite requires', () => {
    expect(formatKiteDateTime(new Date(2026, 8, 17, 9, 15, 0))).toBe('2026-09-17 09:15:00');
  });

  it('zero-pads every field', () => {
    expect(formatKiteDateTime(new Date(2026, 0, 5, 7, 4, 3))).toBe('2026-01-05 07:04:03');
  });

  it('prints an IST wall clock even when the host is UTC', () => {
    expect(formatIstDateTime(new Date('2026-04-01T23:59:59+05:30'))).toBe('2026-04-01 23:59:59');
    expect(formatIstDateTime(new Date('2026-04-01T18:29:59.000Z'))).toBe('2026-04-01 23:59:59');
  });
});


import { describe, expect, it } from 'vitest';
import { Candle } from '../models/candle.model';
import { chartCandleAsOf, endOfIstDay, isLiveChartDay, istToday } from './chart-day.util';
import { chartQuote, previousSessionClose } from './chart-quote.util';

const bar = (date: string, open: number, close: number): Candle => ({
  date,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume: 0,
});

describe('chart-day', () => {
  it('reads today in IST, not in the host zone', () => {
    expect(istToday(new Date('2026-04-01T20:00:00Z'))).toBe('2026-04-02');
  });

  it('treats today and the future as live, an earlier date as a replay', () => {
    const now = new Date('2026-04-01T06:00:00Z');
    expect(isLiveChartDay('2026-04-01', now)).toBe(true);
    expect(isLiveChartDay('2026-03-31', now)).toBe(false);
    expect(chartCandleAsOf('2026-04-01', now)).toBe(now);
    expect(chartCandleAsOf('2026-03-31', now).getTime()).toBe(endOfIstDay('2026-03-31').getTime());
  });
});

describe('chart-quote', () => {
  it('quotes the change against the previous session close', () => {
    const candles = [
      bar('2026-03-30T15:15:00+05:30', 99, 100),
      bar('2026-03-31T09:15:00+05:30', 101, 103),
      bar('2026-03-31T09:30:00+05:30', 103, 105),
    ];
    expect(previousSessionClose(candles)).toBe(100);
    const q = chartQuote(candles)!;
    expect(q.price).toBe(105);
    expect(q.changeAbs).toBe(5);
    expect(q.changePct).toBeCloseTo(5, 6);
  });

  it('falls back to the first open on a single session and handles no data', () => {
    expect(previousSessionClose([bar('2026-03-31T09:15:00+05:30', 90, 95)])).toBe(90);
    expect(chartQuote([])).toBeNull();
  });
});

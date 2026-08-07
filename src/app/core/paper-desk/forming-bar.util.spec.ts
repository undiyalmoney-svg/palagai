import { describe, expect, it } from 'vitest';
import { dropFormingBars, isBarComplete } from './forming-bar.util';
import { Candle } from '../models/candle.model';

function bar(date: string): Candle {
  return { date, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}

/** IST wall clock helper. */
const at = (hhmm: string) => new Date(`2026-08-07T${hhmm}:00+05:30`);

describe('isBarComplete', () => {
  it('a 10:00 bar is not complete at 10:03', () => {
    expect(isBarComplete('2026-08-07T10:00:00+0530', at('10:03'))).toBe(false);
  });

  it('a 10:00 bar is complete at exactly 10:05', () => {
    expect(isBarComplete('2026-08-07T10:00:00+0530', at('10:05'))).toBe(true);
  });

  it('treats naive stamps as IST', () => {
    expect(isBarComplete('2026-08-07 10:00:00', at('10:06'))).toBe(true);
    expect(isBarComplete('2026-08-07 10:00:00', at('10:01'))).toBe(false);
  });

  it('junk dates are never complete', () => {
    expect(isBarComplete('', at('10:05'))).toBe(false);
  });
});

describe('dropFormingBars', () => {
  const series = [
    bar('2026-08-07T09:50:00+0530'),
    bar('2026-08-07T09:55:00+0530'),
    bar('2026-08-07T10:00:00+0530'),
  ];

  it('drops the bar still being built', () => {
    const out = dropFormingBars(series, at('10:03'));
    expect(out).toHaveLength(2);
    expect(out.at(-1)!.date).toBe('2026-08-07T09:55:00+0530');
  });

  it('keeps every bar once the last one closes', () => {
    const out = dropFormingBars(series, at('10:05'));
    expect(out).toHaveLength(3);
    expect(out).toBe(series);
  });

  it('REGRESSION 2026-08-07: no repaint churn inside the 10:00 bar', () => {
    // Three ticks land inside 10:00–10:05 with a changing last bar.
    const ticks = ['10:00', '10:01', '10:03', '10:04'].map((t) =>
      dropFormingBars(series, at(t)),
    );
    // Every tick sees an identical, closed series — nothing can flip.
    for (const t of ticks) {
      expect(t.at(-1)!.date).toBe('2026-08-07T09:55:00+0530');
    }
  });

  it('handles an empty series', () => {
    expect(dropFormingBars([], at('10:05'))).toEqual([]);
  });

  it('drops several trailing bars when the clock is behind', () => {
    expect(dropFormingBars(series, at('09:56'))).toHaveLength(1);
  });
});

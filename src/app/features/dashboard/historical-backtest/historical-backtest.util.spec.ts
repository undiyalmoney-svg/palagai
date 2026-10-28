import { describe, expect, it } from 'vitest';
import { lastCompletedSession, pct } from './historical-backtest.util';

describe('lastCompletedSession', () => {
  it('skips weekends and does not return today', () => {
    const monday = new Date('2026-10-26T08:00:00+05:30');
    expect(lastCompletedSession(monday)).toBe('2026-10-23');
    const wednesday = new Date('2026-10-28T18:00:00+05:30');
    expect(lastCompletedSession(wednesday)).toBe('2026-10-27');
  });

  it('formats return percent from a fraction', () => {
    expect(pct(0.125)).toBe('12.50%');
  });
});

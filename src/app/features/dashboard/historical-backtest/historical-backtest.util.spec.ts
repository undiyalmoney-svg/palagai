import { describe, expect, it } from 'vitest';
import { daysBefore, lastCompletedSession, pct } from './historical-backtest.util';

describe('lastCompletedSession', () => {
  it('skips weekends and does not return today before the cash close', () => {
    const monday = new Date('2026-10-26T08:00:00+05:30');
    expect(lastCompletedSession(monday)).toBe('2026-10-23');
    const wednesdayMorning = new Date('2026-10-28T10:00:00+05:30');
    expect(lastCompletedSession(wednesdayMorning)).toBe('2026-10-27');
  });

  it('returns today after 15:30 IST on a weekday so One day can replay the session just closed', () => {
    const wednesdayEvening = new Date('2026-10-28T18:00:00+05:30');
    expect(lastCompletedSession(wednesdayEvening)).toBe('2026-10-28');
    const thursdayClose = new Date('2026-10-29T15:30:00+05:30');
    expect(lastCompletedSession(thursdayClose)).toBe('2026-10-29');
  });

  it('formats return percent from a fraction', () => {
    expect(pct(0.125)).toBe('12.50%');
  });

  it('steps calendar days backward for discovery defaults', () => {
    expect(daysBefore('2026-10-27', 35)).toBe('2026-09-22');
  });
});

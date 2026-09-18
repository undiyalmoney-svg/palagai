import { describe, expect, it } from 'vitest';
import { MCX_CRUDE_SESSION, NSE_SESSION } from '../config/session.config';
import {
  formatMinutesGap,
  istClockParts,
  marketStatusAt,
  minutesOfDay,
} from './market-status.util';

/** Fixed instants are written in IST so the expected verdict is readable. */
function ist(dateTime: string): Date {
  return new Date(`${dateTime}+05:30`);
}

describe('istClockParts', () => {
  it('reads the IST wall clock, not the host clock', () => {
    // 22:40 UTC on the 17th is 04:10 IST on the 18th.
    const parts = istClockParts(new Date('2026-09-17T22:40:00Z'));
    expect(parts.date).toBe('2026-09-18');
    expect(parts.time).toBe('04:10');
    expect(parts.weekday).toBe(5);
  });

  it('marks Saturday as day 6 in IST', () => {
    expect(istClockParts(ist('2026-09-19T10:00:00')).weekday).toBe(6);
  });
});

describe('minutesOfDay', () => {
  it('converts HH:mm to minutes', () => {
    expect(minutesOfDay('09:15')).toBe(555);
    expect(minutesOfDay('23:30')).toBe(1410);
  });

  it('falls back to 0 on junk', () => {
    expect(minutesOfDay('')).toBe(0);
  });
});

describe('formatMinutesGap', () => {
  it('reads minutes under the hour', () => {
    expect(formatMinutesGap(45)).toBe('45m');
  });

  it('reads hours and minutes', () => {
    expect(formatMinutesGap(135)).toBe('2h 15m');
  });

  it('drops a zero minute part', () => {
    expect(formatMinutesGap(120)).toBe('2h');
  });
});

describe('marketStatusAt — NSE', () => {
  it('is pre-open before 09:15', () => {
    const status = marketStatusAt(NSE_SESSION, ist('2026-09-18T09:05:00'));
    expect(status.phase).toBe('pre-open');
    expect(status.open).toBe(false);
    expect(status.label).toBe('Opens 09:15');
    expect(status.minutesToOpen).toBe(10);
  });

  it('is open through the session', () => {
    const status = marketStatusAt(NSE_SESSION, ist('2026-09-18T11:00:00'));
    expect(status.phase).toBe('open');
    expect(status.open).toBe(true);
    expect(status.label).toBe('Live');
  });

  it('closes at 15:30, not after it', () => {
    expect(marketStatusAt(NSE_SESSION, ist('2026-09-18T15:29:00')).open).toBe(true);
    expect(marketStatusAt(NSE_SESSION, ist('2026-09-18T15:30:00')).phase).toBe('after-close');
  });
});

describe('marketStatusAt — MCX crude', () => {
  it('opens at 09:00, a quarter hour ahead of the indices', () => {
    const at0905 = ist('2026-09-18T09:05:00');
    expect(marketStatusAt(MCX_CRUDE_SESSION, at0905).open).toBe(true);
    expect(marketStatusAt(NSE_SESSION, at0905).open).toBe(false);
  });

  it('keeps trading after the indices shut', () => {
    const evening = ist('2026-09-18T19:30:00');
    expect(marketStatusAt(MCX_CRUDE_SESSION, evening).open).toBe(true);
    expect(marketStatusAt(NSE_SESSION, evening).open).toBe(false);
  });

  it('runs to 23:30', () => {
    expect(marketStatusAt(MCX_CRUDE_SESSION, ist('2026-09-18T23:29:00')).open).toBe(true);
    const shut = marketStatusAt(MCX_CRUDE_SESSION, ist('2026-09-18T23:30:00'));
    expect(shut.phase).toBe('after-close');
    expect(shut.detail).toContain('23:30');
  });
});

describe('marketStatusAt — weekend', () => {
  it('is shut on Saturday regardless of the clock', () => {
    const status = marketStatusAt(MCX_CRUDE_SESSION, ist('2026-09-19T12:00:00'));
    expect(status.phase).toBe('weekend');
    expect(status.open).toBe(false);
    expect(status.minutesToOpen).toBeNull();
  });

  it('is shut on Sunday for the indices too', () => {
    expect(marketStatusAt(NSE_SESSION, ist('2026-09-20T11:00:00')).phase).toBe('weekend');
  });

  it('is back open on Monday', () => {
    expect(marketStatusAt(NSE_SESSION, ist('2026-09-21T11:00:00')).phase).toBe('open');
  });
});

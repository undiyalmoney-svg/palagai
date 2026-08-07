import { describe, expect, it } from 'vitest';
import {
  isStaleStartSignal,
  istClock,
  nowIstStamp,
  parseIstTimestamp,
  staleStartReason,
} from './live-start-guard.util';

describe('parseIstTimestamp', () => {
  it('treats naive stamps as IST, not UTC', () => {
    expect(parseIstTimestamp('2026-08-06 14:45:00')).toBe(
      Date.parse('2026-08-06T14:45:00+05:30'),
    );
  });

  it('honours an explicit offset', () => {
    expect(parseIstTimestamp('2026-08-06T14:45:00+0530')).toBe(
      Date.parse('2026-08-06T14:45:00+05:30'),
    );
  });

  it('returns 0 for junk', () => {
    expect(parseIstTimestamp('')).toBe(0);
    expect(parseIstTimestamp(null)).toBe(0);
    expect(parseIstTimestamp('not a date')).toBe(0);
  });
});

describe('isStaleStartSignal', () => {
  const started = '2026-08-06 14:50:00';

  it('blocks a morning leg when Start is pressed in the afternoon', () => {
    expect(
      isStaleStartSignal({
        signalEntryTime: '2026-08-06 10:30:00',
        deskStartedAt: started,
        hasBrokerPosition: false,
      }),
    ).toBe(true);
  });

  it('allows the bar that closed just before Start', () => {
    expect(
      isStaleStartSignal({
        signalEntryTime: '2026-08-06 14:47:00',
        deskStartedAt: started,
        hasBrokerPosition: false,
      }),
    ).toBe(false);
  });

  it('allows signals born after Start', () => {
    expect(
      isStaleStartSignal({
        signalEntryTime: '2026-08-06 15:05:00',
        deskStartedAt: started,
        hasBrokerPosition: false,
      }),
    ).toBe(false);
  });

  it('never blocks a leg Kite already holds (adopted or entered)', () => {
    expect(
      isStaleStartSignal({
        signalEntryTime: '2026-08-06 10:30:00',
        deskStartedAt: started,
        hasBrokerPosition: true,
      }),
    ).toBe(false);
  });

  it('keeps managing a long hold entered after Start', () => {
    // Entered 15:00 this session, still open at 18:00 — must not read as stale.
    expect(
      isStaleStartSignal({
        signalEntryTime: '2026-08-06 15:00:00',
        deskStartedAt: started,
        hasBrokerPosition: true,
      }),
    ).toBe(false);
  });

  it('does nothing when Start time is unknown (paper runs)', () => {
    expect(
      isStaleStartSignal({
        signalEntryTime: '2026-08-06 10:30:00',
        deskStartedAt: null,
        hasBrokerPosition: false,
      }),
    ).toBe(false);
  });

  it('crude evening leg from noon is stale on a 19:00 Start', () => {
    expect(
      isStaleStartSignal({
        signalEntryTime: '2026-08-06T12:35:00+0530',
        deskStartedAt: '2026-08-06 19:00:00',
        hasBrokerPosition: false,
      }),
    ).toBe(true);
  });
});

describe('labels', () => {
  it('formats IST clock', () => {
    expect(istClock('2026-08-06 14:45:00')).toBe('14:45');
    expect(istClock(null)).toBe('—');
  });

  it('explains why the signal was not chased', () => {
    const msg = staleStartReason('2026-08-06 10:30:00', '2026-08-06 14:50:00');
    expect(msg).toContain('10:30');
    expect(msg).toContain('14:50');
    expect(msg).toContain('Not chased');
  });

  it('nowIstStamp is parseable and naive', () => {
    const stamp = nowIstStamp(new Date('2026-08-06T09:20:00Z'));
    expect(stamp).toBe('2026-08-06 14:50:00');
    expect(parseIstTimestamp(stamp)).toBe(Date.parse('2026-08-06T14:50:00+05:30'));
  });
});

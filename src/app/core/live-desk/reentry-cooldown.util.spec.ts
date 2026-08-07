import { describe, expect, it } from 'vitest';
import { barBucket, isSameBarReentry } from './reentry-cooldown.util';

describe('barBucket', () => {
  it('buckets to the 5m bar start', () => {
    expect(barBucket('2026-08-07 10:03:20')).toBe(
      Date.parse('2026-08-07T10:00:00+05:30'),
    );
    expect(barBucket('2026-08-07 10:00:00')).toBe(
      Date.parse('2026-08-07T10:00:00+05:30'),
    );
    expect(barBucket('2026-08-07 10:05:01')).toBe(
      Date.parse('2026-08-07T10:05:00+05:30'),
    );
  });

  it('returns 0 for junk', () => {
    expect(barBucket(null)).toBe(0);
    expect(barBucket('nope')).toBe(0);
  });
});

describe('isSameBarReentry', () => {
  it('REGRESSION 2026-08-07: blocks the Bank re-entry inside the 10:00 bar', () => {
    // Exited the 10:00 leg, signal wants back in still inside 10:00–10:05.
    expect(
      isSameBarReentry({
        signalEntryTime: '2026-08-07 10:03:50',
        lastExitEntryTime: '2026-08-07 10:00:42',
      }),
    ).toBe(true);
  });

  it('allows entry once the next bar opens', () => {
    expect(
      isSameBarReentry({
        signalEntryTime: '2026-08-07 10:05:00',
        lastExitEntryTime: '2026-08-07 10:00:00',
      }),
    ).toBe(false);
  });

  it('blocks a signal older than the leg we just closed', () => {
    expect(
      isSameBarReentry({
        signalEntryTime: '2026-08-07 09:55:00',
        lastExitEntryTime: '2026-08-07 10:00:00',
      }),
    ).toBe(true);
  });

  it('does nothing on the first trade of the day', () => {
    expect(
      isSameBarReentry({
        signalEntryTime: '2026-08-07 10:00:00',
        lastExitEntryTime: null,
      }),
    ).toBe(false);
  });

  it('handles mixed naive and offset stamps', () => {
    expect(
      isSameBarReentry({
        signalEntryTime: '2026-08-07T10:04:00+0530',
        lastExitEntryTime: '2026-08-07 10:01:00',
      }),
    ).toBe(true);
  });
});

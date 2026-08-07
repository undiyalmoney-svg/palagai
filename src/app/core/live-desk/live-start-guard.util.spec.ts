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

describe('price-based staleness (Crude can join a leg opened earlier)', () => {
  const started = '2026-08-07 14:40:00';
  // Real Crude leg: SELL @ 7421, stop 7471 → 50 pts of risk, ~16 pts of drift allowed.
  const crude = {
    signalEntryTime: '2026-08-07 14:25:00',
    deskStartedAt: started,
    hasBrokerPosition: false,
    signalEntryPrice: 7421,
    signalStopPrice: 7471,
    direction: 'SELL' as const,
  };

  it('takes the leg while price is still near the signal', () => {
    expect(isStaleStartSignal({ ...crude, currentPrice: 7430 })).toBe(false);
  });

  it('refuses once the move has largely happened without us', () => {
    // Short signalled at 7421; price already 7390, so 31 of the move is gone.
    expect(isStaleStartSignal({ ...crude, currentPrice: 7390 })).toBe(true);
  });

  it('takes it when price came back toward the stop — same target, less risk', () => {
    expect(isStaleStartSignal({ ...crude, currentPrice: 7440 })).toBe(false);
  });

  it('a tight-risk index leg refuses a drift Crude would accept', () => {
    // Nifty SELL 24600, stop 24612 → 12 pts risk, ~4 allowed. 9 pts already gone.
    expect(
      isStaleStartSignal({
        signalEntryTime: '2026-08-07 13:10:00',
        deskStartedAt: started,
        hasBrokerPosition: false,
        signalEntryPrice: 24600,
        signalStopPrice: 24612,
        direction: 'SELL',
        currentPrice: 24591,
      }),
    ).toBe(true);
    // The same 9 points is nothing against Crude's 50-pt risk.
    expect(isStaleStartSignal({ ...crude, currentPrice: 7412 })).toBe(false);
  });

  it('a long CE leg uses the same rule in reverse', () => {
    const ce = {
      signalEntryTime: '2026-08-07 14:25:00',
      deskStartedAt: started,
      hasBrokerPosition: false,
      signalEntryPrice: 7421,
      signalStopPrice: 7371,
      direction: 'BUY' as const,
    };
    expect(isStaleStartSignal({ ...ce, currentPrice: 7430 })).toBe(false);
    expect(isStaleStartSignal({ ...ce, currentPrice: 7460 })).toBe(true);
  });

  it('falls back to the clock when levels are missing', () => {
    expect(
      isStaleStartSignal({
        signalEntryTime: '2026-08-07 10:30:00',
        deskStartedAt: started,
        hasBrokerPosition: false,
      }),
    ).toBe(true);
  });

  it('never blocks a leg Kite already holds, however far price ran', () => {
    expect(isStaleStartSignal({ ...crude, currentPrice: 7999, hasBrokerPosition: true })).toBe(
      false,
    );
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

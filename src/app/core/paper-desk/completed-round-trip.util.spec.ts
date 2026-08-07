import { describe, expect, it } from 'vitest';
import {
  missedRoundTripReason,
  splitCompletedRoundTrips,
  type RoundTripEvent,
} from './completed-round-trip.util';

function open(instrumentId: string, entryTime: string): RoundTripEvent {
  return { kind: 'open', instrumentId, instrumentName: instrumentId, open: { entryTime } };
}

function close(instrumentId: string, entryTime: string, exitReason = 'Stop loss hit'): RoundTripEvent {
  return { kind: 'close', instrumentId, instrumentName: instrumentId, entryTime, exitReason };
}

describe('splitCompletedRoundTrips', () => {
  it('REGRESSION 2026-08-07: a round trip seen after it ended places no orders', () => {
    // Bank opened on the 12:05 bar and closed on 12:10; the tick saw both.
    const { actionable, missed } = splitCompletedRoundTrips([
      open('bank-nifty', '2026-08-07T12:05:00+0530'),
      close('bank-nifty', '2026-08-07T12:05:00+0530', 'Profit drained — cut & rehunt'),
    ]);
    expect(actionable).toEqual([]);
    expect(missed).toHaveLength(1);
    expect(missed[0]!.entryTime).toBe('2026-08-07T12:05:00+0530');
  });

  it('keeps an open that is still running', () => {
    const { actionable, missed } = splitCompletedRoundTrips([
      open('nifty-50', '2026-08-07T12:55:00+0530'),
    ]);
    expect(actionable).toHaveLength(1);
    expect(missed).toEqual([]);
  });

  it('keeps a close for a leg entered on an earlier tick', () => {
    const { actionable, missed } = splitCompletedRoundTrips([
      close('nifty-50', '2026-08-07T11:00:00+0530'),
    ]);
    expect(actionable).toHaveLength(1);
    expect(actionable[0]!.kind).toBe('close');
    expect(missed).toEqual([]);
  });

  it('handles open, close, then a fresh open in one batch', () => {
    const { actionable, missed } = splitCompletedRoundTrips([
      open('bank-nifty', '2026-08-07T12:05:00+0530'),
      close('bank-nifty', '2026-08-07T12:05:00+0530'),
      open('bank-nifty', '2026-08-07T12:15:00+0530'),
    ]);
    expect(missed).toHaveLength(1);
    expect(actionable).toHaveLength(1);
    expect(actionable[0]!.kind).toBe('open');
    expect(actionable[0]!.open?.entryTime).toBe('2026-08-07T12:15:00+0530');
  });

  it('does not let one book cancel another book\'s leg', () => {
    const { actionable, missed } = splitCompletedRoundTrips([
      open('nifty-50', '2026-08-07T12:05:00+0530'),
      close('bank-nifty', '2026-08-07T12:05:00+0530'),
    ]);
    expect(missed).toEqual([]);
    expect(actionable).toHaveLength(2);
  });

  it('drops both legs of several completed round trips', () => {
    const { actionable, missed } = splitCompletedRoundTrips([
      open('nifty-50', '2026-08-07T10:05:00+0530'),
      close('nifty-50', '2026-08-07T10:05:00+0530'),
      open('nifty-50', '2026-08-07T11:00:00+0530'),
      close('nifty-50', '2026-08-07T11:00:00+0530'),
    ]);
    expect(actionable).toEqual([]);
    expect(missed).toHaveLength(2);
  });

  it('explains the miss in plain words', () => {
    const msg = missedRoundTripReason('2026-08-07T12:05:00+0530', 'Target hit');
    expect(msg).toContain('12:05');
    expect(msg).toContain('no order placed');
    expect(msg).toContain('Target hit');
  });
});

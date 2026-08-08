import { describe, expect, it } from 'vitest';
import {
  effectiveCloseReason,
  isProfitDrainedReason,
  shouldHoldForRestingSlm,
} from './live-drain-hold.util';
import { isRestingExit } from '../paper-desk/executable-fill.util';

describe('live-drain-hold.util', () => {
  it('passes through an explicit close reason', () => {
    expect(
      effectiveCloseReason({
        closeReason: 'Profit drained — cut & rehunt',
        drainHoldLatched: false,
      }),
    ).toBe('Profit drained — cut & rehunt');
  });

  it('after HOLD, status sync without reason still looks like profit-drained', () => {
    expect(
      effectiveCloseReason({
        closeReason: null,
        drainHoldLatched: true,
      }),
    ).toBe('Profit drained — cut & rehunt');
  });

  it('without latch or reason, stays null (normal MARKET exit path)', () => {
    expect(effectiveCloseReason({ closeReason: null, drainHoldLatched: false })).toBeNull();
  });

  it('detects profit-drained / cut & rehunt wording', () => {
    expect(isProfitDrainedReason('Profit drained — cut & rehunt')).toBe(true);
    expect(isProfitDrainedReason('cut & rehunt')).toBe(true);
    expect(isProfitDrainedReason('Stop loss hit')).toBe(false);
  });

  it('paper resting trail and live SL-M hold stay aligned', () => {
    const trail = 'Profit drained — cut & rehunt';
    expect(isRestingExit(trail)).toBe(true);
    expect(shouldHoldForRestingSlm(trail)).toBe(true);
    expect(shouldHoldForRestingSlm('End of range')).toBe(false);
    expect(isRestingExit('End of range')).toBe(false);
  });

  it('never HOLDs drain after 15:15 — must MARKET flatten', () => {
    const trail = 'Profit drained — cut & rehunt';
    expect(shouldHoldForRestingSlm(trail, { nowHhMm: '15:15' })).toBe(false);
    expect(shouldHoldForRestingSlm(trail, { nowHhMm: '15:20' })).toBe(false);
    expect(shouldHoldForRestingSlm(trail, { sessionClosed: true })).toBe(false);
    expect(shouldHoldForRestingSlm(trail, { nowHhMm: '14:50' })).toBe(true);
  });

  it('sessionClosed clears drain latch to EOD reason', () => {
    expect(
      effectiveCloseReason({
        closeReason: null,
        drainHoldLatched: true,
        sessionClosed: true,
      }),
    ).toBe('EOD / session exit');
  });
});

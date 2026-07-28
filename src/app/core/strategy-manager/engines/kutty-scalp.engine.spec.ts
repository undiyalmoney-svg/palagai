import { describe, expect, it } from 'vitest';
import {
  KUTTY_ID,
  KUTTY_MAX_TRADES_PER_DAY,
  KUTTY_YIELD_TRAP_REASON,
  canOpenKutty,
  clearKuttyPending,
  createKuttyDayState,
  kuttyExitLogic,
  kuttyStopPts,
  kuttyTargetPts,
  primaryNeedsBar,
  trapOwnsBar,
} from './kutty-scalp.engine';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';

describe('Kutty scalp', () => {
  it('is not a managed strategy id', () => {
    expect(KUTTY_ID).toBe('kutty');
    expect(Object.values(MANAGED_STRATEGY_IDS)).not.toContain(KUTTY_ID);
    expect(KUTTY_MAX_TRADES_PER_DAY).toBe(2);
    expect(KUTTY_YIELD_TRAP_REASON).toContain('Trap priority');
  });

  it('reserves margin for Trap before Kutty (unless Kutty alone)', () => {
    expect(canOpenKutty({ usedMarginRs: 0, trapOpenAnywhere: false })).toBe(true);
    expect(canOpenKutty({ usedMarginRs: 35_000, trapOpenAnywhere: false })).toBe(false);
    expect(
      canOpenKutty({ usedMarginRs: 35_000, trapOpenAnywhere: false, kuttyAlone: true }),
    ).toBe(true);
  });

  it('stands down when Trap is armed — not on Kutty own arm text', () => {
    expect(trapOwnsBar('Trap BUY armed — wait confirm')).toBe(true);
    expect(trapOwnsBar('Trap SELL armed — wait confirm')).toBe(true);
    expect(trapOwnsBar('No S/R trap / bounce')).toBe(false);
    expect(trapOwnsBar('Kutty BUY armed')).toBe(false);
    expect(primaryNeedsBar({ action: 'BUY', reason: 'S/R trap confirm BUY · 3.5R' })).toBe(true);
    expect(primaryNeedsBar({ action: 'WAITING', reason: 'Trap BUY armed — wait confirm' })).toBe(
      true,
    );
    expect(primaryNeedsBar({ action: 'WAITING', reason: 'No S/R trap / bounce' })).toBe(false);
  });

  it('clears pending so Trap is not blocked by a stale Kutty arm', () => {
    const state = createKuttyDayState();
    state.pending = { dir: 1, signalClose: 100 };
    clearKuttyPending(state);
    expect(state.pending).toBeNull();
  });

  it('uses ₹600/₹200 index pts (doc 34 champion)', () => {
    expect(kuttyTargetPts('nifty')).toBeCloseTo(600 / 65, 5);
    expect(kuttyStopPts('nifty')).toBeCloseTo(200 / 65, 5);
    const tp = kuttyTargetPts('nifty');
    const sl = kuttyStopPts('nifty');
    const hit = kuttyExitLogic(
      {
        date: '2026-07-28T11:00:00+05:30',
        open: 100,
        high: 100 + tp,
        low: 99,
        close: 100 + tp,
        volume: 0,
      },
      { direction: 'BUY', entry: 100, stop: 100 - sl, target: 100 + tp },
    );
    expect(hit?.reason).toBe('Kutty target');
    expect(createKuttyDayState().pending).toBeNull();
  });
});

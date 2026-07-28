import { describe, expect, it } from 'vitest';
import {
  KUTTY_ID,
  KUTTY_MAX_TRADES_PER_DAY,
  canOpenKutty,
  createKuttyDayState,
  kuttyExitLogic,
  kuttyStopPts,
  kuttyTargetPts,
  trapOwnsBar,
} from './kutty-scalp.engine';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';

describe('Kutty scalp', () => {
  it('is not a managed strategy id', () => {
    expect(KUTTY_ID).toBe('kutty');
    expect(Object.values(MANAGED_STRATEGY_IDS)).not.toContain(KUTTY_ID);
    expect(KUTTY_MAX_TRADES_PER_DAY).toBe(2);
  });

  it('reserves margin for Trap before Kutty', () => {
    expect(canOpenKutty({ usedMarginRs: 0, trapOpenAnywhere: false })).toBe(true);
    expect(canOpenKutty({ usedMarginRs: 35_000, trapOpenAnywhere: false })).toBe(false);
  });

  it('stands down when Trap is armed', () => {
    expect(trapOwnsBar('Trap BUY armed — wait confirm')).toBe(true);
    expect(trapOwnsBar('No S/R trap / bounce')).toBe(false);
  });

  it('uses ₹350/₹200 index pts', () => {
    expect(kuttyTargetPts('nifty')).toBeCloseTo(350 / 65, 5);
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

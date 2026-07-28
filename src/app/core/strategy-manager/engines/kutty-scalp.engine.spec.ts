import { describe, expect, it } from 'vitest';
import {
  KUTTY_ID,
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
  });

  it('reserves margin for Trap before Kutty', () => {
    expect(canOpenKutty({ usedMarginRs: 0, trapOpenAnywhere: false })).toBe(true);
    expect(canOpenKutty({ usedMarginRs: 35_000, trapOpenAnywhere: false })).toBe(false);
    expect(canOpenKutty({ usedMarginRs: 50_000, trapOpenAnywhere: true })).toBe(true);
  });

  it('stands down when Trap owns the bar', () => {
    expect(trapOwnsBar('Trap BUY armed — wait confirm')).toBe(true);
    expect(trapOwnsBar('No S/R trap / bounce')).toBe(false);
  });

  it('exits at ₹350/₹200 pts targets', () => {
    const tp = kuttyTargetPts('nifty');
    const sl = kuttyStopPts('nifty');
    expect(tp).toBeCloseTo(350 / 65, 5);
    expect(sl).toBeCloseTo(200 / 65, 5);
    const buy = kuttyExitLogic(
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
    expect(buy?.reason).toBe('Kutty target');
    expect(createKuttyDayState().tradesToday).toBe(0);
  });
});

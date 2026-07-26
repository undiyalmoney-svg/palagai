import { describe, expect, it } from 'vitest';
import {
  createSrTrapDayState,
  recordSrTrapTradeClosed,
  remainingLossBudgetPts,
} from './sr-trap-confirm.engine';

const NIFTY_RS_PER_PT = 65;
const BANK_RS_PER_PT = 30;

describe('Trap ₹ day loss cap', () => {
  it('Nifty ₹1000 cap = ~15.4 pts of budget', () => {
    const s = createSrTrapDayState();
    s.dayLossCapPts = 1000 / NIFTY_RS_PER_PT;
    expect(remainingLossBudgetPts(s)).toBeCloseTo(15.38, 1);
  });

  it('shrinks the budget after each losing trade', () => {
    const s = createSrTrapDayState();
    s.dayLossCapPts = 1000 / NIFTY_RS_PER_PT;

    recordSrTrapTradeClosed(s, -6, 60);
    expect(remainingLossBudgetPts(s)).toBeCloseTo(9.38, 1);
    expect(s.dayStopped).toBe(false);

    recordSrTrapTradeClosed(s, -5, 60);
    expect(remainingLossBudgetPts(s)).toBeCloseTo(4.38, 1);
    expect(s.dayStopped).toBe(false);
  });

  it('stops the day once the ₹ cap is spent, before the pts day stop fires', () => {
    const s = createSrTrapDayState();
    s.dayLossCapPts = 1000 / NIFTY_RS_PER_PT;

    // −16 pts ≈ −₹1040 on Nifty; pts day stop (60) has NOT been hit yet.
    recordSrTrapTradeClosed(s, -16, 60);
    expect(s.dayStopped).toBe(true);
    expect(remainingLossBudgetPts(s)).toBeLessThanOrEqual(0);
  });

  it('profits restore no more than the original budget', () => {
    const s = createSrTrapDayState();
    s.dayLossCapPts = 1000 / NIFTY_RS_PER_PT;
    recordSrTrapTradeClosed(s, 40, 60);
    // Green day must not inflate the loss budget beyond the cap.
    expect(remainingLossBudgetPts(s)).toBeCloseTo(15.38, 1);
  });

  it('Bank uses ₹30/pt so the same ₹1000 buys ~33 pts', () => {
    const s = createSrTrapDayState();
    s.dayLossCapPts = 1000 / BANK_RS_PER_PT;
    expect(remainingLossBudgetPts(s)).toBeCloseTo(33.33, 1);
    recordSrTrapTradeClosed(s, -34, 80);
    expect(s.dayStopped).toBe(true);
  });

  it('is inert when the cap is off', () => {
    const s = createSrTrapDayState();
    expect(remainingLossBudgetPts(s)).toBe(Number.POSITIVE_INFINITY);
    recordSrTrapTradeClosed(s, -50, 0);
    expect(s.dayStopped).toBe(false);
  });
});

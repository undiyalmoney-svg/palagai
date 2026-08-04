import { describe, expect, it } from 'vitest';
import {
  DESK_DAY_PROFIT_LOCK_RS,
  DESK_STRICT_DAY_LOSS_RS,
  deskDayProfitLockMoneyRs,
  deskStrictDayLossMoneyRs,
} from './pdhl-opening-range.evaluator';

describe('desk day lock money × lots', () => {
  it('scales profit lock: 1 lot → ₹3k, 3 lots → ₹9k', () => {
    expect(DESK_DAY_PROFIT_LOCK_RS).toBe(3000);
    expect(deskDayProfitLockMoneyRs(1)).toBe(3000);
    expect(deskDayProfitLockMoneyRs(2)).toBe(6000);
    expect(deskDayProfitLockMoneyRs(3)).toBe(9000);
  });

  it('scales strict day stop the same way', () => {
    expect(DESK_STRICT_DAY_LOSS_RS).toBe(2950);
    expect(deskStrictDayLossMoneyRs(1)).toBe(2950);
    expect(deskStrictDayLossMoneyRs(3)).toBe(8850);
  });
});

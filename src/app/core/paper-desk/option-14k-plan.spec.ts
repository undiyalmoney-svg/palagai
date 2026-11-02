import { describe, expect, it } from 'vitest';
import {
  OPTION_14K_BOOKS,
  OPTION_14K_CAPITAL_RS,
  OPTION_14K_DAY_LOSS_RS,
  OPTION_14K_HONEST,
  OPTION_14K_LIST,
  OPTION_14K_PREMIUM_BUDGET_RS,
  canBuyCheapCepe,
  option14kToPaperCfg,
} from './option-14k-plan';

describe('₹14k CE/PE plan', () => {
  it('fits all four books inside the premium budget and day-loss', () => {
    expect(OPTION_14K_CAPITAL_RS).toBe(14_000);
    expect(OPTION_14K_PREMIUM_BUDGET_RS).toBe(3_500);
    expect(OPTION_14K_DAY_LOSS_RS).toBe(420);
    expect(OPTION_14K_LIST.map((b) => b.id)).toEqual(['crude', 'nifty', 'bank', 'sensex']);
    for (const book of OPTION_14K_LIST) {
      expect(book.openCostRs).toBeLessThanOrEqual(OPTION_14K_PREMIUM_BUDGET_RS);
      expect(book.oneStopRs).toBeLessThanOrEqual(OPTION_14K_DAY_LOSS_RS);
      expect(book.openCostRs).toBe(book.targetPremRs * book.lot);
      expect(canBuyCheapCepe(book.id, 14_000, OPTION_14K_PREMIUM_BUDGET_RS, OPTION_14K_DAY_LOSS_RS)).toBe(true);
      expect(option14kToPaperCfg(book).buyOption).toBe(true);
      expect(option14kToPaperCfg(book).premiumRs).toBe(book.openCostRs);
    }
    expect(OPTION_14K_BOOKS.crude.exchange).toBe('MCX');
    expect(OPTION_14K_BOOKS.sensex.exchange).toBe('BFO');
    expect(OPTION_14K_HONEST).toMatch(/buy CE\/PE/);
    expect(OPTION_14K_HONEST).toMatch(/ATM still blocked/);
    expect(OPTION_14K_HONEST).not.toMatch(/guaranteed profit(?!.)/);
    expect(OPTION_14K_HONEST).toMatch(/Not a guaranteed profit/);
  });

  it('refuses a premium that would wash ₹14k', () => {
    expect(canBuyCheapCepe('nifty', 14_000, 1_000, 420)).toBe(false);
    expect(canBuyCheapCepe('nifty', 2_000, 3_500, 420)).toBe(false);
  });
});

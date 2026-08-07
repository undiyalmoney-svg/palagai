import { describe, expect, it } from 'vitest';
import { planLotsForCapital } from './capital-plan.util';

describe('planLotsForCapital', () => {
  it('sizes ₹40k to Nifty+Bank ×1 (Crude off for all-day-green)', () => {
    const p = planLotsForCapital(40_000);
    expect(p.niftyLots).toBe(1);
    expect(p.bankLots).toBe(1);
    expect(p.crudeLots).toBe(0);
    expect(p.enableCrude).toBe(false);
    expect(p.enableNatGas).toBe(false);
    expect(p.estimatedPremiumRs).toBeLessThanOrEqual(p.premiumBudgetRs);
    expect(p.dailyTargetRs).toBe(2_000);
    expect(p.tenDayGoalRs).toBe(20_000);
    expect(p.dayProfitLockRs).toBe(3_000);
  });

  it('drops to a single book when capital is tight', () => {
    const p = planLotsForCapital(20_000);
    expect(p.estimatedPremiumRs).toBeLessThanOrEqual(p.premiumBudgetRs);
    expect(p.enableNatGas).toBe(false);
    expect(p.enableNifty || p.enableBank || p.enableCrude).toBe(true);
  });
});

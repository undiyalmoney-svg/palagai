import { describe, expect, it } from 'vitest';
import { planLotsForCapital } from './capital-plan.util';

describe('planLotsForCapital', () => {
  it('sizes ₹40k to Nifty+Bank ×1 (index only)', () => {
    const p = planLotsForCapital(40_000);
    expect(p.niftyLots).toBe(1);
    expect(p.bankLots).toBe(1);
    expect(p.enableNifty).toBe(true);
    expect(p.enableBank).toBe(true);
    expect(p.estimatedPremiumRs).toBeLessThanOrEqual(p.premiumBudgetRs);
    expect(p.dailyTargetRs).toBe(2_000);
    expect(p.tenDayGoalRs).toBe(20_000);
    expect(p.dayProfitLockRs).toBe(3_000);
    expect('crudeLots' in p).toBe(false);
    expect('enableCrude' in p).toBe(false);
  });

  it('drops to a single book when capital is tight', () => {
    const p = planLotsForCapital(20_000);
    expect(p.estimatedPremiumRs).toBeLessThanOrEqual(p.premiumBudgetRs);
    expect(p.enableNifty || p.enableBank).toBe(true);
  });
});

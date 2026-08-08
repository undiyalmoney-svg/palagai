import { describe, expect, it } from 'vitest';
import { OPTION_TRAIL_PER_LOT_RS, planLotsForCapital } from './capital-plan.util';

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
    expect(p.riskLots).toBe(1);
    expect(p.optionTrailArmRs).toBe(OPTION_TRAIL_PER_LOT_RS.armRs);
    expect('crudeLots' in p).toBe(false);
    expect('enableCrude' in p).toBe(false);
  });

  it('drops to a single book when capital is tight', () => {
    const p = planLotsForCapital(20_000);
    expect(p.estimatedPremiumRs).toBeLessThanOrEqual(p.premiumBudgetRs);
    expect(p.enableNifty || p.enableBank).toBe(true);
    expect(p.niftyLots + p.bankLots).toBeGreaterThanOrEqual(1);
  });

  it('scales lots when capital grows — ₹6L must not stay at N1/B2', () => {
    const p = planLotsForCapital(600_000);
    expect(p.premiumBudgetRs).toBe(360_000);
    // Balanced scale: floor(360k / 22k) = 16 pair lots
    expect(p.niftyLots).toBeGreaterThanOrEqual(16);
    expect(p.bankLots).toBeGreaterThanOrEqual(16);
    expect(p.estimatedPremiumRs).toBeLessThanOrEqual(p.premiumBudgetRs);
    expect(p.dayProfitLockRs).toBe(3_000 * Math.max(p.niftyLots, p.bankLots));
    expect(p.optionTrailArmRs).toBe(OPTION_TRAIL_PER_LOT_RS.armRs * p.riskLots);
  });

  it('₹1L is larger than ₹40k', () => {
    const a = planLotsForCapital(40_000);
    const b = planLotsForCapital(100_000);
    expect(b.niftyLots + b.bankLots).toBeGreaterThan(a.niftyLots + a.bankLots);
    expect(b.estimatedPremiumRs).toBeLessThanOrEqual(b.premiumBudgetRs);
  });

  it('capital ladder: lock + trail scale with lots (40k / 1L / 6L)', () => {
    const ladder = [40_000, 100_000, 600_000].map((c) => planLotsForCapital(c));
    for (let i = 1; i < ladder.length; i += 1) {
      const prev = ladder[i - 1]!;
      const next = ladder[i]!;
      expect(next.riskLots).toBeGreaterThan(prev.riskLots);
      expect(next.dayProfitLockRs).toBe(3_000 * next.riskLots);
      expect(next.optionTrailArmRs).toBe(100 * next.riskLots);
      expect(next.dayProfitLockRs).toBeGreaterThan(prev.dayProfitLockRs);
      expect(next.optionTrailArmRs).toBeGreaterThan(prev.optionTrailArmRs);
    }
  });
});

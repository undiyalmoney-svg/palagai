import { describe, expect, it } from 'vitest';
import { applyChargesToOptionTrade, estimateRoundTripCharges } from './trade-charges.util';

describe('estimateRoundTripCharges', () => {
  it('returns zero for empty qty', () => {
    expect(estimateRoundTripCharges({ segment: 'nfo_option', entryPrice: 100, exitPrice: 110, quantity: 0 }).totalRs).toBe(
      0,
    );
  });

  it('charges less than gross move on a typical NFO option lot', () => {
    const c = estimateRoundTripCharges({
      segment: 'nfo_option',
      entryPrice: 100,
      exitPrice: 120,
      quantity: 65,
    });
    expect(c.totalRs).toBeGreaterThan(0);
    expect(c.brokerageRs).toBeLessThanOrEqual(40);
    expect(c.totalRs).toBeLessThan(65 * 20); // far below full point move
  });
});

describe('applyChargesToOptionTrade', () => {
  it('nets gross minus charges', () => {
    const r = applyChargesToOptionTrade({
      entryPremium: 100,
      exitPremium: 120,
      quantity: 65,
      grossPnlRs: 1300,
    });
    expect(r.netPnlRs).toBe(1300 - r.chargesRs);
    expect(r.chargesRs).toBeGreaterThan(0);
  });
});

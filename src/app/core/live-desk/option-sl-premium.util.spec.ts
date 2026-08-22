import { describe, expect, it } from 'vitest';
import {
  computeProtectiveSlTrigger,
  mcxMinSlGapPts,
  optionPremiumDelta,
} from './option-sl-premium.util';

describe('optionPremiumDelta', () => {
  it('uses full delta on MCX / crude symbols, half on NFO', () => {
    expect(optionPremiumDelta('MCX')).toBe(1);
    expect(optionPremiumDelta('NFO', 'CRUDEOILM26AUG8050CE')).toBe(1);
    expect(optionPremiumDelta('NFO', 'NIFTY2580024250CE')).toBe(0.5);
  });
});

describe('computeProtectiveSlTrigger', () => {
  it('NFO: fill − 0.5 × index risk', () => {
    expect(
      computeProtectiveSlTrigger({
        fillPremium: 109.9,
        indexRiskPts: 30,
        exchange: 'NFO',
        tradingSymbol: 'NIFTY2580024250CE',
      }),
    ).toBe(94.9);
  });

  it('MCX: enforces min gap so 0.5Δ-style 7.5pt SL cannot happen', () => {
    const t = computeProtectiveSlTrigger({
      fillPremium: 516.5,
      indexRiskPts: 15,
      exchange: 'MCX',
      tradingSymbol: 'CRUDEOILM26AUG8050CE',
    });
    // Old bug: 516.5 − 7.5 = 509. New: at least 25pt / 5% gap.
    expect(516.5 - t).toBeGreaterThanOrEqual(mcxMinSlGapPts(516.5) - 0.06);
    expect(t).toBeLessThanOrEqual(516.5 - 25);
  });

  it('pushes below LTP when raw trigger would already be through', () => {
    const t = computeProtectiveSlTrigger({
      fillPremium: 551.55,
      indexRiskPts: 15,
      exchange: 'MCX',
      tradingSymbol: 'CRUDEOILM26AUG8150CE',
      ltp: 544,
    });
    expect(t).toBeLessThan(544 - 20);
  });

  it('caps the loss at maxLossRs even when structural risk alone would allow more', () => {
    // Nifty weekly, 1 lot = 75 units, fill 60, max risk band 40pts × 0.5Δ = 20
    // → uncapped structural loss = 20 × 75 = ₹1,500, far past a ₹300 cap.
    const uncapped = computeProtectiveSlTrigger({
      fillPremium: 60,
      indexRiskPts: 40,
      exchange: 'NFO',
      tradingSymbol: 'NIFTY2580024250CE',
    });
    expect((60 - uncapped) * 75).toBeGreaterThan(300);

    const capped = computeProtectiveSlTrigger({
      fillPremium: 60,
      indexRiskPts: 40,
      exchange: 'NFO',
      tradingSymbol: 'NIFTY2580024250CE',
      maxLossRs: 300,
      lotUnits: 75,
    });
    const lossRs = (60 - capped) * 75;
    expect(lossRs).toBeLessThanOrEqual(300 + 0.05 * 75);
  });

  it('does not loosen the stop when maxLossRs is wider than the structural stop', () => {
    const withoutCap = computeProtectiveSlTrigger({
      fillPremium: 109.9,
      indexRiskPts: 30,
      exchange: 'NFO',
      tradingSymbol: 'NIFTY2580024250CE',
    });
    const withWideCap = computeProtectiveSlTrigger({
      fillPremium: 109.9,
      indexRiskPts: 30,
      exchange: 'NFO',
      tradingSymbol: 'NIFTY2580024250CE',
      maxLossRs: 100000,
      lotUnits: 75,
    });
    expect(withWideCap).toBe(withoutCap);
  });
});

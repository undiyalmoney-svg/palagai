import { describe, expect, it } from 'vitest';
import {
  computeProtectiveSlTrigger,
  optionPremiumDelta,
} from './option-sl-premium.util';

describe('optionPremiumDelta', () => {
  it('uses full delta on MCX crude, half on NFO', () => {
    expect(optionPremiumDelta('MCX')).toBe(1);
    expect(optionPremiumDelta('NFO')).toBe(0.5);
  });
});

describe('computeProtectiveSlTrigger', () => {
  it('NFO: fill − 0.5 × index risk (today-style nifty)', () => {
    expect(
      computeProtectiveSlTrigger({
        fillPremium: 109.9,
        indexRiskPts: 30,
        exchange: 'NFO',
      }),
    ).toBe(94.9);
  });

  it('MCX: fill − 1.0 × index risk (avoids ultra-tight crude SL)', () => {
    // Today: fill 551.55 · All-Green SL 15 → old 0.5Δ gave 544.05 (instant hit)
    expect(
      computeProtectiveSlTrigger({
        fillPremium: 551.55,
        indexRiskPts: 15,
        exchange: 'MCX',
      }),
    ).toBeCloseTo(536.55, 2);
  });

  it('pushes below LTP when raw trigger would already be through', () => {
    const t = computeProtectiveSlTrigger({
      fillPremium: 551.55,
      indexRiskPts: 15,
      exchange: 'MCX',
      ltp: 544,
    });
    expect(t).toBeLessThan(544);
  });
});

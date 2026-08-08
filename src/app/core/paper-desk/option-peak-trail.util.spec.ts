import { describe, expect, it } from 'vitest';
import {
  evaluateOptionPeakTrail,
  optionTrailFloorPremium,
  optionTrailSlTrigger,
} from './option-peak-trail.util';

describe('option peak trail (Paper≡Live money)', () => {
  it('does not arm before option MFE clears arm ₹', () => {
    const t = evaluateOptionPeakTrail({
      entryPremium: 100,
      optionPeakMfeRs: 40,
      optionBarLow: 99,
      lotUnits: 65,
      armRs: 100,
      lockRs: 50,
      givebackRs: 50,
    });
    expect(t?.armed).toBe(false);
    expect(t?.hit).toBe(false);
  });

  it('arms and hits when option low pierces floor premium', () => {
    // Peak ₹200 → floor max(50, 200-50)=150 → floorPrem = 100 + 150/65 ≈ 102.30
    const t = evaluateOptionPeakTrail({
      entryPremium: 100,
      optionPeakMfeRs: 200,
      optionBarLow: 102.3,
      lotUnits: 65,
      armRs: 100,
      lockRs: 50,
      givebackRs: 50,
    });
    expect(t?.armed).toBe(true);
    expect(t?.floorRs).toBe(150);
    expect(t?.floorPremium).toBeCloseTo(102.3, 1);
    expect(t?.hit).toBe(true);
  });

  it('does not hit while option still above floor', () => {
    const t = evaluateOptionPeakTrail({
      entryPremium: 100,
      optionPeakMfeRs: 200,
      optionBarLow: 104,
      lotUnits: 65,
      armRs: 100,
      lockRs: 50,
      givebackRs: 50,
    });
    expect(t?.armed).toBe(true);
    expect(t?.hit).toBe(false);
  });

  it('Live SL trigger only tightens to option floor', () => {
    expect(
      optionTrailFloorPremium({
        entryPremium: 80,
        optionPeakMfeRs: 40,
        lotUnits: 65,
        armRs: 100,
        lockRs: 50,
        givebackRs: 50,
      }),
    ).toBeNull();

    const floor = optionTrailSlTrigger({
      entryPremium: 80,
      optionPeakMfeRs: 200,
      lotUnits: 65,
      armRs: 100,
      lockRs: 50,
      givebackRs: 50,
      prevTrigger: 70,
    });
    // floor = 80 + 150/65 ≈ 82.30; max(70, 82.30)
    expect(floor).toBeGreaterThan(80);
    expect(floor).toBeGreaterThanOrEqual(82.25);
  });
});

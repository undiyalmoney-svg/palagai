import { describe, expect, it } from 'vitest';
import {
  evaluateOptionPeakTrail,
  optionPeakTrailSettingsFromExtras,
  optionTrailFloorPremium,
  optionTrailSlTrigger,
  scaleOptionPeakTrailSettings,
} from './option-peak-trail.util';

describe('option peak trail (Paper≡Live money)', () => {
  it('scales 1-lot DNA trail × lots so capital raises keep premium distance', () => {
    const one = optionPeakTrailSettingsFromExtras(
      { profitLockArmRs: 100, profitLockLockRs: 50, profitLockGivebackRs: 50 },
      1,
    );
    expect(one).toEqual({ armRs: 100, lockRs: 50, givebackRs: 50 });
    const sixteen = scaleOptionPeakTrailSettings(one, 16);
    expect(sixteen).toEqual({ armRs: 1_600, lockRs: 800, givebackRs: 800 });
  });

  it('multi-lot arm waits for proportional option MFE (not instant chop)', () => {
    // 2 lots · lotUnits 130: same +1.54 premium ≈ ₹200 MFE — must clear arm₹200.
    const early = evaluateOptionPeakTrail({
      entryPremium: 100,
      optionPeakMfeRs: 100, // would arm 1-lot DNA without scale
      optionBarLow: 99,
      lotUnits: 130,
      ...optionPeakTrailSettingsFromExtras(
        { profitLockArmRs: 100, profitLockLockRs: 50, profitLockGivebackRs: 50 },
        2,
      ),
    });
    expect(early?.armed).toBe(false);

    const ready = evaluateOptionPeakTrail({
      entryPremium: 100,
      optionPeakMfeRs: 200,
      optionBarLow: 104,
      lotUnits: 130,
      ...optionPeakTrailSettingsFromExtras(
        { profitLockArmRs: 100, profitLockLockRs: 50, profitLockGivebackRs: 50 },
        2,
      ),
    });
    expect(ready?.armed).toBe(true);
    // floorRs = max(100, 200-100)=100 → floorPrem = 100 + 100/130 ≈ 100.77
    expect(ready?.floorRs).toBe(100);
    expect(ready?.floorPremium).toBeCloseTo(100 + 100 / 130, 1);
  });

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

import { describe, expect, it } from 'vitest';
import {
  evaluateOptionPeakTrail,
  optionPeakTrailSettingsFromExtras,
  optionTrailFloorPremium,
  optionTrailSlTrigger,
  scaleOptionPeakTrailSettings,
} from './option-peak-trail.util';
import { estimateRoundTripCharges } from './trade-charges.util';

describe('option peak trail (Paper≡Live money)', () => {
  it('scales 1-lot DNA trail × lots so capital raises keep premium distance', () => {
    const one = optionPeakTrailSettingsFromExtras(
      { profitLockArmRs: 100, profitLockLockRs: 50, profitLockGivebackRs: 50 },
      1,
    );
    expect(one).toEqual({ armRs: 100, lockRs: 50, givebackRs: 50, chargeFloorMultiple: 0 });
    const sixteen = scaleOptionPeakTrailSettings(one, 16);
    expect(sixteen).toEqual({
      armRs: 1_600,
      lockRs: 800,
      givebackRs: 800,
      chargeFloorMultiple: 0,
    });
  });

  it('carries the charge multiple unscaled — charges already scale with quantity', () => {
    const two = optionPeakTrailSettingsFromExtras(
      {
        profitLockArmRs: 100,
        profitLockLockRs: 50,
        profitLockGivebackRs: 50,
        profitLockChargeMultiple: 2,
      },
      4,
    );
    expect(two).toEqual({
      armRs: 400,
      lockRs: 200,
      givebackRs: 200,
      chargeFloorMultiple: 2,
    });
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

describe('charge floor (audit C1 — smallest win must not be a net loss)', () => {
  // One Nifty lot, ATM-ish premium: the configuration the desk actually runs.
  const ENTRY = 120;
  const UNITS = 65;
  const TRAP_DNA = {
    profitLockArmRs: 100,
    profitLockLockRs: 50,
    profitLockGivebackRs: 50,
    profitLockChargeMultiple: 2,
  };

  const roundTripRs = () =>
    estimateRoundTripCharges({
      segment: 'nfo_option',
      entryPrice: ENTRY,
      exitPrice: ENTRY,
      quantity: UNITS,
    }).totalRs;

  it('prices one Nifty lot round trip at the flat-₹20/order options rate', () => {
    // Guards the rate itself: the min(₹20, 0.03%) slab priced this at ~₹20.
    expect(roundTripRs()).toBeCloseTo(61.7, 1);
  });

  it('is the ₹50 lock that made the smallest win a net loss', () => {
    const lockedGrossRs = 50;
    expect(lockedGrossRs - roundTripRs()).toBeLessThan(0);
  });

  it('refuses to arm while the peak cannot cover the charge floor', () => {
    const settings = optionPeakTrailSettingsFromExtras(TRAP_DNA, 1);
    // Peak ₹100 clears the ₹100 DNA arm but not 2× ₹61.70 of charges.
    const t = evaluateOptionPeakTrail({
      entryPremium: ENTRY,
      optionPeakMfeRs: 100,
      optionBarLow: ENTRY,
      lotUnits: UNITS,
      ...settings,
    });
    expect(t?.armed).toBe(false);
  });

  it('never locks a floor that settles negative, at any peak', () => {
    const settings = optionPeakTrailSettingsFromExtras(TRAP_DNA, 1);
    const charges = roundTripRs();
    for (let peak = 0; peak <= 2_000; peak += 5) {
      const t = evaluateOptionPeakTrail({
        entryPremium: ENTRY,
        optionPeakMfeRs: peak,
        optionBarLow: ENTRY,
        lotUnits: UNITS,
        ...settings,
      });
      if (!t?.armed) {
        continue;
      }
      expect(t.floorRs - charges).toBeGreaterThan(0);
      // A floor above the peak would book a fill the option never offered.
      expect(t.floorRs).toBeLessThanOrEqual(peak);
    }
  });

  it('holds the floor ≤ peak invariant even for an absurd multiple', () => {
    const t = evaluateOptionPeakTrail({
      entryPremium: ENTRY,
      optionPeakMfeRs: 620,
      optionBarLow: ENTRY,
      lotUnits: UNITS,
      ...optionPeakTrailSettingsFromExtras(
        { ...TRAP_DNA, profitLockChargeMultiple: 10 },
        1,
      ),
    });
    expect(t?.armed).toBe(true);
    expect(t?.floorRs).toBeLessThanOrEqual(620);
  });

  it('leaves giveback in charge for peaks well clear of the floor', () => {
    const t = evaluateOptionPeakTrail({
      entryPremium: ENTRY,
      optionPeakMfeRs: 400,
      optionBarLow: ENTRY,
      lotUnits: UNITS,
      ...optionPeakTrailSettingsFromExtras(TRAP_DNA, 1),
    });
    // max(123.40, 50, 400−50) → giveback still sets the floor.
    expect(t?.floorRs).toBe(350);
  });

  it('is inert when the multiple is off (pre-fix behaviour preserved)', () => {
    const base = {
      entryPremium: ENTRY,
      optionPeakMfeRs: 100,
      optionBarLow: ENTRY,
      lotUnits: UNITS,
      armRs: 100,
      lockRs: 50,
      givebackRs: 50,
    };
    const off = evaluateOptionPeakTrail(base);
    expect(off?.armed).toBe(true);
    expect(off?.floorRs).toBe(50);
    expect(evaluateOptionPeakTrail({ ...base, chargeFloorMultiple: 0 })).toEqual(off);
  });

  it('does not disturb Genie DNA, whose lock already clears charges', () => {
    const genie = {
      profitLockArmRs: 400,
      profitLockLockRs: 200,
      profitLockGivebackRs: 200,
      profitLockChargeMultiple: 2,
    };
    const withFloor = evaluateOptionPeakTrail({
      entryPremium: ENTRY,
      optionPeakMfeRs: 400,
      optionBarLow: ENTRY,
      lotUnits: UNITS,
      ...optionPeakTrailSettingsFromExtras(genie, 1),
    });
    const withoutFloor = evaluateOptionPeakTrail({
      entryPremium: ENTRY,
      optionPeakMfeRs: 400,
      optionBarLow: ENTRY,
      lotUnits: UNITS,
      ...optionPeakTrailSettingsFromExtras(
        { ...genie, profitLockChargeMultiple: 0 },
        1,
      ),
    });
    expect(withFloor).toEqual(withoutFloor);
  });

  it('scales the floor with lots, so multi-lot books arm on the same premium move', () => {
    const fourLots = evaluateOptionPeakTrail({
      entryPremium: ENTRY,
      optionPeakMfeRs: 4 * 130,
      optionBarLow: ENTRY,
      lotUnits: UNITS * 4,
      ...optionPeakTrailSettingsFromExtras(TRAP_DNA, 4),
    });
    expect(fourLots?.armed).toBe(true);
    const chargesFourLots = estimateRoundTripCharges({
      segment: 'nfo_option',
      entryPrice: ENTRY,
      exitPrice: ENTRY,
      quantity: UNITS * 4,
    }).totalRs;
    expect(fourLots!.floorRs).toBeGreaterThan(chargesFourLots);
  });
});

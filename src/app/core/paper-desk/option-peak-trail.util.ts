/**
 * Option-native peak trail — Paper ≡ Live money path.
 *
 * When option marks exist, trail arm / floor / hit are in option ₹, not index pts.
 * Index-only trail stays for research Locked (no option OHLC).
 *
 * DNA extras store **1-lot** arm/lock/giveback. Option MFE ₹ already includes
 * lots (`Δpremium × lotSize × lots`), so callers must scale trail ₹ × lots —
 * otherwise multi-lot capital arms instantly and chops Live.
 */
import { roundOptionPremiumTick } from '../live-desk/option-sl-premium.util';

export type OptionPeakTrailSettings = {
  armRs: number;
  lockRs: number;
  givebackRs: number;
};

/** Clamp lot multiplier used for trail / day-money scaling. */
export function clampTrailLots(lots: number | null | undefined): number {
  return Math.max(1, Math.floor(Number(lots) || 1) || 1);
}

/**
 * Scale 1-lot DNA trail bands to the working lot size.
 * ₹40k → ×1 (arm₹100); ₹6L → ×16 (arm₹1,600) so premium distance stays equal.
 */
export function scaleOptionPeakTrailSettings(
  base: OptionPeakTrailSettings,
  lots: number | null | undefined,
): OptionPeakTrailSettings {
  const n = clampTrailLots(lots);
  return {
    armRs: base.armRs * n,
    lockRs: base.lockRs * n,
    givebackRs: base.givebackRs * n,
  };
}

export function optionPeakTrailSettingsFromExtras(
  extras: Record<string, unknown> | null | undefined,
  lots: number | null | undefined = 1,
): OptionPeakTrailSettings {
  const x = extras ?? {};
  const base: OptionPeakTrailSettings = {
    armRs: typeof x['profitLockArmRs'] === 'number' ? x['profitLockArmRs'] : 600,
    lockRs: typeof x['profitLockLockRs'] === 'number' ? x['profitLockLockRs'] : 300,
    givebackRs:
      typeof x['profitLockGivebackRs'] === 'number' ? x['profitLockGivebackRs'] : 300,
  };
  return scaleOptionPeakTrailSettings(base, lots);
}

/**
 * Floor premium for a long CE/PE after option MFE clears arm ₹.
 * `floorPremium = entry + floorRs / lotUnits` (resting SL-M / paper touch).
 */
export function evaluateOptionPeakTrail(params: {
  entryPremium: number;
  optionPeakMfeRs: number;
  optionBarLow: number;
  lotUnits: number;
  armRs: number;
  lockRs: number;
  givebackRs: number;
}): { armed: boolean; floorRs: number; floorPremium: number; hit: boolean } | null {
  const entry = params.entryPremium;
  const units = params.lotUnits;
  if (!(entry > 0) || !(units > 0) || !(params.armRs > 0)) {
    return null;
  }
  if (!(params.optionPeakMfeRs >= params.armRs)) {
    return {
      armed: false,
      floorRs: 0,
      floorPremium: entry,
      hit: false,
    };
  }
  const floorRs = Math.max(
    params.lockRs,
    params.optionPeakMfeRs - Math.max(0, params.givebackRs),
  );
  const floorPremium = roundOptionPremiumTick(entry + floorRs / units);
  return {
    armed: true,
    floorRs,
    floorPremium,
    hit: params.optionBarLow <= floorPremium + 1e-9,
  };
}

/** Option trail floor premium once armed (no hit check). */
export function optionTrailFloorPremium(params: {
  entryPremium: number;
  optionPeakMfeRs: number;
  lotUnits: number;
  armRs: number;
  lockRs: number;
  givebackRs: number;
}): number | null {
  if (
    !(params.entryPremium > 0) ||
    !(params.lotUnits > 0) ||
    !(params.armRs > 0) ||
    !(params.optionPeakMfeRs >= params.armRs)
  ) {
    return null;
  }
  const floorRs = Math.max(
    params.lockRs,
    params.optionPeakMfeRs - Math.max(0, params.givebackRs),
  );
  return roundOptionPremiumTick(params.entryPremium + floorRs / params.lotUnits);
}

/** Tighten-only SL-M trigger for Live when option trail is armed. */
export function optionTrailSlTrigger(params: {
  entryPremium: number;
  optionPeakMfeRs: number;
  lotUnits: number;
  armRs: number;
  lockRs: number;
  givebackRs: number;
  /** Existing broker trigger — never loosen. */
  prevTrigger?: number | null;
}): number | null {
  const floor = optionTrailFloorPremium(params);
  if (floor == null) {
    return null;
  }
  const prev = params.prevTrigger ?? 0;
  // Long option SL-M: higher trigger = tighter. Only tighten.
  return Math.max(prev, floor);
}

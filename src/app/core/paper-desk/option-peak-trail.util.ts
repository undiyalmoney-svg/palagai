/**
 * Option-native peak trail — Paper ≡ Live money path.
 *
 * When option marks exist, trail arm / floor / hit are in option ₹, not index pts.
 * Index-only trail stays for research Locked (no option OHLC).
 *
 * DNA extras store **1-lot** arm/lock/giveback. Option MFE ₹ already includes
 * lots (`Δpremium × lotSize × lots`), so callers must scale trail ₹ × lots —
 * otherwise multi-lot capital arms instantly and chops Live.
 *
 * Charge floor: locking a gross ₹ below the round-trip cost books a NET LOSS.
 * At 1 Nifty lot the cost is ~₹58 against a ₹50 lock, so the smallest possible
 * "win" used to settle at −₹8. `chargeFloorMultiple` raises both the arm and
 * the floor to k × estimated charges so a locked exit is always net positive.
 */
import { roundOptionPremiumTick } from '../live-desk/option-sl-premium.util';
import { estimateRoundTripCharges, roundPaise } from './trade-charges.util';

export type OptionPeakTrailSettings = {
  armRs: number;
  lockRs: number;
  givebackRs: number;
  /**
   * Round-trip charges the locked ₹ must cover before any profit is booked.
   * A multiple, not a rupee band — never scaled by lots. 0 / omitted = off
   * (pre-charge-floor behaviour).
   */
  chargeFloorMultiple: number;
};

/** Option segment for the charge estimate. NFO and MCX price identically here. */
export type OptionChargeSegment = 'nfo_option' | 'mcx_option';

/**
 * Gross ₹ a locked exit must clear to be worth booking.
 *
 * Charges are evaluated at a flat exit (`exit = entry`) rather than at the
 * floor itself: the floor would otherwise depend on its own output, and over a
 * realistic profit range the estimate moves by paise (₹58.00 → ₹58.21 across a
 * ₹200 gain) while the self-reference would need iterating.
 */
export function minNetProfitFloorRs(params: {
  entryPremium: number;
  lotUnits: number;
  chargeFloorMultiple?: number | null;
  segment?: OptionChargeSegment;
}): number {
  const multiple = Number(params.chargeFloorMultiple) || 0;
  if (!(multiple > 0) || !(params.entryPremium > 0) || !(params.lotUnits > 0)) {
    return 0;
  }
  const { totalRs } = estimateRoundTripCharges({
    segment: params.segment ?? 'nfo_option',
    entryPrice: params.entryPremium,
    exitPrice: params.entryPremium,
    quantity: params.lotUnits,
  });
  return roundPaise(multiple * totalRs);
}

/**
 * Arm gate + locked ₹ for a peak trail, shared by every consumer so the paper
 * exit and the live SL trigger cannot drift apart.
 */
function resolveTrailFloorRs(params: {
  optionPeakMfeRs: number;
  armRs: number;
  lockRs: number;
  givebackRs: number;
  minFloorRs: number;
}): { armed: boolean; floorRs: number } {
  // Arming below the charge floor would lock a loss, so the floor also gates entry.
  const effectiveArmRs = Math.max(params.armRs, params.minFloorRs);
  if (!(params.optionPeakMfeRs >= effectiveArmRs)) {
    return { armed: false, floorRs: 0 };
  }
  const floorRs = Math.max(
    params.minFloorRs,
    params.lockRs,
    params.optionPeakMfeRs - Math.max(0, params.givebackRs),
  );
  // Never rest above the premium the option actually traded through, or the
  // exit books a fill that was never available.
  return { armed: true, floorRs: Math.min(params.optionPeakMfeRs, floorRs) };
}

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
    // A multiple of charges, and charges already scale with quantity.
    chargeFloorMultiple: base.chargeFloorMultiple,
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
    chargeFloorMultiple:
      typeof x['profitLockChargeMultiple'] === 'number' ? x['profitLockChargeMultiple'] : 0,
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
  chargeFloorMultiple?: number | null;
  segment?: OptionChargeSegment;
}): { armed: boolean; floorRs: number; floorPremium: number; hit: boolean } | null {
  const entry = params.entryPremium;
  const units = params.lotUnits;
  if (!(entry > 0) || !(units > 0) || !(params.armRs > 0)) {
    return null;
  }
  const { armed, floorRs } = resolveTrailFloorRs({
    optionPeakMfeRs: params.optionPeakMfeRs,
    armRs: params.armRs,
    lockRs: params.lockRs,
    givebackRs: params.givebackRs,
    minFloorRs: minNetProfitFloorRs({
      entryPremium: entry,
      lotUnits: units,
      chargeFloorMultiple: params.chargeFloorMultiple,
      segment: params.segment,
    }),
  });
  if (!armed) {
    return {
      armed: false,
      floorRs: 0,
      floorPremium: entry,
      hit: false,
    };
  }
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
  chargeFloorMultiple?: number | null;
  segment?: OptionChargeSegment;
}): number | null {
  if (!(params.entryPremium > 0) || !(params.lotUnits > 0) || !(params.armRs > 0)) {
    return null;
  }
  const { armed, floorRs } = resolveTrailFloorRs({
    optionPeakMfeRs: params.optionPeakMfeRs,
    armRs: params.armRs,
    lockRs: params.lockRs,
    givebackRs: params.givebackRs,
    minFloorRs: minNetProfitFloorRs({
      entryPremium: params.entryPremium,
      lotUnits: params.lotUnits,
      chargeFloorMultiple: params.chargeFloorMultiple,
      segment: params.segment,
    }),
  });
  if (!armed) {
    return null;
  }
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
  chargeFloorMultiple?: number | null;
  segment?: OptionChargeSegment;
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

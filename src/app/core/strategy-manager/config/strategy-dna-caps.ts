/**
 * Research DNA caps per managed strategy.
 * Max trades/day is unlocked (0 = unlimited) — any strategy may take any number of trades.
 * Target R still syncs from research DNA on strategy switch / desk hydrate.
 */
import { MANAGED_STRATEGY_IDS } from './managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';

export interface StrategyDnaCaps {
  /** Max trades per day for this strategy on the given channel. 0 = unlimited. */
  maxTradesPerDay: number;
  /** Optional R-multiple hint (informational / settings sync). */
  targetRMultiple?: number;
}

/**
 * Researched peak-trail + SL soft cutoff (reports/paper-loss-giveback-cutoff).
 * Always re-applied on desk hydrate so stale localStorage cannot keep arm₹1000.
 */
/**
 * Genie / SmartPullback protect DNA (unchanged).
 * Trap uses TRAP_1LOT_DAILY_DNA_EXTRAS instead (doc 43 1-lot hunt).
 */
export const PROTECTION_DNA_EXTRAS: Record<string, number | boolean> = {
  profitLockArmRs: 400,
  profitLockLockRs: 200,
  profitLockGivebackRs: 200,
  slConfirmCutoffEnabled: true,
  slConfirmCutoffFracR: 0.45,
  slConfirmCutoffMaxMfeR: 0.6,
  slConfirmSoftRs: 500,
};

/**
 * ALL-DAY-GREEN Trap DNA (v1.3.87 / doc 50):
 * pierce15 · Bank30 · bounce OR · peak₹100/50/50 · soft OFF · max 3/day.
 * Calendar OOS: ~96% green · **0% red** · ~4% flat (no confirm). Recent: 100% green.
 * Early peak trail is the green engine — hold-longer peak₹400 reintroduces red days.
 */
export const TRAP_1LOT_DAILY_DNA_EXTRAS: Record<string, number | boolean | string> = {
  piercePts: 15,
  bankPiercePts: 30,
  profitLockArmRs: 100,
  profitLockLockRs: 50,
  profitLockGivebackRs: 50,
  slConfirmCutoffEnabled: false,
  slConfirmCutoffFracR: 0,
  slConfirmCutoffMaxMfeR: 0,
  slConfirmSoftRs: 0,
  trapMode: 'both',
  /** Wide-day bounce so Bank/Nifty don't sit dump on large OR. */
  bounceOrPierceMult: 0.25,
  bounceOrPierceCap: 40,
};

/** @deprecated alias — prefer TRAP_1LOT_DAILY_DNA_EXTRAS */
export const TRAP_ENTRY_DNA_EXTRAS = TRAP_1LOT_DAILY_DNA_EXTRAS;

export function usesTrapEntryDna(strategyId: string): boolean {
  return strategyId === MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM;
}

/** Genie / SmartPullback protect DNA (Trap uses TRAP_1LOT_DAILY_DNA_EXTRAS). */
export function usesProtectionDna(strategyId: string): boolean {
  return (
    strategyId === MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE ||
    strategyId === MANAGED_STRATEGY_IDS.SMART_PULLBACK_PRO
  );
}

/**
 * Channel-aware DNA from hunts / live books.
 * Max trades are unlimited for every strategy; R targets remain research-backed.
 */
export function dnaCapsForStrategy(
  strategyId: string,
  channel: DeskChannel,
): StrategyDnaCaps {
  switch (strategyId) {
    case MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM:
      /** All-day-green: max 3 · RR2 · desk lock ₹3k · peak₹100 locks winners early. */
      return { maxTradesPerDay: 3, targetRMultiple: 2 };
    case MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE:
      return channel === 'bank'
        ? { maxTradesPerDay: 0, targetRMultiple: 1.5 }
        : { maxTradesPerDay: 0, targetRMultiple: 3 };
    case MANAGED_STRATEGY_IDS.SMART_PULLBACK_PRO:
      return { maxTradesPerDay: 0, targetRMultiple: 1.5 };
    case MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R:
      return { maxTradesPerDay: 0, targetRMultiple: 2 };
    case MANAGED_STRATEGY_IDS.GAP_FADE_500:
      return { maxTradesPerDay: 0 };
    case MANAGED_STRATEGY_IDS.INSIDE_BREAK:
      return { maxTradesPerDay: 0 };
    case MANAGED_STRATEGY_IDS.CHAMPION_PDHL:
      return { maxTradesPerDay: 0 };
    case MANAGED_STRATEGY_IDS.SWING_RETEST_EMA50_2R:
    case MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15:
    case MANAGED_STRATEGY_IDS.SWING5_PREV_DAY:
    case MANAGED_STRATEGY_IDS.DONCHIAN_20:
    case MANAGED_STRATEGY_IDS.DONCHIAN_55_TURTLE:
      return { maxTradesPerDay: 0, targetRMultiple: 2 };
    default:
      return { maxTradesPerDay: 0 };
  }
}

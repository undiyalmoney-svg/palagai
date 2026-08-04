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
 * 1-lot Daily ₹1k–₹3k Trap DNA (doc 43).
 * pierce10 · peak arm₹150 · soft OFF · IS/OOS ~89–90% days ≥₹1k · OOS p10~₹823.
 * Forced only on Trap.
 */
export const TRAP_1LOT_DAILY_DNA_EXTRAS: Record<string, number | boolean | string> = {
  piercePts: 10,
  profitLockArmRs: 150,
  profitLockLockRs: 75,
  profitLockGivebackRs: 75,
  slConfirmCutoffEnabled: false,
  slConfirmCutoffFracR: 0,
  slConfirmCutoffMaxMfeR: 0,
  slConfirmSoftRs: 0,
  trapMode: 'both',
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
      /** 1-lot hunt: RR2 matches peak-trail exits; day lock ₹3k keeps band. */
      return { maxTradesPerDay: 0, targetRMultiple: 2 };
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

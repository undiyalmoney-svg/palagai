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
 * Researched peak-trail + SL soft cutoff + day ₹ loss (docs 33/35 · peer hunt).
 * Always re-applied on desk hydrate so stale localStorage cannot keep arm₹1000.
 */
export const PROTECTION_DNA_EXTRAS: Record<string, number | boolean> = {
  profitLockArmRs: 600,
  profitLockLockRs: 300,
  profitLockGivebackRs: 300,
  slConfirmCutoffEnabled: true,
  slConfirmCutoffFracR: 0.55,
  slConfirmCutoffMaxMfeR: 0.75,
  slConfirmSoftRs: 700,
  /** Per-leg day loss ceiling (₹). Hydrate converts → dayStopPts via ₹/pt. */
  dayLossCapRs: 2500,
  /** Optional bank-&-quit (₹). 0 = off. Green book research uses 1000–1500 + 2R. */
  dayBankQuitRs: 0,
};

/** Strategies that share the researched Trap/Genie loss-cut DNA. */
export function usesProtectionDna(strategyId: string): boolean {
  return (
    strategyId === MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM ||
    strategyId === MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE ||
    strategyId === MANAGED_STRATEGY_IDS.SMART_PULLBACK_PRO
  );
}

/** Index ₹/pt used when converting day ₹ caps → pts. */
export function indexRsPerPoint(channel: DeskChannel): number {
  return channel === 'bank' ? 30 : 65;
}

/**
 * Convert researched day ₹ cutoffs into dayStopPts / dayProfitLockPts for a channel.
 */
export function protectionDayCapsFromExtras(
  extras: Record<string, number | boolean | string | undefined> | undefined,
  channel: DeskChannel,
): { dayStopPts?: number; dayProfitLockPts?: number } {
  if (channel !== 'nifty' && channel !== 'bank') {
    return {};
  }
  const rs = indexRsPerPoint(channel);
  const out: { dayStopPts?: number; dayProfitLockPts?: number } = {};
  const lossRs = Number(extras?.['dayLossCapRs'] ?? 0);
  const bankRs = Number(extras?.['dayBankQuitRs'] ?? 0);
  if (lossRs > 0) {
    out.dayStopPts = Math.max(1, Math.round(lossRs / rs));
  }
  if (bankRs > 0) {
    out.dayProfitLockPts = Math.max(1, Math.round(bankRs / rs));
  }
  return out;
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
      return { maxTradesPerDay: 0, targetRMultiple: 3.5 };
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

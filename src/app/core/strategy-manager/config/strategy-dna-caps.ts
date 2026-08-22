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
  /**
   * Hard ₹ loss cap per lot, enforced at the broker-side protective SL order
   * itself (see computeProtectiveSlTrigger's maxLossRs param) — not just a
   * periodic soft check. 0/undefined = no cap.
   */
  maxOptionLossRs?: number;
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
 * Option-₹ hunt DNA (₹40k N1/B1, Paper≡Live≡Autobot path):
 * pierce20 · Bank40 · peak₹100/50/50 **per lot** · soft OFF · max 3/day · RR 3.5 · bounceOR OFF.
 * Max 3/book (≤6 desk) — max5 hit 10 fills/day; scrap + charges ate edge.
 * Raise capital → more lots; trail ₹ scales × lots at runtime (same premium distance).
 */
export const TRAP_1LOT_DAILY_DNA_EXTRAS: Record<string, number | boolean | string> = {
  piercePts: 20,
  bankPiercePts: 40,
  /** 1-lot bands — Paper/Live multiply by lotsMultiplier. */
  profitLockArmRs: 100,
  profitLockLockRs: 50,
  profitLockGivebackRs: 50,
  slConfirmCutoffEnabled: false,
  slConfirmCutoffFracR: 0,
  slConfirmCutoffMaxMfeR: 0,
  slConfirmSoftRs: 0,
  trapMode: 'both',
  /** Must stay 0 — bounce-OR widen drifts DNA and hurts option money. */
  bounceOrPierceMult: 0,
  bounceOrPierceCap: 0,
};

/** @deprecated alias — prefer TRAP_1LOT_DAILY_DNA_EXTRAS */
export const TRAP_ENTRY_DNA_EXTRAS = TRAP_1LOT_DAILY_DNA_EXTRAS;

/**
 * SR_TRAP_CONFIRM_V2 entry DNA — the SINGLE source for every consumer that
 * needs to know what this strategy actually trades:
 *   - sr-trap-confirm-v2.managed-strategy.ts (Angular Trade Desk UI)
 *   - scripts/server-live/bundle-entry.ts → strategy-core.cjs (Order-API live)
 * Both import this literal object — copying its values into a second literal
 * anywhere is exactly the drift that put the wrong DNA live on Aug 18
 * (doc 51 RCA). Same pierce/risk/peak-trail numbers as TRAP_1LOT_DAILY_DNA_EXTRAS
 * (never invalidated by the audit — see plan) plus a real, enforced ₹/lot cap.
 */
export const TRAP_V2_ENTRY_DNA_EXTRAS: Record<string, number | boolean | string> = {
  ...TRAP_1LOT_DAILY_DNA_EXTRAS,
  /** Hard ₹/lot loss cap — read by computeProtectiveSlTrigger's maxLossRs param. */
  maxOptionLossRs: 300,
  /**
   * Active intraday entry windows (IST), [start, end).
   *
   * Research: 5yr Black-Scholes backtest over REAL Nifty 5-min index candles
   * (scripts/bs-backtest.js). Buckets selected on TRAIN 2021-24 only, then
   * confirmed on untouched HOLDOUT 2025-26:
   *   per-trade ₹183 → ₹275, profit factor 1.76 → 2.20, max DD −10.6k → −6.3k.
   * The train lift (+₹66/trade) and holdout lift (+₹92/trade) are the same
   * order of magnitude — the signature of a real effect rather than a fit.
   *
   * Cut windows are 10:30-11:00 and the 12:00-13:30 lunch lull, where the
   * edge was flat-to-negative (13:00 bucket: positive in only 3 of 6 years).
   * At ₹80/round-trip every removed marginal trade is a guaranteed saving,
   * which is most of why this helps.
   */
  entryWindows: '09:45-10:30,11:00-12:00,13:30-14:45',
};

export function usesTrapEntryDna(strategyId: string): boolean {
  return (
    strategyId === MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM ||
    strategyId === MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2
  );
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
      /** Option-₹ hunt: max 3 · RR3.5 · desk lock ₹3k · peak₹100 · pierce20/40. */
      return { maxTradesPerDay: 3, targetRMultiple: 3.5 };
    case MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2:
      /** Same caps as SR_TRAP_CONFIRM, plus an enforced ₹300/lot hard stop. */
      return { maxTradesPerDay: 3, targetRMultiple: 3.5, maxOptionLossRs: 300 };
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

/**
 * Crude Oil Mini strategy profiles for the Crude Desk.
 *
 * - champion: hunt pair (larger SL/TP, no day profit lock)
 * - daily-income: sized for ~₹300–₹1,000 / day on 1 lot (₹10/pt)
 * - trap-confirm: S/R Trap + Confirm (Nifty Trap DNA port) + peak-trail / soft cutoffs
 *
 * Live without real money = Live tab with "Live money" unchecked (paper fills).
 */
import {
  CRUDE_DAY_LOSS_STOP_PTS,
  CRUDE_EVENING_TARGET_PTS,
  CRUDE_MORNING_TARGET_PTS,
  CRUDE_RUPEES_PER_POINT,
  CRUDE_STOP_PTS,
  CRUDE_STRICT_DAY_LOSS_PTS,
} from './crude-pdhl-evening.evaluator';
import { CRUDE_TRAP_RR } from '../crude-trap-confirm/crude-trap-confirm.evaluator';

export type CrudeStrategyProfileId = 'champion' | 'daily-income' | 'trap-confirm';

export interface CrudeProtectParams {
  /** Peak MFE ₹ to arm trail (0 = off). */
  profitLockArmRs: number;
  profitLockLockRs: number;
  profitLockGivebackRs: number;
  /** Soft near-SL confirm cutoff. */
  slConfirmCutoffEnabled: boolean;
  slConfirmCutoffFracR: number;
  slConfirmCutoffMaxMfeR: number;
  slConfirmSoftRs: number;
}

export interface CrudeTradeParams extends CrudeProtectParams {
  profileId: CrudeStrategyProfileId;
  label: string;
  /** Futures stop distance (pts). Trap uses wick risk instead. */
  stopPts: number;
  morningTargetPts: number;
  eveningTargetPts: number;
  /** Trap profile: R-multiple target (0 = use fixed morning/evening targets). */
  targetRMultiple: number;
  /** Day max loss (pts). */
  dayLossStopPts: number;
  /** Stricter day max loss when desk checkbox is on. */
  strictDayLossPts: number;
  /**
   * Day profit lock (pts). 0 = off.
   * Daily Income: 100 pts = ₹1,000 at ₹10/pt — hard daily max.
   */
  dayProfitLockPts: number;
  /** Entry mode for desk engine. */
  entryMode: 'orb-pdhl' | 'trap-confirm';
  /** Short UI blurb (1 lot × ₹10). */
  dailyBandLabel: string;
}

const PROTECT_OFF: CrudeProtectParams = {
  profitLockArmRs: 0,
  profitLockLockRs: 0,
  profitLockGivebackRs: 0,
  slConfirmCutoffEnabled: false,
  slConfirmCutoffFracR: 0.55,
  slConfirmCutoffMaxMfeR: 0.75,
  slConfirmSoftRs: 700,
};

/** Same researched Trap cutoffs, ₹10/pt crude scale (arm ₹600 = 60 pts). */
const PROTECT_TRAP: CrudeProtectParams = {
  profitLockArmRs: 600,
  profitLockLockRs: 300,
  profitLockGivebackRs: 300,
  slConfirmCutoffEnabled: true,
  slConfirmCutoffFracR: 0.55,
  slConfirmCutoffMaxMfeR: 0.75,
  slConfirmSoftRs: 700,
};

/** Champion pair from Mar–Jul 2026 hunt — larger swings, no profit lock. */
export const CRUDE_CHAMPION_PARAMS: CrudeTradeParams = {
  profileId: 'champion',
  label: 'Champion (hunt pair)',
  stopPts: CRUDE_STOP_PTS,
  morningTargetPts: CRUDE_MORNING_TARGET_PTS,
  eveningTargetPts: CRUDE_EVENING_TARGET_PTS,
  targetRMultiple: 0,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: 'orb-pdhl',
  dailyBandLabel: 'Champion SL/TP · day loss −₹2,400',
  ...PROTECT_OFF,
};

/**
 * Daily income band for 1 lot (₹10/pt).
 * MCX Mar–Jul 2026 hunt: peak-trail/soft cut hurt expectancy — keep OFF.
 * Day profit lock + day loss remain the loss cutoffs.
 */
export const CRUDE_DAILY_INCOME_PARAMS: CrudeTradeParams = {
  profileId: 'daily-income',
  label: 'Daily Income (₹300–1,000)',
  stopPts: 40,
  morningTargetPts: 80,
  eveningTargetPts: 50,
  targetRMultiple: 0,
  dayLossStopPts: 50,
  strictDayLossPts: 80,
  dayProfitLockPts: 100,
  entryMode: 'orb-pdhl',
  dailyBandLabel: 'Aim ₹300–1,000/day · lock +₹1,000 · day −₹500',
  ...PROTECT_OFF,
};

/**
 * Crude Trap + Confirm — Trap DNA port (paper / research).
 * MCX Mar–Jul 2026: does not beat Champion; peak-trail hurt — keep OFF.
 * Day loss −₹2,500 remains.
 */
export const CRUDE_TRAP_CONFIRM_PARAMS: CrudeTradeParams = {
  profileId: 'trap-confirm',
  label: 'Trap Confirm (like Nifty Trap)',
  stopPts: 80,
  morningTargetPts: 0,
  eveningTargetPts: 0,
  targetRMultiple: CRUDE_TRAP_RR,
  dayLossStopPts: 250,
  strictDayLossPts: 295,
  dayProfitLockPts: 0,
  entryMode: 'trap-confirm',
  dailyBandLabel: 'S/R trap + confirm · 3.5R · day −₹2,500 (research)',
  ...PROTECT_OFF,
};

export const CRUDE_STRATEGY_PROFILES: Record<CrudeStrategyProfileId, CrudeTradeParams> = {
  champion: CRUDE_CHAMPION_PARAMS,
  'daily-income': CRUDE_DAILY_INCOME_PARAMS,
  'trap-confirm': CRUDE_TRAP_CONFIRM_PARAMS,
};

export function resolveCrudeStrategyProfile(
  profileId?: CrudeStrategyProfileId | null,
): CrudeTradeParams {
  if (profileId && CRUDE_STRATEGY_PROFILES[profileId]) {
    return CRUDE_STRATEGY_PROFILES[profileId];
  }
  return CRUDE_CHAMPION_PARAMS;
}

export function resolveCrudeProfileDayLossPts(
  params: CrudeTradeParams,
  strictDayStop?: boolean,
): number {
  return strictDayStop ? params.strictDayLossPts : params.dayLossStopPts;
}

export function crudePtsToRupees(pts: number, lots: number = 1): number {
  return pts * CRUDE_RUPEES_PER_POINT * Math.max(1, Math.floor(lots) || 1);
}

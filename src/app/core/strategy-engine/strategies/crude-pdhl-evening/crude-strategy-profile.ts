/**
 * Crude Oil Mini strategy profiles for the Crude Desk.
 *
 * - daily-profit: Trap-style evening PDHL + confirm · tight SL/TP · day lock (default)
 * - champion: hunt pair (larger SL/TP, no day profit lock)
 * - daily-income: sized for ~₹300–₹1,000 / day on 1 lot (₹10/pt) — weaker on MCX sample
 * - trap-confirm: S/R Trap + Confirm (Nifty Trap DNA port)
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

export type CrudeStrategyProfileId =
  | 'daily-profit'
  | 'champion'
  | 'daily-income'
  | 'trap-confirm';

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
   * Daily Profit: 50 pts = ₹500 at ₹10/pt.
   */
  dayProfitLockPts: number;
  /** Entry mode for desk engine. */
  entryMode: 'orb-pdhl' | 'trap-confirm';
  /** Next-bar confirm after PDHL/ORB signal (Daily Profit). */
  requireConfirm: boolean;
  /** Evening entry window end HH:MM (default 20:30). */
  eveningEntryEnd: string;
  /** Max evening fills/day. */
  maxEveningTradesDay: number;
  /** Desk default: Morning ORB on/off when this profile is selected. */
  defaultEnableMorning: boolean;
  /** Desk default: Evening PDHL on/off when this profile is selected. */
  defaultEnableEvening: boolean;
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

/**
 * Daily Profit (Trap-style) — MCX Mar–Jul 2026 hunt winner for green% + ₹/day.
 * Evening PDHL 18:30–21:00 + next-bar confirm · SL20 / TP40 · lock +50 · stop −40.
 * ~₹246/day · ~67% green days · PF ~2.9 · worst −₹400 (1 lot). Not 100% green.
 */
export const CRUDE_DAILY_PROFIT_PARAMS: CrudeTradeParams = {
  profileId: 'daily-profit',
  label: 'Daily Profit (Trap-style)',
  stopPts: 20,
  morningTargetPts: 40,
  eveningTargetPts: 40,
  targetRMultiple: 0,
  dayLossStopPts: 40,
  strictDayLossPts: 50,
  dayProfitLockPts: 50,
  entryMode: 'orb-pdhl',
  requireConfirm: true,
  eveningEntryEnd: '21:00',
  maxEveningTradesDay: 2,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: '~₹246/day hunt · ~67% green · lock +₹500 · day −₹400',
  ...PROTECT_OFF,
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
  requireConfirm: false,
  eveningEntryEnd: '20:30',
  maxEveningTradesDay: 1,
  defaultEnableMorning: true,
  defaultEnableEvening: true,
  dailyBandLabel: 'Champion SL/TP · day loss −₹2,400',
  ...PROTECT_OFF,
};

/**
 * Daily income band for 1 lot (₹10/pt).
 * MCX Mar–Jul 2026 hunt: negative expectancy — prefer Daily Profit.
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
  requireConfirm: false,
  eveningEntryEnd: '20:30',
  maxEveningTradesDay: 1,
  defaultEnableMorning: true,
  defaultEnableEvening: true,
  dailyBandLabel: 'Aim ₹300–1,000/day · lock +₹1,000 · day −₹500 (weaker on MCX)',
  ...PROTECT_OFF,
};

/**
 * Crude Trap + Confirm — Trap DNA port (paper / research).
 * MCX Mar–Jul 2026: does not beat Champion or Daily Profit.
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
  requireConfirm: true,
  eveningEntryEnd: '22:00',
  maxEveningTradesDay: 3,
  defaultEnableMorning: true,
  defaultEnableEvening: true,
  dailyBandLabel: 'S/R trap + confirm · 3.5R · day −₹2,500 (research)',
  ...PROTECT_OFF,
};

export const CRUDE_STRATEGY_PROFILES: Record<CrudeStrategyProfileId, CrudeTradeParams> = {
  'daily-profit': CRUDE_DAILY_PROFIT_PARAMS,
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
  return CRUDE_DAILY_PROFIT_PARAMS;
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

/**
 * Crude Oil Mini strategy profiles for the Crude Desk.
 *
 * - all-green: Session OR 09:00–09:30 · entries →23:00 · day −₹1,500 (default)
 * - daily-profit: Trap-style evening PDHL + confirm · tight SL/TP · day lock
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
import {
  CRUDE_SOR_ENTRY_END,
  CRUDE_SOR_ENTRY_START,
  CRUDE_SOR_MAX_OR_WIDTH,
  CRUDE_SOR_MAX_TRADES_DAY,
  CRUDE_SOR_OR_END,
  CRUDE_SOR_OR_START,
} from '../crude-session-or/crude-session-or.evaluator';

export type CrudeStrategyProfileId =
  | 'all-green'
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
   */
  dayProfitLockPts: number;
  /** Entry mode for desk engine. */
  entryMode: 'orb-pdhl' | 'trap-confirm' | 'session-or';
  /** Next-bar confirm after signal. */
  requireConfirm: boolean;
  /** Stop new entries after first green close (All-Green). */
  firstWinLock: boolean;
  /** Evening / afternoon entry window start HH:MM. */
  eveningEntryStart: string;
  /** Evening / afternoon entry window end HH:MM. */
  eveningEntryEnd: string;
  /** Session OR start (session-or mode). */
  sessionOrStart: string;
  /** Session OR end (session-or mode). */
  sessionOrEnd: string;
  /** Skip wide session OR (pts). */
  maxOrWidth: number;
  /** Max evening/afternoon fills/day. */
  maxEveningTradesDay: number;
  /** Desk default: Morning ORB on/off when this profile is selected. */
  defaultEnableMorning: boolean;
  /** Desk default: Evening/Afternoon window on/off when this profile is selected. */
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
 * All-Green — Session OR from market open; trade whenever desk is running.
 * OR 09:00–09:30 · entries after OR → 23:00 · SL12 / TP24 · day loss −₹1,500.
 */
export const CRUDE_ALL_GREEN_PARAMS: CrudeTradeParams = {
  profileId: 'all-green',
  label: 'All-Green (09:00–23:00)',
  stopPts: 12,
  morningTargetPts: 24,
  eveningTargetPts: 24,
  targetRMultiple: 0,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: 'session-or',
  requireConfirm: true,
  firstWinLock: false,
  eveningEntryStart: CRUDE_SOR_ENTRY_START,
  eveningEntryEnd: CRUDE_SOR_ENTRY_END,
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: 'OR 09:00–09:30 · SL₹120/TP₹240 · unlimited · day −₹1,500',
  ...PROTECT_OFF,
};

/**
 * Daily Profit (Trap-style) — evening PDHL + confirm.
 * Unlimited · day loss −₹1,500 · per-trade SL20 / TP40.
 */
export const CRUDE_DAILY_PROFIT_PARAMS: CrudeTradeParams = {
  profileId: 'daily-profit',
  label: 'Daily Profit (Trap-style)',
  stopPts: 20,
  morningTargetPts: 40,
  eveningTargetPts: 40,
  targetRMultiple: 0,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: 'orb-pdhl',
  requireConfirm: true,
  firstWinLock: false,
  eveningEntryStart: '18:30',
  eveningEntryEnd: '21:00',
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: 'Eve PDHL+confirm · SL₹200/TP₹400 · unlimited · day −₹1,500',
  ...PROTECT_OFF,
};

/** Champion pair — larger swings; unlimited trades; day loss −₹1,500. */
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
  firstWinLock: false,
  eveningEntryStart: '18:30',
  eveningEntryEnd: '20:30',
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: true,
  defaultEnableEvening: true,
  dailyBandLabel: 'Champion SL80/TP250·150 · unlimited · day −₹1,500',
  ...PROTECT_OFF,
};

/**
 * Daily income band for 1 lot (₹10/pt).
 * Unlimited · day loss −₹1,500 · per-trade SL/TP.
 */
export const CRUDE_DAILY_INCOME_PARAMS: CrudeTradeParams = {
  profileId: 'daily-income',
  label: 'Daily Income (₹300–1,000)',
  stopPts: 40,
  morningTargetPts: 80,
  eveningTargetPts: 50,
  targetRMultiple: 0,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: 'orb-pdhl',
  requireConfirm: false,
  firstWinLock: false,
  eveningEntryStart: '18:30',
  eveningEntryEnd: '20:30',
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: true,
  defaultEnableEvening: true,
  dailyBandLabel: 'SL40 / TP80·50 · unlimited · day −₹1,500',
  ...PROTECT_OFF,
};

/**
 * Crude Trap + Confirm — Trap DNA port (paper / research).
 * Unlimited · day loss −₹1,500 · per-trade wick SL / 3.5R TP.
 */
export const CRUDE_TRAP_CONFIRM_PARAMS: CrudeTradeParams = {
  profileId: 'trap-confirm',
  label: 'Trap Confirm (like Nifty Trap)',
  stopPts: 80,
  morningTargetPts: 0,
  eveningTargetPts: 0,
  targetRMultiple: CRUDE_TRAP_RR,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: 'trap-confirm',
  requireConfirm: true,
  firstWinLock: false,
  eveningEntryStart: '10:00',
  eveningEntryEnd: '22:00',
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: true,
  defaultEnableEvening: true,
  dailyBandLabel: 'S/R trap + confirm · 3.5R · unlimited · day −₹1,500',
  ...PROTECT_OFF,
};

export const CRUDE_STRATEGY_PROFILES: Record<CrudeStrategyProfileId, CrudeTradeParams> = {
  'all-green': CRUDE_ALL_GREEN_PARAMS,
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
  return CRUDE_ALL_GREEN_PARAMS;
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

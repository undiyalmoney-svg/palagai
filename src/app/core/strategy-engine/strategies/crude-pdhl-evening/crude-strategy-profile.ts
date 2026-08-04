/**
 * Crude Oil Mini strategy profiles for the Crude Desk.
 *
 * - selective: charge-aware · max 2/day · SL20/TP40 · 10:00–22:00 (Trade Desk default · doc 41/43)
 * - all-green: Session OR 09:00–09:30 · entries →23:00 · per-trade SL/trail (Experiments picker only)
 * - daily-profit: Trap-style evening PDHL + confirm · tight SL/TP
 * - champion: hunt pair (larger SL/TP)
 * - daily-income: sized for ~₹300–₹1,000 / day on 1 lot (₹10/pt)
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
  CRUDE_SOR_OR_END,
  CRUDE_SOR_OR_START,
} from '../crude-session-or/crude-session-or.evaluator';

export type CrudeStrategyProfileId =
  | 'all-green'
  | 'selective'
  | 'daily-profit'
  | 'daily-profit-ng'
  | 'champion'
  | 'daily-income'
  | 'trap-confirm';

/** Trap arm style — Nat Gas daily-profit uses trap-only (no soft bounce). */
export type CrudeTrapEntryStyle = 'trap' | 'bounce' | 'both';

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
  /** Day max loss (pts). 0 = off (hunt next trade after SL). */
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
  /**
   * Trap pierce beyond swing (pts). Undefined → crude default pierce (8).
   * Nat Gas daily-profit DNA uses 0.2.
   */
  piercePts?: number;
  /** Trap arm style. Undefined → both trap + bounce (legacy crude trap). */
  trapEntryStyle?: CrudeTrapEntryStyle;
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
 * Per-trade protect (1 lot × ₹10/pt):
 * - Loss to ₹150 → stop that trade, hunt next
 * - Profit peaks ₹500 → arm trail; giveback to ₹240 floor → cut & rehunt
 */
const PROTECT_TRADE_CUTOFF: CrudeProtectParams = {
  profitLockArmRs: 500,
  profitLockLockRs: 240,
  profitLockGivebackRs: 260,
  slConfirmCutoffEnabled: false,
  slConfirmCutoffFracR: 0.55,
  slConfirmCutoffMaxMfeR: 0.75,
  slConfirmSoftRs: 700,
};

/** All-Green per-trade SL ₹150 (= 15 pts). */
export const CRUDE_ALL_GREEN_STOP_PTS = 15;
/**
 * Stretch target above trail arm so peak-trail can manage the exit
 * (hard TP ₹1,000; trail usually cuts earlier after ₹500 peak).
 */
export const CRUDE_ALL_GREEN_TARGET_PTS = 100;

/**
 * All-Green — Session OR from market open; trade whenever desk is running.
 * OR 09:00–09:30 · entries after OR → 23:00 · per-trade SL ₹150 · trail ₹500→₹240.
 * No day-wide stop — after SL / drained cut, look for next opportunity.
 */
export const CRUDE_ALL_GREEN_PARAMS: CrudeTradeParams = {
  profileId: 'all-green',
  label: 'All-Green (09:00–23:00)',
  stopPts: CRUDE_ALL_GREEN_STOP_PTS,
  morningTargetPts: CRUDE_ALL_GREEN_TARGET_PTS,
  eveningTargetPts: CRUDE_ALL_GREEN_TARGET_PTS,
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
  dailyBandLabel: 'OR 09:00–09:30 · SL₹150 · trail ₹500→₹240 · no OR skip',
  ...PROTECT_TRADE_CUTOFF,
};

/**
 * Selective — charge-aware Crude (doc 41 + re-hunt doc 42 + desk ₹3k doc 43).
 * Desk ₹3k hunt: SL20/TP40 · session 10:00–22:00 · max 2/day · no OR skip
 * lifts ≥₹3k hit-rate vs eve-only while staying far below All-Green churn.
 */
export const CRUDE_SELECTIVE_PARAMS: CrudeTradeParams = {
  profileId: 'selective',
  label: 'Selective (≤2/day · SL20/TP40)',
  stopPts: 20,
  morningTargetPts: 40,
  eveningTargetPts: 40,
  targetRMultiple: 0,
  dayLossStopPts: 40,
  strictDayLossPts: 40,
  dayProfitLockPts: 0,
  entryMode: 'session-or',
  requireConfirm: true,
  firstWinLock: false,
  eveningEntryStart: '10:00',
  eveningEntryEnd: '22:00',
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: 0,
  maxEveningTradesDay: 2,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: '10:00–22:00 · SL20/TP40 · confirm · max 2/day · no OR skip',
  ...PROTECT_OFF,
};

/**
 * Daily Profit (Trap-style) — evening PDHL + confirm.
 * Unlimited · no day lock · per-trade SL20 / TP40.
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
  dailyBandLabel: 'Eve PDHL+confirm · SL₹200/TP₹400 · unlimited · no day stop',
  ...PROTECT_OFF,
};

/** Champion pair — larger swings; unlimited trades; no day stop. */
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
  dailyBandLabel: 'Champion SL80/TP250·150 · unlimited · no day stop',
  ...PROTECT_OFF,
};

/**
 * Daily income band for 1 lot (₹10/pt).
 * Unlimited · no day stop · per-trade SL/TP.
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
  dailyBandLabel: 'SL40 / TP80·50 · unlimited · no day stop',
  ...PROTECT_OFF,
};

/**
 * Crude Trap + Confirm — Trap DNA port (paper / research).
 * Unlimited · no day stop · per-trade wick SL / 3.5R TP.
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
  dailyBandLabel: 'S/R trap + confirm · 3.5R · unlimited · no day stop',
  ...PROTECT_OFF,
};

/**
 * Nat Gas Mini Daily Profit — hunt DNA (doc 39).
 * Trap-only · pierce 0.2 · fixed SL 1.5 / TP 3 · confirm · first-win · max 1/day.
 * ₹50/pt → SL ₹75 / TP ₹150 / day loss ₹150.
 */
export const NATGAS_DAILY_PROFIT_PARAMS: CrudeTradeParams = {
  profileId: 'daily-profit-ng',
  label: 'Daily Profit (NG)',
  stopPts: 1.5,
  morningTargetPts: 3,
  eveningTargetPts: 3,
  targetRMultiple: 0,
  dayLossStopPts: 3,
  strictDayLossPts: 3,
  dayProfitLockPts: 0,
  entryMode: 'trap-confirm',
  requireConfirm: true,
  firstWinLock: true,
  eveningEntryStart: '10:00',
  eveningEntryEnd: '22:00',
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 1,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: 'NG trap · pierce 0.2 · SL1.5/TP3 · confirm · first-win · max 1/day',
  piercePts: 0.2,
  trapEntryStyle: 'trap',
  ...PROTECT_OFF,
};

export const CRUDE_STRATEGY_PROFILES: Record<CrudeStrategyProfileId, CrudeTradeParams> = {
  'all-green': CRUDE_ALL_GREEN_PARAMS,
  selective: CRUDE_SELECTIVE_PARAMS,
  'daily-profit': CRUDE_DAILY_PROFIT_PARAMS,
  'daily-profit-ng': NATGAS_DAILY_PROFIT_PARAMS,
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

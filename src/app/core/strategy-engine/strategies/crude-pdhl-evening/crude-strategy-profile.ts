/**
 * Crude Oil Mini strategy profiles for the Crude Desk.
 *
 * - champion: hunt pair (larger SL/TP, no day profit lock)
 * - daily-income: sized for ~₹300–₹1,000 / day on 1 lot (₹10/pt)
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

export type CrudeStrategyProfileId = 'champion' | 'daily-income';

export interface CrudeTradeParams {
  profileId: CrudeStrategyProfileId;
  label: string;
  /** Futures stop distance (pts). */
  stopPts: number;
  morningTargetPts: number;
  eveningTargetPts: number;
  /** Day max loss (pts). */
  dayLossStopPts: number;
  /** Stricter day max loss when desk checkbox is on. */
  strictDayLossPts: number;
  /**
   * Day profit lock (pts). 0 = off.
   * Daily Income: 100 pts = ₹1,000 at ₹10/pt — hard daily max.
   */
  dayProfitLockPts: number;
  /** Short UI blurb (1 lot × ₹10). */
  dailyBandLabel: string;
}

/** Champion pair from Mar–Jul 2026 hunt — larger swings, no profit lock. */
export const CRUDE_CHAMPION_PARAMS: CrudeTradeParams = {
  profileId: 'champion',
  label: 'Champion (hunt pair)',
  stopPts: CRUDE_STOP_PTS,
  morningTargetPts: CRUDE_MORNING_TARGET_PTS,
  eveningTargetPts: CRUDE_EVENING_TARGET_PTS,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  dailyBandLabel: 'Champion SL/TP · no day profit lock',
};

/**
 * Daily income band for 1 lot (₹10/pt):
 * - Target wins land ~₹500–₹800
 * - Day profit lock ₹1,000 (100 pts) — stop new entries after lock
 * - Day loss stop ₹500 (50 pts); strict ₹800
 * - Tighter SL ₹400 (40 pts) vs champion 80
 */
export const CRUDE_DAILY_INCOME_PARAMS: CrudeTradeParams = {
  profileId: 'daily-income',
  label: 'Daily Income (₹300–1,000)',
  stopPts: 40,
  morningTargetPts: 80,
  eveningTargetPts: 50,
  dayLossStopPts: 50,
  strictDayLossPts: 80,
  dayProfitLockPts: 100,
  dailyBandLabel: 'Aim ₹300–1,000/day · lock +₹1,000 · 1 lot × ₹10/pt',
};

export const CRUDE_STRATEGY_PROFILES: Record<CrudeStrategyProfileId, CrudeTradeParams> = {
  champion: CRUDE_CHAMPION_PARAMS,
  'daily-income': CRUDE_DAILY_INCOME_PARAMS,
};

export function resolveCrudeStrategyProfile(
  profileId?: CrudeStrategyProfileId | null,
): CrudeTradeParams {
  if (profileId && CRUDE_STRATEGY_PROFILES[profileId]) {
    return CRUDE_STRATEGY_PROFILES[profileId];
  }
  return CRUDE_DAILY_INCOME_PARAMS;
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

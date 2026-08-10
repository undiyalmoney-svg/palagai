/**
 * Option-₹ day-loss stand-down (Live money).
 *
 * Index dayStopPts does not protect option premium: a −₹70 / −₹300 Bank PE
 * scratch can be only a few index points, so the desk keeps re-entering and
 * stacks red option fills (2026-08-10: −₹593 across 2×Bank PE + Nifty CE).
 *
 * When combined closed option ₹ ≤ −threshold, block new entries for the day.
 * Threshold scales with lots (1-lot band × lots). ₹350 stops the 3rd fill after −₹381.
 */

/**
 * Combined index books, 1-lot band.
 * 2026-08-10 Bank PE stack was −₹381 before the Nifty CE scratch — ₹350 stops that third fill.
 */
export const DESK_OPTION_DAY_LOSS_RS = 350;

export function deskOptionDayLossMoneyRs(lots: number): number {
  return DESK_OPTION_DAY_LOSS_RS * Math.max(1, Math.floor(Number(lots)) || 1);
}

/** True when closed option P&L has breached the day-loss floor. */
export function isOptionDayLossBreached(
  combinedOptionNetRs: number,
  lots = 1,
  thresholdRs: number = DESK_OPTION_DAY_LOSS_RS,
): boolean {
  const floor = -Math.abs(thresholdRs) * Math.max(1, Math.floor(Number(lots)) || 1);
  return Number.isFinite(combinedOptionNetRs) && combinedOptionNetRs <= floor;
}

export function optionDayLossReason(
  combinedOptionNetRs: number,
  lots = 1,
): string {
  const floor = deskOptionDayLossMoneyRs(lots);
  return (
    `Option day-loss stand-down · net ₹${combinedOptionNetRs.toFixed(0)} ` +
    `≤ −₹${floor} — no new entries today (index pts day-stop does not cover premium).`
  );
}

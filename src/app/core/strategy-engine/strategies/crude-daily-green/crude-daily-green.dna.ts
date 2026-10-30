/**
 * Crude Mini evening PDHL scalp, tuned to raise green days vs Daily Profit.
 *
 * Same SL20/TP40 · confirm · max 2 as Daily Profit, plus skip when yesterday's
 * range is wider than 400 pts (chaotic sessions). First-win lock was tested and
 * *lowered* green days because a second fill is what turns a loser into a green day.
 *
 * Sample (CRUDEOILM 5m 2026-05-21 → 2026-10-30, ₹50/RT, 1 lot ₹10/pt):
 *   baseline 65.8% green · ₹90/day
 *   this DNA 67.6% green · ₹99/day · OOS Sep–Oct 68.2%
 * Not every calendar day. Not a guaranteed profit.
 */
export const CRUDE_DAILY_GREEN_ID = 'daily-green-pd400';

export const CRUDE_DAILY_GREEN = {
  profileId: CRUDE_DAILY_GREEN_ID,
  entryStart: '18:30',
  entryEnd: '21:00',
  flatten: '23:10',
  stopPts: 20,
  targetPts: 40,
  dayLockPts: 50,
  dayLossPts: 40,
  maxTrades: 2,
  firstWin: false,
  confirm: true,
  emaFilter: false,
  maxPrevDayRangePts: 400,
  rupeesPerPoint: 10,
  chargeRs: 50,
} as const;

export type CrudeDailyGreenDna = typeof CRUDE_DAILY_GREEN;

export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function prevDayRangePts(high: number, low: number): number {
  if (!(high > 0) || !(low > 0) || high < low) return 0;
  return high - low;
}

export function skipWildPrevDay(
  high: number,
  low: number,
  maxRange = CRUDE_DAILY_GREEN.maxPrevDayRangePts,
): boolean {
  const width = prevDayRangePts(high, low);
  return width > maxRange;
}

export function pdhlDir(close: number, open: number, pdh: number, pdl: number): 1 | -1 | 0 {
  if (close > pdh && close > open) return 1;
  if (close < pdl && close < open) return -1;
  return 0;
}

export function confirmDir(
  dir: 1 | -1,
  signalClose: number,
  nextOpen: number,
  nextClose: number,
): boolean {
  if (dir === 1) return nextClose > nextOpen && nextClose > signalClose;
  return nextClose < nextOpen && nextClose < signalClose;
}

/**
 * Crude Mini all-session PDHL scalp with a weekly stand-down.
 *
 * Day DNA: SL20/TP40 · confirm · max 2 · skip yesterday range > 400 pts.
 * Window: 09:00–23:00 IST (more fills than the old 18:30–21:00 evening cut).
 * Week DNA: after the week is +80 pts (~₹800 before the last ticket's charges),
 * stop hunting. That banks a green week instead of giving it back.
 *
 * Sample (CRUDEOILM 5m 2026-05-21 → 2026-10-30, ₹50/RT, 1 lot ₹10/pt):
 *   18:30–21:00 + week lock 80  52 fills · 73% green weeks · ₹355/week
 *   09:00–23:00 + week lock 80  70 fills · 80% green weeks · ₹393/week · worst −₹400
 * Not every week. Not a guaranteed profit.
 */
export const CRUDE_DAILY_GREEN_ID = 'weekly-green-l80';

export const CRUDE_DAILY_GREEN = {
  profileId: CRUDE_DAILY_GREEN_ID,
  entryStart: '09:00',
  entryEnd: '23:00',
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
  /** Gross points. Two 40-pt targets bank the week. */
  weekLockPts: 80,
  weekLossPts: 0,
  sitAfterRedDay: false,
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

/** Monday 00:00 IST week key from YYYY-MM-DD. */
export function weekMonday(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const wd = dt.getUTCDay(); // 0 Sun … 6 Sat
  const back = wd === 0 ? 6 : wd - 1;
  dt.setUTCDate(dt.getUTCDate() - back);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function weekShouldStandDown(
  weekNetPts: number,
  lockPts = CRUDE_DAILY_GREEN.weekLockPts,
  lossPts = CRUDE_DAILY_GREEN.weekLossPts,
): boolean {
  if (lockPts > 0 && weekNetPts >= lockPts) return true;
  if (lossPts > 0 && weekNetPts <= -lossPts) return true;
  return false;
}

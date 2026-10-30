/**
 * Crude Mini weekly-bank scalp.
 *
 * Invented on CRUDEOILM 5m 2026-05-21 → 2026-10-30 (₹50/RT, 1 lot ₹10/pt):
 *   TP 30 hits more often than 40. An 8-pt scratch (and first-bar against close)
 *   gets out before the 20-pt hard SL. Day lock +20 banks a small green day.
 *   Week lock +40 sits down so a green week is not washed out.
 *
 *   Sample: 15 weeks · 100% green weeks · ₹305/week · worst week +₹110 · 0 hard-SL hits.
 *   Baseline L80 (TP40, wait for 20-pt SL): 80% green weeks · ₹393/week · worst −₹400 · 31 SL hits.
 *
 * Not a guaranteed profit. Fifteen weeks is a sample. Next week can still lose.
 */
export const CRUDE_DAILY_GREEN_ID = 'weekly-bank-sc8';

export const CRUDE_DAILY_GREEN = {
  profileId: CRUDE_DAILY_GREEN_ID,
  entryStart: '09:00',
  entryEnd: '23:00',
  flatten: '23:10',
  stopPts: 20,
  /** Smell of loss — flatten here, do not wait for stopPts. */
  scratchPts: 8,
  smellFirstBar: true,
  targetPts: 30,
  dayLockPts: 20,
  dayLossPts: 40,
  maxTrades: 2,
  firstWin: true,
  confirm: true,
  emaFilter: false,
  maxPrevDayRangePts: 400,
  weekLockPts: 40,
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

/** Adverse points from entry. Long: entry−last. Short: last−entry. */
export function adversePts(dir: 1 | -1, entry: number, last: number): number {
  if (!(entry > 0) || !(last > 0)) return 0;
  return dir === 1 ? entry - last : last - entry;
}

export function shouldScratch(
  dir: 1 | -1,
  entry: number,
  last: number,
  scratch = CRUDE_DAILY_GREEN.scratchPts,
): boolean {
  return scratch > 0 && adversePts(dir, entry, last) >= scratch;
}

/** First closed bar after fill closes against the trade — get out at that close. */
export function smellAgainst(dir: 1 | -1, entry: number, barClose: number): boolean {
  if (!(entry > 0) || !(barClose > 0)) return false;
  return dir === 1 ? barClose < entry : barClose > entry;
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

export function dayShouldStandDown(
  dayNetPts: number,
  tradesToday: number,
  dna: Pick<
    CrudeDailyGreenDna,
    'maxTrades' | 'dayLossPts' | 'dayLockPts' | 'firstWin'
  > = CRUDE_DAILY_GREEN,
): boolean {
  if (tradesToday >= dna.maxTrades) return true;
  if (dayNetPts <= -dna.dayLossPts) return true;
  if (dna.dayLockPts > 0 && dayNetPts >= dna.dayLockPts) return true;
  if (dna.firstWin && dayNetPts > 0) return true;
  return false;
}

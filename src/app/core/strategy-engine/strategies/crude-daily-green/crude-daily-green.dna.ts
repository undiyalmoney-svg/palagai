/**
 * Crude Mini daily-min scalp.
 *
 * Invented on CRUDEOILM 5m 2026-05-21 → 2026-10-30 (₹50/RT, 1 lot ₹10/pt):
 *   PDHL breakout alone pays ₹150 on 27% of full-session days and sits out
 *   most red / sideways sessions. Adding 10:00–11:00 OR fade + 6-bar trap
 *   lifts ₹150+ days to 43/74 (58%) — red 50%, sideways 64%, greenish 60%.
 *   TP 25 = ₹200 after charges on a clean ticket. Scratch 10 (still before SL 20).
 *   Sit at first win / +20. Week lock off so later days still hunt.
 *
 *   Quiet/thin sessions still pay 0. Guaranteed-profit gate (every full session
 *   green after charges) failed 4,321 books — 0 passed. Worst tradable day −₹300.
 */
export const CRUDE_DAILY_GREEN_ID = 'daily-min-sc10';

export const CRUDE_DAILY_GREEN = {
  profileId: CRUDE_DAILY_GREEN_ID,
  entryStart: '10:00',
  entryEnd: '23:00',
  flatten: '23:10',
  orStart: '10:00',
  orEnd: '11:00',
  stopPts: 20,
  /** Smell of loss — flatten here, do not wait for stopPts. 8-pt scratch on this mix printed a −₹610 week. */
  scratchPts: 10,
  smellFirstBar: true,
  /** ₹200 after ₹50 RT on a clean 1-lot fill. */
  targetPts: 25,
  dayLockPts: 20,
  dayLossPts: 40,
  maxTrades: 2,
  firstWin: true,
  confirm: true,
  emaFilter: false,
  maxPrevDayRangePts: 400,
  /** Off — a green Monday must not block Tuesday’s ₹150 hunt. */
  weekLockPts: 0,
  weekLossPts: 0,
  sitAfterRedDay: false,
  trapPiercePts: 8,
  trapLookback: 6,
  orMinWidthPts: 12,
  orMaxWidthPts: 220,
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

/** Fade back into the 10:00–11:00 IST opening range after 11:00. */
export function orbFadeDir(
  close: number,
  open: number,
  high: number,
  low: number,
  orHigh: number,
  orLow: number,
  barMin: number,
  orEndMin = hhmmToMin(CRUDE_DAILY_GREEN.orEnd),
  minW = CRUDE_DAILY_GREEN.orMinWidthPts,
  maxW = CRUDE_DAILY_GREEN.orMaxWidthPts,
): 1 | -1 | 0 {
  if (barMin <= orEndMin) return 0;
  const width = orHigh - orLow;
  if (!(width >= minW) || width > maxW) return 0;
  if (high > orHigh && close < orHigh && close < open) return -1;
  if (low < orLow && close > orLow && close > open) return 1;
  return 0;
}

/** Pierce a 6-bar swing and close back through it — trap reversal. */
export function trapDir(
  close: number,
  open: number,
  high: number,
  low: number,
  swingHigh: number,
  swingLow: number,
  pierce = CRUDE_DAILY_GREEN.trapPiercePts,
): 1 | -1 | 0 {
  if (!(swingHigh > 0) || !(swingLow > 0)) return 0;
  if (low < swingLow - pierce && close > swingLow && close > open) return 1;
  if (high > swingHigh + pierce && close < swingHigh && close < open) return -1;
  return 0;
}

/** PDHL first, then OR fade, then trap. Wild yesterday blocks PDHL only. */
export function entryDir(
  close: number,
  open: number,
  high: number,
  low: number,
  pdh: number,
  pdl: number,
  orHigh: number,
  orLow: number,
  swingHigh: number,
  swingLow: number,
  barMin: number,
): 1 | -1 | 0 {
  const pdhl = skipWildPrevDay(pdh, pdl) ? 0 : pdhlDir(close, open, pdh, pdl);
  return (
    pdhl ||
    orbFadeDir(close, open, high, low, orHigh, orLow, barMin) ||
    trapDir(close, open, high, low, swingHigh, swingLow)
  );
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

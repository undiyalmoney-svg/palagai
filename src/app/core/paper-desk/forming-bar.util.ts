import { Candle } from '../models/candle.model';
import { parseIstTimestamp } from '../live-desk/live-start-guard.util';

/**
 * Live money must decide on **completed** bars only.
 *
 * Kite's 5-minute history includes the bar that is still forming, and the live
 * desk re-fetches every 15s. That bar's high/low/close keep changing, so a
 * replay run against it repaints: one tick says "in trade", the next says
 * "profit drained — cut & rehunt", the next opens again. Each flip is a real
 * order, so the desk pays the spread over and over inside one 5-minute candle.
 *
 * 2026-08-07: BANKNIFTY 57900 PE was entered three times inside the 10:00 bar
 * (603.90 → out 603.95 → in 605.45 → out 603.10 → in 605.00) and finished −₹615.
 * Testing never saw this because it only ever replays closed bars.
 */
export const LIVE_BAR_MINUTES = 5;

/** A bar stamped 10:00 on a 5m series is only final at 10:05. */
export function isBarComplete(
  barDate: string,
  now: Date = new Date(),
  intervalMinutes: number = LIVE_BAR_MINUTES,
): boolean {
  const startMs = parseIstTimestamp(barDate);
  if (!startMs) {
    return false;
  }
  return now.getTime() >= startMs + intervalMinutes * 60_000;
}

/**
 * Drop trailing bars that have not closed yet, so Live sees the same series
 * Testing would. Returns the input untouched when everything is complete.
 */
export function dropFormingBars(
  candles: Candle[],
  now: Date = new Date(),
  intervalMinutes: number = LIVE_BAR_MINUTES,
): Candle[] {
  let end = candles.length;
  while (end > 0 && !isBarComplete(candles[end - 1]!.date, now, intervalMinutes)) {
    end -= 1;
  }
  return end === candles.length ? candles : candles.slice(0, end);
}

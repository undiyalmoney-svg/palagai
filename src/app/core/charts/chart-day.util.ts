/**
 * Calendar helpers for the Charts tab's "as of" date. Today is the live
 * session; any earlier date replays that session, closed, as a backtest.
 */

export function istToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Last instant of an IST calendar day, so a past date loads that session closed. */
export function endOfIstDay(day: string): Date {
  return new Date(`${day}T23:59:59+05:30`);
}

export function isLiveChartDay(day: string, now = new Date()): boolean {
  return !day || day >= istToday(now);
}

/** The clock candles are read at: now on a live day, end of day on a past one. */
export function chartCandleAsOf(day: string, now = new Date()): Date {
  return isLiveChartDay(day, now) ? now : endOfIstDay(day);
}

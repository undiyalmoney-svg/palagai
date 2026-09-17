/**
 * Candle intervals the Charts tab offers, and how each maps onto Kite.
 *
 * Kite Connect serves exactly these historical intervals: `minute`,
 * `3minute`, `5minute`, `10minute`, `15minute`, `30minute`, `60minute`, `day`.
 * Anything else has to be folded locally from one of them.
 *
 * Kept free of Angular imports so the mapping is unit testable.
 */

export type ChartInterval = '1m' | '5m' | '10m' | '15m' | '30m' | '45m' | '1h';

/** Interval strings Kite Connect accepts for historical candles. */
export type KiteInterval =
  | 'minute'
  | '3minute'
  | '5minute'
  | '10minute'
  | '15minute'
  | '30minute'
  | '60minute'
  | 'day';

export interface ChartIntervalSpec {
  label: string;
  /** Interval requested from Kite. */
  fetch: KiteInterval;
  /**
   * Fetched bars folded into one displayed bar. Above 1 the interval is not
   * one Kite serves and is built locally — 45m is 3 × 15m.
   */
  groupSize: number;
  /** Calendar days of history to request. */
  lookbackDays: number;
}

/**
 * Lookback is sized to land near MAX_CHART_BARS after folding, with slack for
 * weekends and holidays so a Monday morning still has a full chart. All values
 * stay well inside Kite's per-request ceiling for their interval.
 */
const INTERVAL_SPECS: Record<ChartInterval, ChartIntervalSpec> = {
  '1m': { label: '1m', fetch: 'minute', groupSize: 1, lookbackDays: 4 },
  '5m': { label: '5m', fetch: '5minute', groupSize: 1, lookbackDays: 5 },
  '10m': { label: '10m', fetch: '10minute', groupSize: 1, lookbackDays: 8 },
  '15m': { label: '15m', fetch: '15minute', groupSize: 1, lookbackDays: 10 },
  '30m': { label: '30m', fetch: '30minute', groupSize: 1, lookbackDays: 20 },
  // Kite has no 45-minute candle, so fold three 15-minute bars.
  '45m': { label: '45m', fetch: '15minute', groupSize: 3, lookbackDays: 30 },
  '1h': { label: '1h', fetch: '60minute', groupSize: 1, lookbackDays: 30 },
};

/** Intervals in the order the tab offers them. */
export const CHART_INTERVALS: readonly ChartInterval[] = [
  '1m',
  '5m',
  '10m',
  '15m',
  '30m',
  '45m',
  '1h',
];

export const CHART_INTERVAL_LABELS: Record<ChartInterval, string> = {
  '1m': INTERVAL_SPECS['1m'].label,
  '5m': INTERVAL_SPECS['5m'].label,
  '10m': INTERVAL_SPECS['10m'].label,
  '15m': INTERVAL_SPECS['15m'].label,
  '30m': INTERVAL_SPECS['30m'].label,
  '45m': INTERVAL_SPECS['45m'].label,
  '1h': INTERVAL_SPECS['1h'].label,
};

/**
 * Most recent bars kept for display. A 1-minute request spans several
 * sessions' worth of bars; drawing them all would be an unreadable smear.
 */
export const MAX_CHART_BARS = 180;

/**
 * Kite's ceiling on days per historical request, per interval. Mirrors
 * maxDaysForInterval in the Order-API's live/kite-market.js.
 */
export const KITE_MAX_DAYS_PER_REQUEST: Record<KiteInterval, number> = {
  minute: 50,
  '3minute': 60,
  '5minute': 60,
  '10minute': 60,
  '15minute': 60,
  '30minute': 180,
  '60minute': 360,
  day: 1800,
};

export function chartIntervalSpec(interval: ChartInterval): ChartIntervalSpec {
  return INTERVAL_SPECS[interval] ?? INTERVAL_SPECS['15m'];
}

/** Kite historical wants `YYYY-MM-DD HH:mm:ss` in exchange-local time. */
export function formatKiteDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

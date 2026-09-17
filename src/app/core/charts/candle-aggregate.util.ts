/**
 * Fold candles into a coarser interval.
 *
 * Kite Connect only serves `minute`, `3minute`, `5minute`, `10minute`,
 * `15minute`, `30minute`, `60minute` and `day`. Anything else — 45-minute
 * being the one the desk wants — has to be built from a interval Kite does
 * serve.
 */
import { Candle } from '../models/candle.model';
import { sessionKey } from './sr-chart.util';

/**
 * Group every `groupSize` bars into one, restarting at each session.
 *
 * Grouping runs from each day's FIRST bar rather than from a wall-clock
 * boundary, which is what aligns the buckets to the exchange: NSE opens 09:15
 * so 45m bars fall at 09:15 / 10:00 / 10:45, while MCX crude opens 09:00 and
 * falls at 09:00 / 09:45 / 10:30. Neither open needs to be hardcoded.
 *
 * The final bucket of a session is emitted even when short, so the bar still
 * forming right now stays on the chart.
 */
export function aggregateCandles(candles: Candle[], groupSize: number): Candle[] {
  const size = Math.max(1, Math.floor(groupSize) || 1);
  if (size === 1 || candles.length === 0) {
    return candles.slice();
  }

  const out: Candle[] = [];
  let bucket: Candle[] = [];
  let day = sessionKey(candles[0]!.date);

  const flush = () => {
    if (bucket.length) {
      out.push(mergeCandles(bucket));
      bucket = [];
    }
  };

  for (const candle of candles) {
    const candleDay = sessionKey(candle.date);
    if (candleDay !== day) {
      flush();
      day = candleDay;
    }
    bucket.push(candle);
    if (bucket.length === size) {
      flush();
    }
  }
  flush();

  return out;
}

/** One candle spanning the whole run: first open, extremes, last close. */
export function mergeCandles(run: Candle[]): Candle {
  const first = run[0]!;
  let high = first.high;
  let low = first.low;
  let volume = 0;
  for (const candle of run) {
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
    volume += candle.volume || 0;
  }
  return {
    // Stamp the bucket with its opening bar, as exchanges label candles.
    date: first.date,
    open: first.open,
    high,
    low,
    close: run[run.length - 1]!.close,
    volume,
  };
}

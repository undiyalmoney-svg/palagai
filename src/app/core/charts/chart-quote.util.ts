import { Candle } from '../models/candle.model';
import { sessionDay } from './smc/smc-utils';

export interface ChartQuote {
  price: number;
  date: string;
  /** Change against the previous session's close. */
  changeAbs: number | null;
  changePct: number | null;
}

/**
 * Close of the last bar of an earlier session, which is what an exchange
 * quotes the day change against. Falls back to the first bar's open when the
 * series holds a single session.
 */
export function previousSessionClose(candles: Candle[]): number | null {
  if (!candles.length) return null;
  const today = sessionDay(candles[candles.length - 1]!.date);
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    if (sessionDay(candles[i]!.date) !== today) return candles[i]!.close;
  }
  return candles[0]!.open;
}

export function chartQuote(candles: Candle[]): ChartQuote | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  const ref = previousSessionClose(candles);
  return {
    price: last.close,
    date: last.date,
    changeAbs: ref != null ? last.close - ref : null,
    changePct: ref != null && ref !== 0 ? ((last.close - ref) / ref) * 100 : null,
  };
}

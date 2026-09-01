import { Candle } from '../../../models/candle.model';
import {
  IntradaySignal,
  LAST_ENTRY_HHMM,
  hhmmOf,
  toMinutes,
} from './intraday-engine';

/**
 * Opening Range Breakout (ORB).
 *
 * 1. Let the first hour trade out (09:15–10:15) and mark its high and low.
 * 2. After 10:15, the first candle that CLOSES beyond that range takes the trade —
 *    above the high goes long, below the low goes short.
 * 3. Stop sits at the opposite end of the opening range, capped so one wide morning
 *    cannot put an unrecoverable amount at risk.
 * 4. Target is a fixed multiple of that risk; anything still open is squared off intraday.
 *
 * Closing beyond the level is required rather than merely touching it — an intrabar poke
 * through the high that snaps back is exactly the false break this is meant to avoid.
 */

export const OR_START_HHMM = '09:15';
export const OR_END_HHMM = '10:15';
/** Cap on entry→stop distance. The opposite end of a wide opening range can be far away. */
export const ORB_MAX_RISK_PCT = 0.015;
export const ORB_REWARD_MULTIPLE = 1.5;
/** A range narrower than this is noise, not a level worth breaking. */
export const ORB_MIN_RANGE_PCT = 0.004;
/** A range wider than this means the move already happened before we could join it. */
export const ORB_MAX_RANGE_PCT = 0.05;
/** Breakout candle must carry at least this much of the session's average volume. */
export const ORB_MIN_VOLUME_RATIO = 1.0;

export function generateOrbSignal(symbol: string, dayCandles: Candle[]): IntradaySignal | null {
  const orEndMin = toMinutes(OR_END_HHMM);
  const orStartMin = toMinutes(OR_START_HHMM);
  const lastEntryMin = toMinutes(LAST_ENTRY_HHMM);

  let orHigh = -Infinity;
  let orLow = Infinity;
  let orBars = 0;
  let firstAfterOr = -1;

  for (let i = 0; i < dayCandles.length; i += 1) {
    const m = toMinutes(hhmmOf(dayCandles[i]!.date));
    if (m < orStartMin) continue;
    if (m < orEndMin) {
      orHigh = Math.max(orHigh, dayCandles[i]!.high);
      orLow = Math.min(orLow, dayCandles[i]!.low);
      orBars += 1;
    } else if (firstAfterOr < 0) {
      firstAfterOr = i;
    }
  }

  if (orBars < 2 || firstAfterOr < 0 || !Number.isFinite(orHigh) || !Number.isFinite(orLow)) {
    return null;
  }
  if (!(orHigh > orLow)) return null;

  const mid = (orHigh + orLow) / 2;
  const rangePct = (orHigh - orLow) / mid;
  if (rangePct < ORB_MIN_RANGE_PCT || rangePct > ORB_MAX_RANGE_PCT) {
    return null;
  }

  // Average volume of bars seen so far — recomputed per bar so it never peeks ahead.
  let volSum = 0;
  for (let i = 0; i < firstAfterOr; i += 1) volSum += dayCandles[i]!.volume;
  let volCount = firstAfterOr;

  for (let i = firstAfterOr; i < dayCandles.length; i += 1) {
    const bar = dayCandles[i]!;
    const t = hhmmOf(bar.date);
    if (toMinutes(t) > lastEntryMin) return null;

    const avgVol = volCount > 0 ? volSum / volCount : 0;
    const volRatio = avgVol > 0 ? bar.volume / avgVol : 0;
    volSum += bar.volume;
    volCount += 1;

    const longBreak = bar.close > orHigh;
    const shortBreak = bar.close < orLow;
    if (!longBreak && !shortBreak) continue;
    if (volRatio < ORB_MIN_VOLUME_RATIO) continue;

    const direction: 'LONG' | 'SHORT' = longBreak ? 'LONG' : 'SHORT';
    const entryPrice = bar.close;
    const structuralStop = longBreak ? orLow : orHigh;
    const cappedStop = longBreak
      ? entryPrice * (1 - ORB_MAX_RISK_PCT)
      : entryPrice * (1 + ORB_MAX_RISK_PCT);
    const stop = longBreak
      ? Math.max(structuralStop, cappedStop)
      : Math.min(structuralStop, cappedStop);

    const risk = Math.abs(entryPrice - stop);
    if (!(risk > 0)) continue;
    const target = longBreak
      ? entryPrice + risk * ORB_REWARD_MULTIPLE
      : entryPrice - risk * ORB_REWARD_MULTIPLE;

    return {
      symbol,
      triggerIndex: i,
      triggerTime: t,
      direction,
      entryPrice,
      stop,
      target,
      quality: volRatio,
    };
  }

  return null;
}

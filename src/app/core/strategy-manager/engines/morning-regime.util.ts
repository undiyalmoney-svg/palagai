import { Candle } from '../../models/candle.model';
import {
  atrAt,
  barsOnDay,
  openingRange,
  previousDayBars,
} from '../indicators/desk-indicators';

/**
 * Morning / prior-day regime features known by OR end (no look-ahead).
 * Used to stand down on tiny OR drive or extreme gap chaos.
 */
export interface MorningRegimeFeatures {
  orWidth: number;
  orDriveFrac: number;
  gapAtr: number;
  atr: number;
  prevBodyFrac: number;
}

export function computeMorningRegimeFeatures(
  series: Candle[],
  day: string,
  orEnd: string,
): MorningRegimeFeatures | null {
  const dayBars = barsOnDay(series, day);
  const or = openingRange(dayBars, '09:15', orEnd);
  if (!or || !(or.high > or.low)) {
    return null;
  }
  const atr = atrAt(series, 14);
  if (atr == null || atr <= 0) {
    return null;
  }
  const prev = previousDayBars(series, day);
  if (!prev.length) {
    return null;
  }
  const dayOpen = dayBars.find((b) => {
    const hhmm = b.date.slice(11, 16);
    return hhmm >= '09:15';
  })?.open;
  if (dayOpen == null) {
    return null;
  }
  const prevOpen = prev[0]!.open;
  const prevClose = prev[prev.length - 1]!.close;
  const prevHigh = Math.max(...prev.map((b) => b.high));
  const prevLow = Math.min(...prev.map((b) => b.low));
  const prevRange = prevHigh - prevLow;
  const orWidth = or.high - or.low;
  const orDriveFrac = orWidth > 0 ? Math.abs(or.lastClose - or.firstOpen) / orWidth : 0;
  const gapAtr = Math.abs(dayOpen - prevClose) / atr;
  const prevBodyFrac = prevRange > 0 ? Math.abs(prevClose - prevOpen) / prevRange : 0;
  return {
    orWidth,
    orDriveFrac,
    gapAtr,
    atr,
    prevBodyFrac,
  };
}

/**
 * Practical VolExpand stand-down (research):
 * require directional morning OR (drive ≥ min) and skip extreme overnight gaps.
 */
export function passesMorningRegimeFilter(
  features: MorningRegimeFeatures,
  minOrDriveFrac: number,
  maxGapAtr: number,
): boolean {
  return features.orDriveFrac >= minOrDriveFrac && features.gapAtr <= maxGapAtr;
}

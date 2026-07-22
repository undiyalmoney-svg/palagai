import { Candle } from '../../models/candle.model';
import {
  atrAt,
  barsOnDay,
  emaLast,
  openingRange,
  previousDayBars,
} from '../indicators/desk-indicators';

/** Morning features for Ruler witch switching (causal — OR end 09:45). */
export interface RulerMorningFeatures {
  drive: number;
  gap: number;
  wide: boolean;
  vwide: boolean;
  calm: boolean;
  choppy: boolean;
  emaBuy: boolean;
  emaSell: boolean;
  strong: boolean;
  vstrong: boolean;
  orUp: boolean;
  orWidth: number;
  atr: number;
}

export type RulerArm =
  | 'STAND'
  | 'DONCH_TRAIL'
  | 'DONCH_2R'
  | 'DONCH_15R'
  | 'SWING_2R';

/** Boosted ruler: rampage while MTD < ₹3,000. */
export const RULER_RAMPAGE_UNTIL_INR = 3000;
/** Hard day loss cap (₹). When month green → min(cap, MTD). */
export const RULER_DAY_CAP_INR = 1500;

/**
 * Causal morning features at OR 09:45 (matches research morning_feat).
 * `isBank` selects Bank Nifty width thresholds.
 */
export function computeRulerMorningFeatures(
  series: Candle[],
  day: string,
  isBank: boolean,
  orEnd = '09:45',
): RulerMorningFeatures | null {
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
  const prevClose = prev[prev.length - 1]!.close;
  const orWidth = or.high - or.low;
  const drive = Math.abs(or.lastClose - or.firstOpen) / orWidth;
  const gap = Math.abs(dayOpen - prevClose) / atr;
  const wide = orWidth >= (isBank ? 150 : 80);
  const vwide = orWidth >= (isBank ? 220 : 120);
  const choppy = !wide && drive < 0.3;
  const calm = gap < 1.5;
  const closes = series.map((c) => c.close);
  const e20 = emaLast(closes, 20);
  const e50 = emaLast(closes, 50);
  // Prefer ~10:15 bar when available for EMA bias (research j1015).
  const pxBar =
    dayBars.find((b) => b.date.slice(11, 16) >= '10:15') ??
    dayBars[dayBars.length - 1]!;
  const px = pxBar.close;
  const emaBuy = e20 != null && e50 != null && px > e20 && e20 > e50;
  const emaSell = e20 != null && e50 != null && px < e20 && e20 < e50;
  return {
    drive,
    gap,
    wide,
    vwide,
    calm,
    choppy,
    emaBuy,
    emaSell,
    strong: drive >= 0.45,
    vstrong: drive >= 0.65,
    orUp: or.lastClose >= or.firstOpen,
    orWidth,
    atr,
  };
}

/** Beast witch — trail on wide+strong, else donch/swing. */
export function witchBeast(f: RulerMorningFeatures | null): RulerArm {
  if (f == null || f.choppy) {
    return 'STAND';
  }
  if (f.wide && f.strong) {
    return 'DONCH_TRAIL';
  }
  if (f.wide && f.drive >= 0.35) {
    return 'DONCH_2R';
  }
  if (f.emaBuy || f.emaSell) {
    return 'SWING_2R';
  }
  return 'STAND';
}

/** Trail witch — Donch trail on non-choppy mornings. */
export function witchTrail(f: RulerMorningFeatures | null): RulerArm {
  if (f == null || f.choppy) {
    return 'STAND';
  }
  return 'DONCH_TRAIL';
}

/**
 * Boosted ruler pick: rampage beast while MTD < ₹3k, else trail.
 */
export function pickRulerArm(
  f: RulerMorningFeatures | null,
  monthMtdInr: number,
): RulerArm {
  if (monthMtdInr < RULER_RAMPAGE_UNTIL_INR) {
    return witchBeast(f);
  }
  return witchTrail(f);
}

/** Dyn day cap: when month green, one capped loss cannot flip the month red. */
export function rulerDayCapInr(monthMtdInr: number, baseCap = RULER_DAY_CAP_INR): number {
  if (monthMtdInr > 0) {
    return Math.min(baseCap, monthMtdInr);
  }
  return baseCap;
}

/**
 * Research dyn0 day clip: if raw day ₹ < −cap, count −cap (not the full trail loss).
 * When MTD > 0, cap = min(baseCap, MTD) so one loss cannot flip the month red.
 */
export function clipRulerDayInr(
  rawDayInr: number,
  mtdBefore: number,
  baseCap = RULER_DAY_CAP_INR,
): number {
  if (mtdBefore > 0) {
    const dyn = Math.min(baseCap, mtdBefore);
    if (dyn <= 0) {
      return 0;
    }
    return rawDayInr < -dyn ? -dyn : rawDayInr;
  }
  return rawDayInr < -baseCap ? -baseCap : rawDayInr;
}

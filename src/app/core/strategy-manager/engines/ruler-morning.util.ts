import { Candle } from '../../models/candle.model';
import {
  barsOnDay,
  emaLast,
  openingRange,
  previousDayBars,
} from '../indicators/desk-indicators';

/**
 * Research atr14: mean of prior `period` bar ranges (high−low), excluding current bar.
 * Matches strategy-universe-search.py — not true-range ATR.
 */
function researchRangeAtr(candlesThroughBar: Candle[], period = 14): number | null {
  if (candlesThroughBar.length < 2) {
    return null;
  }
  const i = candlesThroughBar.length - 1;
  const start = Math.max(0, i - period);
  if (start >= i) {
    return null;
  }
  let sum = 0;
  let n = 0;
  for (let k = start; k < i; k += 1) {
    sum += candlesThroughBar[k]!.high - candlesThroughBar[k]!.low;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

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
export const RULER_DAY_CAP_INR = 500;
/**
 * Month bank target (₹). Once MTD ≥ this, force STAND for the rest of the month.
 * Trains capital banking toward a ₹15k monthly floor.
 * Note: 1-lot DNA cannot clear ₹15k in every historical month; Trade Desk lots≥3
 * with this lock does (research 2020–2026).
 */
export const RULER_MONTH_TARGET_INR = 15000;

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
  // Research morning_feat evaluates at last OR bar (hhmm < orEnd), never the orEnd bar itself.
  const orEndBar =
    dayBars.filter((b) => {
      const hhmm = b.date.slice(11, 16);
      return hhmm >= '09:15' && hhmm < orEnd;
    }).at(-1) ?? null;
  if (!orEndBar) {
    return null;
  }
  const orEndIdx = series.findIndex((c) => c.date === orEndBar.date);
  if (orEndIdx < 0) {
    return null;
  }
  // Truncate to OR-end bar so EMA/ATR match research inst.ema*/atr14[j] at j = OR end.
  const throughOr = series.slice(0, orEndIdx + 1);
  const atr = researchRangeAtr(throughOr, 14);
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
  const closes = throughOr.map((c) => c.close);
  const e20 = emaLast(closes, 20);
  const e50 = emaLast(closes, 50);
  const px = orEndBar.close;
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

/** Trail witch — Donch trail on non-choppy mornings (legacy; prefer witchTrailWideElse2r). */
export function witchTrail(f: RulerMorningFeatures | null): RulerArm {
  if (f == null || f.choppy) {
    return 'STAND';
  }
  return 'DONCH_TRAIL';
}

/**
 * Legacy post-rampage (Sep-boost): trail on any wide morning.
 * Prefer witchTrailWideCalmElse2r for capital-protect discipline.
 */
export function witchTrailWideElse2r(f: RulerMorningFeatures | null): RulerArm {
  if (f == null || f.choppy) {
    return 'STAND';
  }
  if (f.wide) {
    return 'DONCH_TRAIL';
  }
  if (f.drive >= 0.35) {
    return 'DONCH_2R';
  }
  if (f.emaBuy || f.emaSell) {
    return 'SWING_2R';
  }
  return 'STAND';
}

/**
 * Post-rampage exit discipline (2020–2026 capital-protect train):
 * DONCH_TRAIL only on *wide and calm* mornings. Wide-but-jumpy days take
 * DONCH_2R instead of open-ended trail. Skinny → 2R / SWING / STAND.
 */
export function witchTrailWideCalmElse2r(f: RulerMorningFeatures | null): RulerArm {
  if (f == null || f.choppy) {
    return 'STAND';
  }
  if (f.wide && f.calm) {
    return 'DONCH_TRAIL';
  }
  if (f.wide && f.drive >= 0.35) {
    return 'DONCH_2R';
  }
  if (f.drive >= 0.35) {
    return 'DONCH_2R';
  }
  if (f.emaBuy || f.emaSell) {
    return 'SWING_2R';
  }
  return 'STAND';
}

/**
 * Edge witch — used after loss-streak breaker (rest of month).
 * Matches research ruler-profit-boost.edge().
 */
export function witchEdge(f: RulerMorningFeatures | null): RulerArm {
  if (f == null || f.choppy) {
    return 'STAND';
  }
  if (f.vstrong && f.wide) {
    return 'DONCH_TRAIL';
  }
  if (f.wide && f.strong && f.calm) {
    return 'DONCH_2R';
  }
  if (f.emaBuy || f.emaSell) {
    return 'SWING_2R';
  }
  if (f.drive >= 0.4) {
    return 'DONCH_15R';
  }
  return 'STAND';
}

/**
 * Underwater recover witch (fixes 2022-05 / 2022-11 red months).
 * Research hunter with OR_RETEST mapped to DONCH_2R (no new Angular arm).
 * Used only while month MTD is negative — never keep beasting when red.
 */
export function witchHunterUw(f: RulerMorningFeatures | null): RulerArm {
  if (f == null || f.choppy) {
    return 'STAND';
  }
  if (f.vwide && f.vstrong) {
    return 'DONCH_TRAIL';
  }
  if (f.vwide && f.strong) {
    return 'DONCH_2R';
  }
  if (f.wide && f.drive >= 0.35 && f.calm) {
    return 'DONCH_2R';
  }
  if (f.wide && (f.emaBuy || f.emaSell)) {
    return 'SWING_2R';
  }
  if (f.drive >= 0.5) {
    return 'DONCH_15R';
  }
  return 'STAND';
}

/** Consecutive clipped red days before breaker engages (anytime in the month). */
export const RULER_LOSS_STREAK_BREAKER = 2;

export type RulerArmPickOpts = {
  /** After 2 clipped losses → edge witch for rest of month. */
  breakerActive?: boolean;
};

/**
 * Zero-red discipline pick (profit-boost):
 * 1. Breaker active → edge
 * 2. MTD < 0 → hunter (do not beast while month is red)
 * 3. 0 ≤ MTD < ₹3k → beast
 * 4. Else → trail on wide mornings (else 2R/swing) — more profit than calm-only
 */
export function pickRulerArm(
  f: RulerMorningFeatures | null,
  monthMtdInr: number,
  opts?: RulerArmPickOpts,
): RulerArm {
  if (monthMtdInr >= RULER_MONTH_TARGET_INR) {
    return 'STAND';
  }
  if (opts?.breakerActive) {
    return witchEdge(f);
  }
  if (monthMtdInr < 0) {
    return witchHunterUw(f);
  }
  if (monthMtdInr < RULER_RAMPAGE_UNTIL_INR) {
    return witchBeast(f);
  }
  return witchTrailWideElse2r(f);
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

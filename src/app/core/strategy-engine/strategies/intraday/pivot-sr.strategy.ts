import { Candle } from '../../../models/candle.model';
import {
  IntradaySignal,
  LAST_ENTRY_HHMM,
  hhmmOf,
  toMinutes,
} from './intraday-engine';
import { OR_END_HHMM } from './orb.strategy';

/**
 * Support / resistance mean-reversion on classic floor-trader pivots.
 *
 * Structurally the opposite bet to ORB: where the breakout strategy buys price *leaving*
 * a level, this buys price *rejecting* one. Running both over the same days and the same
 * costs is the point — if breakouts have no edge, it does not follow that reversals do,
 * and only measuring both answers that.
 *
 * Levels come from the previous session:
 *   P  = (H + L + C) / 3
 *   R1 = 2P − L      S1 = 2P − H
 *   R2 = P + (H − L) S2 = P − (H − L)
 *
 * Long  — a bar dips to/through S1 but CLOSES back above it (support held).
 * Short — a bar pushes to/through R1 but CLOSES back below it (resistance held).
 * Stop sits beyond the next level out (S2 / R2), capped. Target is the central pivot,
 * which is where mean reversion is actually aiming.
 */

export const PIVOT_MAX_RISK_PCT = 0.015;
/** Reject setups where the pivot is so close that the trade cannot pay for itself. */
export const PIVOT_MIN_REWARD_MULTIPLE = 1.0;

export interface PivotLevels {
  p: number;
  r1: number;
  s1: number;
  r2: number;
  s2: number;
}

export function pivotLevelsFromDay(prevDayCandles: Candle[]): PivotLevels | null {
  if (!prevDayCandles.length) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const c of prevDayCandles) {
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
  }
  const close = prevDayCandles[prevDayCandles.length - 1]!.close;
  if (!Number.isFinite(high) || !Number.isFinite(low) || !(high > low)) return null;

  const p = (high + low + close) / 3;
  return {
    p,
    r1: 2 * p - low,
    s1: 2 * p - high,
    r2: p + (high - low),
    s2: p - (high - low),
  };
}

export function generatePivotSrSignal(
  symbol: string,
  dayCandles: Candle[],
  prevDayCandles: Candle[] | null,
): IntradaySignal | null {
  if (!prevDayCandles) return null;
  const levels = pivotLevelsFromDay(prevDayCandles);
  if (!levels) return null;

  // Same "let the first hour settle" rule the ORB book uses, so both are judged alike.
  const startMin = toMinutes(OR_END_HHMM);
  const lastEntryMin = toMinutes(LAST_ENTRY_HHMM);

  for (let i = 0; i < dayCandles.length; i += 1) {
    const bar = dayCandles[i]!;
    const t = hhmmOf(bar.date);
    const m = toMinutes(t);
    if (m < startMin) continue;
    if (m > lastEntryMin) return null;

    const touchedSupport = bar.low <= levels.s1 && bar.close > levels.s1;
    const touchedResistance = bar.high >= levels.r1 && bar.close < levels.r1;
    if (!touchedSupport && !touchedResistance) continue;

    const direction: 'LONG' | 'SHORT' = touchedSupport ? 'LONG' : 'SHORT';
    const entryPrice = bar.close;

    const structuralStop = touchedSupport ? levels.s2 : levels.r2;
    const cappedStop = touchedSupport
      ? entryPrice * (1 - PIVOT_MAX_RISK_PCT)
      : entryPrice * (1 + PIVOT_MAX_RISK_PCT);
    const stop = touchedSupport
      ? Math.max(structuralStop, cappedStop)
      : Math.min(structuralStop, cappedStop);

    const risk = Math.abs(entryPrice - stop);
    if (!(risk > 0)) continue;

    // Mean reversion aims at the central pivot.
    const target = levels.p;
    const reward = touchedSupport ? target - entryPrice : entryPrice - target;
    if (reward / risk < PIVOT_MIN_REWARD_MULTIPLE) continue;

    // How decisively the level was rejected — used only for same-bar tie-breaks.
    const wickDepth = touchedSupport
      ? (levels.s1 - bar.low) / entryPrice
      : (bar.high - levels.r1) / entryPrice;

    return {
      symbol,
      triggerIndex: i,
      triggerTime: t,
      direction,
      entryPrice,
      stop,
      target,
      quality: Math.max(0, wickDepth) * 1000,
    };
  }

  return null;
}

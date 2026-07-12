import { Candle } from '../../models/candle.model';
import { bodySize, bodyStrengthPct, candleRange } from './ohlc-candle.util';

export interface BreakoutQualityResult {
  passed: boolean;
  bodyPct: number;
  closePositionPct: number;
  oppositeWickPct: number;
  isDoji: boolean;
  isInside: boolean;
  reason: string;
}

const MIN_BODY_PCT = 60;
const CLOSE_ZONE_PCT = 20;
const MAX_OPPOSITE_WICK_BODY_RATIO = 0.3;
const DOJI_BODY_PCT = 15;

/** Validates breakout candle quality for First Hour Breakout entries. */
export function evaluateBreakoutCandleQuality(
  candle: Candle,
  previous: Candle | null,
  direction: 'BUY' | 'SELL',
  rangeHigh: number,
  rangeLow: number,
): BreakoutQualityResult {
  const range = candleRange(candle);
  const body = bodySize(candle);
  const bodyPct = bodyStrengthPct(candle);

  if (range <= 0) {
    return fail(bodyPct, 0, 0, false, false, 'Zero-range candle');
  }

  const isDoji = bodyPct < DOJI_BODY_PCT;
  const isInside =
    previous !== null &&
    candle.high <= previous.high &&
    candle.low >= previous.low;

  const closePositionPct =
    direction === 'BUY'
      ? ((candle.close - candle.low) / range) * 100
      : ((candle.high - candle.close) / range) * 100;

  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const oppositeWick = direction === 'BUY' ? lowerWick : upperWick;
  const oppositeWickPct = body > 0 ? oppositeWick / body : 1;

  const closeOutside =
    direction === 'BUY' ? candle.close > rangeHigh : candle.close < rangeLow;

  if (!closeOutside) {
    return fail(bodyPct, closePositionPct, oppositeWickPct, isDoji, isInside, 'Close not outside first hour range');
  }
  if (isDoji) {
    return fail(bodyPct, closePositionPct, oppositeWickPct, true, isInside, 'Doji candle — weak breakout');
  }
  if (isInside) {
    return fail(bodyPct, closePositionPct, oppositeWickPct, isDoji, true, 'Inside candle — no breakout conviction');
  }
  if (bodyPct < MIN_BODY_PCT) {
    return fail(
      bodyPct,
      closePositionPct,
      oppositeWickPct,
      isDoji,
      isInside,
      `Body ${bodyPct.toFixed(0)}% < required ${MIN_BODY_PCT}%`,
    );
  }
  if (closePositionPct < 100 - CLOSE_ZONE_PCT) {
    return fail(
      bodyPct,
      closePositionPct,
      oppositeWickPct,
      isDoji,
      isInside,
      `Close not in ${direction === 'BUY' ? 'top' : 'bottom'} ${CLOSE_ZONE_PCT}% of candle`,
    );
  }
  if (oppositeWickPct > MAX_OPPOSITE_WICK_BODY_RATIO) {
    return fail(
      bodyPct,
      closePositionPct,
      oppositeWickPct,
      isDoji,
      isInside,
      `Opposite wick ${(oppositeWickPct * 100).toFixed(0)}% of body exceeds 30% limit`,
    );
  }

  return {
    passed: true,
    bodyPct,
    closePositionPct,
    oppositeWickPct,
    isDoji: false,
    isInside: false,
    reason: 'Strong breakout candle',
  };
}

function fail(
  bodyPct: number,
  closePositionPct: number,
  oppositeWickPct: number,
  isDoji: boolean,
  isInside: boolean,
  reason: string,
): BreakoutQualityResult {
  return {
    passed: false,
    bodyPct,
    closePositionPct,
    oppositeWickPct,
    isDoji,
    isInside,
    reason,
  };
}

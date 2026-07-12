import { Candle } from '../../models/candle.model';
import { bodySize, candleRange, highestHigh, lowestLow } from './ohlc-candle.util';
import { detectSwingHighs, detectSwingLows } from './swing-level.util';

export type SidewaysFilterDecision = 'ALLOW_TRADE' | 'NO_TRADE';
export type SidewaysMarketState = 'Trending' | 'Weak Trend' | 'Sideways';

export interface SidewaysFilterResult {
  decision: SidewaysFilterDecision;
  marketState: SidewaysMarketState;
  sidewaysScore: number;
  highestHigh: number;
  lowestLow: number;
  tradingRange: number;
  averageCandleRange: number;
  priceCompression: boolean;
  structureWeakness: boolean;
  smallBodyCluster: boolean;
  overlapZone: boolean;
  failedBreakoutZone: boolean;
  flatStructure: boolean;
  higherHighCount: number;
  higherLowCount: number;
  lowerHighCount: number;
  lowerLowCount: number;
  averageBodySize: number;
  smallBodyCount: number;
  overlapCount: number;
  failedBreakoutCount: number;
  swingHighDifferencePct: number | null;
  swingLowDifferencePct: number | null;
  reason: string;
}

const FLAT_SWING_PCT = 0.003;
const OVERLAP_THRESHOLD = 0.6;
const MIN_CANDLES = 8;

export function evaluateSidewaysMarketFilter(
  candles: Candle[],
  momentumWinningScore: number,
): SidewaysFilterResult {
  const empty = emptyResult('Insufficient completed candles');

  if (candles.length < MIN_CANDLES) {
    return empty;
  }

  const last8 = candles.slice(-8);
  const highest = highestHigh(last8, 8);
  const lowest = lowestLow(last8, 8);
  const tradingRange = highest - lowest;
  const averageCandleRange = averageRange(last8);
  const priceCompression = tradingRange < averageCandleRange * 3;

  const last6 = candles.slice(-6);
  const structureCounts = countStructure(last6);
  const structureWeakness = !structureDominates(structureCounts);

  const last5 = candles.slice(-5);
  const averageBody = last5.reduce((sum, c) => sum + bodySize(c), 0) / last5.length;
  const smallBodyCount = last5.filter((c) => bodySize(c) < averageBody).length;
  const smallBodyCluster = smallBodyCount >= 4;

  const overlapCount = countOverlaps(last5);
  const overlapZone = overlapCount >= 4;

  const failedBreakoutCount = countFailedBreakouts(last5);
  const failedBreakoutZone = failedBreakoutCount >= 2;

  const swingHighDiff = maxSwingDifferencePct(detectSwingHighs(candles).slice(-3));
  const swingLowDiff = maxSwingDifferencePct(detectSwingLows(candles).slice(-3));
  const flatStructure =
    isFlatSwingSequence(detectSwingHighs(candles).slice(-3)) &&
    isFlatSwingSequence(detectSwingLows(candles).slice(-3));

  let sidewaysScore = 0;
  if (priceCompression) {
    sidewaysScore += 1;
  }
  if (structureWeakness) {
    sidewaysScore += 1;
  }
  if (smallBodyCluster) {
    sidewaysScore += 1;
  }
  if (overlapZone) {
    sidewaysScore += 1;
  }
  if (failedBreakoutZone) {
    sidewaysScore += 1;
  }
  if (flatStructure) {
    sidewaysScore += 1;
  }

  const marketState = classifyMarketState(sidewaysScore);
  const decision = resolveDecision(marketState, momentumWinningScore);

  return {
    decision,
    marketState,
    sidewaysScore,
    highestHigh: highest,
    lowestLow: lowest,
    tradingRange,
    averageCandleRange,
    priceCompression,
    structureWeakness,
    smallBodyCluster,
    overlapZone,
    failedBreakoutZone,
    flatStructure,
    higherHighCount: structureCounts.higherHigh,
    higherLowCount: structureCounts.higherLow,
    lowerHighCount: structureCounts.lowerHigh,
    lowerLowCount: structureCounts.lowerLow,
    averageBodySize: averageBody,
    smallBodyCount,
    overlapCount,
    failedBreakoutCount,
    swingHighDifferencePct: swingHighDiff,
    swingLowDifferencePct: swingLowDiff,
    reason: buildReason(decision, marketState, sidewaysScore, momentumWinningScore),
  };
}

function averageRange(candles: Candle[]): number {
  if (!candles.length) {
    return 0;
  }
  return candles.reduce((sum, c) => sum + candleRange(c), 0) / candles.length;
}

function countStructure(candles: Candle[]): {
  higherHigh: number;
  higherLow: number;
  lowerHigh: number;
  lowerLow: number;
} {
  let higherHigh = 0;
  let higherLow = 0;
  let lowerHigh = 0;
  let lowerLow = 0;

  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i]!;
    const previous = candles[i - 1]!;
    if (current.high > previous.high) {
      higherHigh += 1;
    }
    if (current.low > previous.low) {
      higherLow += 1;
    }
    if (current.high < previous.high) {
      lowerHigh += 1;
    }
    if (current.low < previous.low) {
      lowerLow += 1;
    }
  }

  return { higherHigh, higherLow, lowerHigh, lowerLow };
}

function structureDominates(counts: ReturnType<typeof countStructure>): boolean {
  const bullish = counts.higherHigh + counts.higherLow;
  const bearish = counts.lowerHigh + counts.lowerLow;
  const margin = Math.abs(bullish - bearish);
  return margin >= 2;
}

function countOverlaps(candles: Candle[]): number {
  let count = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i]!;
    const previous = candles[i - 1]!;
    const prevRange = candleRange(previous);
    if (prevRange <= 0) {
      continue;
    }
    const overlapHigh = Math.min(current.high, previous.high);
    const overlapLow = Math.max(current.low, previous.low);
    const overlap = Math.max(0, overlapHigh - overlapLow);
    if (overlap / prevRange > OVERLAP_THRESHOLD) {
      count += 1;
    }
  }
  return count;
}

function countFailedBreakouts(candles: Candle[]): number {
  let count = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i]!;
    const previous = candles[i - 1]!;
    const insidePrevRange =
      current.close <= previous.high && current.close >= previous.low;

    const bullishFailed = current.high > previous.high && insidePrevRange;
    const bearishFailed = current.low < previous.low && insidePrevRange;

    if (bullishFailed || bearishFailed) {
      count += 1;
    }
  }
  return count;
}

function isFlatSwingSequence(swings: { price: number }[]): boolean {
  if (swings.length < 3) {
    return false;
  }
  for (let i = 1; i < swings.length; i += 1) {
    const prev = swings[i - 1]!.price;
    const current = swings[i]!.price;
    if (prev <= 0) {
      return false;
    }
    if (Math.abs(current - prev) / prev >= FLAT_SWING_PCT) {
      return false;
    }
  }
  return true;
}

function maxSwingDifferencePct(swings: { price: number }[]): number | null {
  if (swings.length < 2) {
    return null;
  }
  const diffs: number[] = [];
  for (let i = 1; i < swings.length; i += 1) {
    const prev = swings[i - 1]!.price;
    const current = swings[i]!.price;
    if (prev <= 0) {
      return null;
    }
    diffs.push(Math.abs(current - prev) / prev);
  }
  return Math.max(...diffs);
}

function classifyMarketState(score: number): SidewaysMarketState {
  if (score <= 1) {
    return 'Trending';
  }
  if (score <= 3) {
    return 'Weak Trend';
  }
  return 'Sideways';
}

function resolveDecision(
  marketState: SidewaysMarketState,
  momentumWinningScore: number,
): SidewaysFilterDecision {
  if (marketState === 'Trending') {
    return 'ALLOW_TRADE';
  }
  if (marketState === 'Weak Trend') {
    return momentumWinningScore === 5 ? 'ALLOW_TRADE' : 'NO_TRADE';
  }
  return 'NO_TRADE';
}

function buildReason(
  decision: SidewaysFilterDecision,
  marketState: SidewaysMarketState,
  sidewaysScore: number,
  momentumWinningScore: number,
): string {
  if (decision === 'ALLOW_TRADE' && marketState === 'Trending') {
    return `Sideways score ${sidewaysScore}/6 — Trending market, momentum may proceed`;
  }
  if (decision === 'ALLOW_TRADE' && marketState === 'Weak Trend') {
    return `Sideways score ${sidewaysScore}/6 — Weak trend allowed with momentum score 5`;
  }
  if (marketState === 'Weak Trend') {
    return `Sideways score ${sidewaysScore}/6 — Weak trend requires momentum 5 (got ${momentumWinningScore})`;
  }
  return `Sideways score ${sidewaysScore}/6 — ${marketState} market, momentum skipped`;
}

function emptyResult(reason: string): SidewaysFilterResult {
  return {
    decision: 'NO_TRADE',
    marketState: 'Sideways',
    sidewaysScore: 6,
    highestHigh: 0,
    lowestLow: 0,
    tradingRange: 0,
    averageCandleRange: 0,
    priceCompression: true,
    structureWeakness: true,
    smallBodyCluster: true,
    overlapZone: true,
    failedBreakoutZone: true,
    flatStructure: true,
    higherHighCount: 0,
    higherLowCount: 0,
    lowerHighCount: 0,
    lowerLowCount: 0,
    averageBodySize: 0,
    smallBodyCount: 0,
    overlapCount: 0,
    failedBreakoutCount: 0,
    swingHighDifferencePct: null,
    swingLowDifferencePct: null,
    reason,
  };
}

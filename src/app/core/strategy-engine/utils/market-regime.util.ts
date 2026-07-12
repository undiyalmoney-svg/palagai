import { Candle } from '../../models/candle.model';
import { bodySize, candleRange } from './ohlc-candle.util';
import { extractTradeDate } from '../../utils/trade-date.util';
import { extractHhMm } from './market-session.util';
import { NSE_SESSION } from '../../config/session.config';

export type MarketRegime =
  | 'TRENDING'
  | 'RANGING'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'UNKNOWN';

export interface MarketRegimeResult {
  regime: MarketRegime;
  trendingScore: number;
  rangingScore: number;
  volatilityRatio: number;
  higherHighCount: number;
  higherLowCount: number;
  lowerHighCount: number;
  lowerLowCount: number;
  overlapCount: number;
  rejectionCount: number;
  averageRange: number;
  reason: string;
}

const MIN_CANDLES = 8;
const HIGH_VOL_RATIO = 1.45;
const LOW_VOL_RATIO = 0.65;
const OVERLAP_THRESHOLD = 0.55;

/** Classify market regime for a trading day using OHLC candles up to the current point. */
export function classifyMarketRegime(dayCandles: Candle[]): MarketRegimeResult {
  if (dayCandles.length < MIN_CANDLES) {
    return emptyRegime('UNKNOWN', 'Insufficient candles for regime classification');
  }

  const ranges = dayCandles.map(candleRange);
  const averageRange = average(ranges);
  const recentRanges = ranges.slice(-12);
  const recentAverage = average(recentRanges);
  const baseline = average(ranges.slice(0, Math.max(6, Math.floor(ranges.length / 2))));
  const volatilityRatio = baseline > 0 ? recentAverage / baseline : 1;

  const structure = countStructure(dayCandles.slice(-12));
  const overlapCount = countOverlaps(dayCandles.slice(-8));
  const rejectionCount = countRejections(dayCandles.slice(-10));

  const trendingScore =
    (structure.higherHigh >= 3 && structure.higherLow >= 2 ? 2 : 0) +
    (structure.lowerHigh >= 3 && structure.lowerLow >= 2 ? 2 : 0) +
    (structure.higherHigh >= 2 && structure.higherLow >= 2 ? 1 : 0) +
    (structure.lowerHigh >= 2 && structure.lowerLow >= 2 ? 1 : 0);

  const rangingScore =
    (overlapCount >= 4 ? 2 : overlapCount >= 2 ? 1 : 0) +
    (rejectionCount >= 2 ? 2 : rejectionCount >= 1 ? 1 : 0) +
    (trendingScore === 0 ? 1 : 0) +
    (volatilityRatio < 0.9 ? 1 : 0);

  let regime: MarketRegime;
  let reason: string;

  if (volatilityRatio >= HIGH_VOL_RATIO) {
    regime = 'HIGH_VOLATILITY';
    reason = `Volatility ratio ${volatilityRatio.toFixed(2)} — expanded candle ranges`;
  } else if (volatilityRatio <= LOW_VOL_RATIO) {
    regime = 'LOW_VOLATILITY';
    reason = `Volatility ratio ${volatilityRatio.toFixed(2)} — compressed movement`;
  } else if (trendingScore >= 3) {
    regime = 'TRENDING';
    reason = `Higher highs/lows or lower highs/lows progression (score ${trendingScore})`;
  } else if (rangingScore >= 3) {
    regime = 'RANGING';
    reason = `Overlapping candles and repeated rejection (score ${rangingScore})`;
  } else {
    regime = 'UNKNOWN';
    reason = 'No clear trending or ranging structure';
  }

  return {
    regime,
    trendingScore,
    rangingScore,
    volatilityRatio,
    higherHighCount: structure.higherHigh,
    higherLowCount: structure.higherLow,
    lowerHighCount: structure.lowerHigh,
    lowerLowCount: structure.lowerLow,
    overlapCount,
    rejectionCount,
    averageRange,
    reason,
  };
}

/** Tracks per-day regime; classifies once after the first hour completes. */
export class DailyRegimeTracker {
  private readonly cache = new Map<string, MarketRegimeResult>();

  resolve(
    tradingDate: string,
    candles5m: Candle[],
    currentTime: string,
    firstHourReadyTime: string = NSE_SESSION.firstHourReadyTime,
  ): MarketRegimeResult {
    const cached = this.cache.get(tradingDate);
    if (cached) {
      return cached;
    }

    if (currentTime < firstHourReadyTime) {
      return emptyRegime('UNKNOWN', 'Waiting for first hour to complete before regime classification');
    }

    const dayCandles = candles5m.filter((c) => extractTradeDate(c.date) === tradingDate);
    const result = classifyMarketRegime(dayCandles);
    this.cache.set(tradingDate, result);
    return result;
  }

  getDayCount(regime: MarketRegime): number {
    return [...this.cache.values()].filter((r) => r.regime === regime).length;
  }

  getAll(): Map<string, MarketRegimeResult> {
    return new Map(this.cache);
  }

  reset(): void {
    this.cache.clear();
  }
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

function countRejections(candles: Candle[]): number {
  if (candles.length < 4) {
    return 0;
  }

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const range = maxHigh - minLow;
  if (range <= 0) {
    return 0;
  }

  const tolerance = range * 0.003;
  let rejections = 0;

  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i]!;
    const prev = candles[i - 1]!;
    const rejectedHigh =
      Math.abs(current.high - maxHigh) <= tolerance && current.close < current.high - bodySize(current) * 0.3;
    const rejectedLow =
      Math.abs(current.low - minLow) <= tolerance && current.close > current.low + bodySize(current) * 0.3;
    const failedBreakout =
      (current.high > prev.high && current.close <= prev.high) ||
      (current.low < prev.low && current.close >= prev.low);

    if (rejectedHigh || rejectedLow || failedBreakout) {
      rejections += 1;
    }
  }

  return rejections;
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function emptyRegime(regime: MarketRegime, reason: string): MarketRegimeResult {
  return {
    regime,
    trendingScore: 0,
    rangingScore: 0,
    volatilityRatio: 0,
    higherHighCount: 0,
    higherLowCount: 0,
    lowerHighCount: 0,
    lowerLowCount: 0,
    overlapCount: 0,
    rejectionCount: 0,
    averageRange: 0,
    reason,
  };
}

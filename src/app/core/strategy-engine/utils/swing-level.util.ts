import { Candle } from '../../models/candle.model';
import { MarketBias } from '../models/module-result.model';

export interface SwingPoint {
  index: number;
  price: number;
  date: string;
}

export type StructureTrend = 'Bullish' | 'Bearish' | 'Sideways';

export interface RankedLevels {
  supports: number[];
  resistances: number[];
  nearestSupport: number | null;
  nearestResistance: number | null;
}

export interface PullbackSetupResult {
  detected: boolean;
  breakoutIndex: number;
  breakoutLevel: number;
  pullbackLow: number;
  pullbackHigh: number;
  pullbackValid: boolean;
  confirmationValid: boolean;
  reason: string;
}

const PULLBACK_TOLERANCE_PCT = 0.002;
const SAFETY_BUFFER_PCT = 0.001;
const MIN_TICK = 0.05;
const SETUP_LOOKBACK = 40;

export function detectSwingHighs(candles: Candle[]): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = 2; i < candles.length - 2; i += 1) {
    const candle = candles[i]!;
    if (
      candle.high > candles[i - 1]!.high &&
      candle.high > candles[i - 2]!.high &&
      candle.high > candles[i + 1]!.high &&
      candle.high > candles[i + 2]!.high
    ) {
      swings.push({ index: i, price: candle.high, date: candle.date });
    }
  }
  return swings;
}

export function detectSwingLows(candles: Candle[]): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = 2; i < candles.length - 2; i += 1) {
    const candle = candles[i]!;
    if (
      candle.low < candles[i - 1]!.low &&
      candle.low < candles[i - 2]!.low &&
      candle.low < candles[i + 1]!.low &&
      candle.low < candles[i + 2]!.low
    ) {
      swings.push({ index: i, price: candle.low, date: candle.date });
    }
  }
  return swings;
}

export function rankStoredLevels(currentPrice: number, swingHighs: SwingPoint[], swingLows: SwingPoint[]): RankedLevels {
  const latestResistances = swingHighs.slice(-5).map((s) => s.price);
  const latestSupports = swingLows.slice(-5).map((s) => s.price);

  const resistances = [...latestResistances].sort(
    (a, b) => Math.abs(a - currentPrice) - Math.abs(b - currentPrice),
  );
  const supports = [...latestSupports].sort(
    (a, b) => Math.abs(a - currentPrice) - Math.abs(b - currentPrice),
  );

  return {
    supports,
    resistances,
    nearestSupport: nearestSupportBelow(currentPrice, latestSupports),
    nearestResistance: nearestResistanceAbove(currentPrice, latestResistances),
  };
}

export function latestSwingLevels(swingHighs: SwingPoint[], swingLows: SwingPoint[]): {
  resistances: number[];
  supports: number[];
} {
  return {
    resistances: swingHighs.slice(-5).map((s) => s.price),
    supports: swingLows.slice(-5).map((s) => s.price),
  };
}

export function detectStructureTrend(swingHighs: SwingPoint[], swingLows: SwingPoint[]): StructureTrend {
  const highs = swingHighs.slice(-3);
  const lows = swingLows.slice(-3);

  if (highs.length < 3 || lows.length < 3) {
    return 'Sideways';
  }

  const higherHighs = highs[1]!.price > highs[0]!.price && highs[2]!.price > highs[1]!.price;
  const higherLows = lows[1]!.price > lows[0]!.price && lows[2]!.price > lows[1]!.price;
  const lowerHighs = highs[1]!.price < highs[0]!.price && highs[2]!.price < highs[1]!.price;
  const lowerLows = lows[1]!.price < lows[0]!.price && lows[2]!.price < lows[1]!.price;

  if (higherHighs && higherLows) {
    return 'Bullish';
  }
  if (lowerHighs && lowerLows) {
    return 'Bearish';
  }
  return 'Sideways';
}

export function toMarketBias(trend: StructureTrend): MarketBias {
  if (trend === 'Bullish') {
    return 'bullish';
  }
  if (trend === 'Bearish') {
    return 'bearish';
  }
  return 'sideways';
}

export function nearestResistanceAbove(price: number, resistances: number[]): number | null {
  const above = resistances.filter((level) => level > price).sort((a, b) => a - b);
  return above[0] ?? null;
}

export function nearestSupportBelow(price: number, supports: number[]): number | null {
  const below = supports.filter((level) => level < price).sort((a, b) => b - a);
  return below[0] ?? null;
}

export function safetyBuffer(price: number): number {
  return Math.max(price * SAFETY_BUFFER_PCT, MIN_TICK);
}

export function withinPullbackTolerance(price: number, level: number): boolean {
  return Math.abs(price - level) / level <= PULLBACK_TOLERANCE_PCT;
}

export function isBullishCandle(candle: Candle): boolean {
  return candle.close > candle.open;
}

export function isBearishCandle(candle: Candle): boolean {
  return candle.close < candle.open;
}

export function scanBuyPullbackSetup(candles: Candle[]): PullbackSetupResult {
  const currentIndex = candles.length - 1;
  const current = candles[currentIndex]!;
  const previous = candles[currentIndex - 1];

  if (!previous) {
    return emptySetup('Insufficient candles for BUY setup');
  }

  const start = Math.max(2, currentIndex - SETUP_LOOKBACK);
  let best: PullbackSetupResult | null = null;

  for (let breakoutIndex = start; breakoutIndex < currentIndex - 1; breakoutIndex += 1) {
    const history = candles.slice(0, breakoutIndex + 1);
    const resistances = detectSwingHighs(history)
      .slice(-5)
      .map((s) => s.price);
    const breakout = candles[breakoutIndex]!;
    const preBreakoutPrice = candles[breakoutIndex - 1]!.close;
    const level = nearestResistanceAbove(preBreakoutPrice, resistances);
    if (level === null) {
      continue;
    }

    const bullishBreakout = isBullishCandle(breakout) && breakout.close > level;
    if (!bullishBreakout) {
      continue;
    }

    const breakoutLow = breakout.low;
    let pullbackTouched = false;
    let invalidPullback = false;
    let pullbackLow = breakoutLow;

    for (let j = breakoutIndex + 1; j < currentIndex; j += 1) {
      const candle = candles[j]!;
      if (candle.close < level) {
        invalidPullback = true;
        break;
      }

      pullbackLow = Math.min(pullbackLow, candle.low);
      if (candle.low < breakoutLow) {
        invalidPullback = true;
        break;
      }

      if (withinPullbackTolerance(candle.low, level) || candle.low <= level * (1 + PULLBACK_TOLERANCE_PCT)) {
        pullbackTouched = true;
      }
    }

    const confirmationValid =
      isBullishCandle(current) && current.close > previous.high && current.close > current.open;
    const pullbackValid = pullbackTouched && !invalidPullback;

    if (pullbackValid && confirmationValid) {
      best = {
        detected: true,
        breakoutIndex,
        breakoutLevel: level,
        pullbackLow,
        pullbackHigh: breakout.high,
        pullbackValid,
        confirmationValid,
        reason: `BUY: breakout @ ${level.toFixed(2)}, pullback held, confirmation candle`,
      };
      break;
    }
  }

  return (
    best ?? {
      detected: false,
      breakoutIndex: -1,
      breakoutLevel: 0,
      pullbackLow: 0,
      pullbackHigh: 0,
      pullbackValid: false,
      confirmationValid:
        isBullishCandle(current) && current.close > previous.high && current.close > current.open,
      reason: 'No valid BUY breakout-pullback-confirmation sequence',
    }
  );
}

export function scanSellPullbackSetup(candles: Candle[]): PullbackSetupResult {
  const currentIndex = candles.length - 1;
  const current = candles[currentIndex]!;
  const previous = candles[currentIndex - 1];

  if (!previous) {
    return emptySetup('Insufficient candles for SELL setup');
  }

  const start = Math.max(2, currentIndex - SETUP_LOOKBACK);
  let best: PullbackSetupResult | null = null;

  for (let breakoutIndex = start; breakoutIndex < currentIndex - 1; breakoutIndex += 1) {
    const history = candles.slice(0, breakoutIndex + 1);
    const supports = detectSwingLows(history)
      .slice(-5)
      .map((s) => s.price);
    const breakout = candles[breakoutIndex]!;
    const preBreakoutPrice = candles[breakoutIndex - 1]!.close;
    const level = nearestSupportBelow(preBreakoutPrice, supports);
    if (level === null) {
      continue;
    }

    const bearishBreakout = isBearishCandle(breakout) && breakout.close < level;
    if (!bearishBreakout) {
      continue;
    }

    const breakoutHigh = breakout.high;
    let pullbackTouched = false;
    let invalidPullback = false;
    let pullbackHigh = breakoutHigh;

    for (let j = breakoutIndex + 1; j < currentIndex; j += 1) {
      const candle = candles[j]!;
      if (candle.close > level) {
        invalidPullback = true;
        break;
      }

      pullbackHigh = Math.max(pullbackHigh, candle.high);
      if (candle.high > breakoutHigh) {
        invalidPullback = true;
        break;
      }

      if (withinPullbackTolerance(candle.high, level) || candle.high >= level * (1 - PULLBACK_TOLERANCE_PCT)) {
        pullbackTouched = true;
      }
    }

    const confirmationValid =
      isBearishCandle(current) && current.close < previous.low && current.close < current.open;
    const pullbackValid = pullbackTouched && !invalidPullback;

    if (pullbackValid && confirmationValid) {
      best = {
        detected: true,
        breakoutIndex,
        breakoutLevel: level,
        pullbackLow: breakout.low,
        pullbackHigh,
        pullbackValid,
        confirmationValid,
        reason: `SELL: breakdown @ ${level.toFixed(2)}, pullback held, confirmation candle`,
      };
      break;
    }
  }

  return (
    best ?? {
      detected: false,
      breakoutIndex: -1,
      breakoutLevel: 0,
      pullbackLow: 0,
      pullbackHigh: 0,
      pullbackValid: false,
      confirmationValid:
        isBearishCandle(current) && current.close < previous.low && current.close < current.open,
      reason: 'No valid SELL breakdown-pullback-confirmation sequence',
    }
  );
}

export function calculateRiskTargets(params: {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  structuralTarget: number | null;
}): {
  risk: number;
  target1: number;
  target2: number;
  target3: number;
  structuralTarget: number | null;
  recommendedTarget: number;
  expectedReward: number;
  riskRewardRatio: number;
} {
  const { direction, entryPrice, stopLoss, structuralTarget } = params;
  const risk = direction === 'BUY' ? entryPrice - stopLoss : stopLoss - entryPrice;

  if (risk <= 0) {
    return {
      risk: 0,
      target1: entryPrice,
      target2: entryPrice,
      target3: entryPrice,
      structuralTarget,
      recommendedTarget: entryPrice,
      expectedReward: 0,
      riskRewardRatio: 0,
    };
  }

  const target1 = direction === 'BUY' ? entryPrice + risk : entryPrice - risk;
  const target2 = direction === 'BUY' ? entryPrice + risk * 2 : entryPrice - risk * 2;
  const target3 = direction === 'BUY' ? entryPrice + risk * 3 : entryPrice - risk * 3;

  let recommendedTarget = target2;
  if (structuralTarget !== null) {
    if (direction === 'BUY' && structuralTarget > entryPrice && structuralTarget < target2) {
      recommendedTarget = structuralTarget;
    }
    if (direction === 'SELL' && structuralTarget < entryPrice && structuralTarget > target2) {
      recommendedTarget = structuralTarget;
    }
  }

  const expectedReward =
    direction === 'BUY' ? recommendedTarget - entryPrice : entryPrice - recommendedTarget;

  return {
    risk,
    target1,
    target2,
    target3,
    structuralTarget,
    recommendedTarget,
    expectedReward,
    riskRewardRatio: expectedReward / risk,
  };
}

function emptySetup(reason: string): PullbackSetupResult {
  return {
    detected: false,
    breakoutIndex: -1,
    breakoutLevel: 0,
    pullbackLow: 0,
    pullbackHigh: 0,
    pullbackValid: false,
    confirmationValid: false,
    reason,
  };
}

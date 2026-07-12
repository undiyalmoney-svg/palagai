import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../models/strategy-context.model';
import {
  bodySize,
  candleRange,
  trend30m,
} from './ohlc-candle.util';
import {
  calculateRiskTargets,
  detectSwingHighs,
  detectSwingLows,
  detectStructureTrend,
  isBearishCandle,
  isBullishCandle,
  nearestResistanceAbove,
  nearestSupportBelow,
  safetyBuffer,
  withinPullbackTolerance,
} from './swing-level.util';

export type PriceActionTrend = 'Bullish' | 'Bearish' | 'Sideways';

export interface PriceActionLevels {
  latestSwingHigh: number | null;
  latestSwingLow: number | null;
  majorResistance: number | null;
  majorSupport: number | null;
  breakoutLevel: number | null;
  retestLevel: number | null;
}

export interface PriceActionEvaluation {
  tradingDay: string;
  trend: PriceActionTrend;
  trend30m: 'Bullish' | 'Bearish' | 'Sideways';
  levels: PriceActionLevels;
  atSupport: boolean;
  atResistance: boolean;
  atBreakout: boolean;
  atRetest: boolean;
  levelType: 'Support' | 'Resistance' | 'Breakout' | 'Retest' | 'None';
  confirmationValid: boolean;
  confirmationReason: string;
  structureIntact: boolean;
  qualityScore: number;
  qualityBreakdown: Record<string, number>;
  signalType: 'BUY' | 'SELL' | 'NO_TRADE';
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskRewardRatio: number;
  tradeTaken: boolean;
  reason: string;
  noTradeReasons: string[];
}

const MIN_TICK = 0.05;
const LEVEL_TOLERANCE_PCT = 0.002;
const TOO_CLOSE_LEVEL_PCT = 0.0015;
const MIDDLE_RANGE_LOW = 0.35;
const MIDDLE_RANGE_HIGH = 0.65;
const CLOSE_NEAR_EXTREME_PCT = 0.7;
const MIN_RR = 2;
const QUALITY_THRESHOLD = 90;
const SWING_LOOKBACK = 60;

export function evaluatePriceActionEngine(ctx: StrategyContext): PriceActionEvaluation {
  const candles60 = [...ctx.previous60m, ctx.candle60m];
  const candles30 = [...ctx.previous30m, ctx.candle30m];
  const candles5 = [...ctx.previous5m, ctx.candle5m];
  const current5 = ctx.candle5m;
  const previous5 = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
  const tradingDay = extractDate(current5.date);

  const empty = emptyEvaluation(tradingDay, current5);

  if (candles60.length < 10 || candles30.length < 6 || !previous5) {
    return { ...empty, reason: 'Insufficient completed OHLC history' };
  }

  const trend60 = detectTrend60m(candles60);
  if (trend60 === 'Sideways') {
    return {
      ...empty,
      trend: 'Sideways',
      reason: '60m trend sideways — NO TRADE',
      noTradeReasons: ['Market Sideways', 'Trend unclear'],
    };
  }

  const confirm30 = toTrendLabel(trend30m(candles30).trend);
  if (!timeframesAgree(trend60, confirm30)) {
    return {
      ...empty,
      trend: trend60,
      trend30m: confirm30,
      reason: '30m does not confirm 60m trend',
      noTradeReasons: ['Trend unclear'],
    };
  }

  const levels = drawPriceActionLevels(candles60, candles30);
  const levelTouch = detectLevelTouch(current5, levels, trend60);

  if (levelTouch.type === 'None') {
    return {
      ...empty,
      trend: trend60,
      trend30m: confirm30,
      levels,
      reason: 'Price not at Support, Resistance, Breakout, or Retest — NO TRADE',
      noTradeReasons: ['Entry in middle of range'],
    };
  }

  if (isMiddleOfRange(current5.close, candles60)) {
    return {
      ...empty,
      trend: trend60,
      trend30m: confirm30,
      levels,
      ...levelTouch.flags,
      levelType: levelTouch.type,
      reason: 'Entry in middle of range — NO TRADE',
      noTradeReasons: ['Entry in middle of range'],
    };
  }

  if (levelsTooClose(levels, current5.close)) {
    return {
      ...empty,
      trend: trend60,
      trend30m: confirm30,
      levels,
      ...levelTouch.flags,
      levelType: levelTouch.type,
      reason: 'Support and resistance too close — NO TRADE',
      noTradeReasons: ['Support too close', 'Resistance too close'],
    };
  }

  const swingHighs5 = detectSwingHighs(candles5);
  const swingLows5 = detectSwingLows(candles5);

  if (trend60 === 'Bullish') {
    return evaluateBuySetup({
      tradingDay,
      current5,
      previous5,
      trend60,
      trend30m: confirm30,
      levels,
      levelTouch,
      swingLows5,
      swingHighs5,
      candles60,
    });
  }

  return evaluateSellSetup({
    tradingDay,
    current5,
    previous5,
    trend60,
    trend30m: confirm30,
    levels,
    levelTouch,
    swingLows5,
    swingHighs5,
    candles60,
  });
}

function evaluateBuySetup(params: {
  tradingDay: string;
  current5: Candle;
  previous5: Candle;
  trend60: PriceActionTrend;
  trend30m: 'Bullish' | 'Bearish' | 'Sideways';
  levels: PriceActionLevels;
  levelTouch: LevelTouch;
  swingLows5: ReturnType<typeof detectSwingLows>;
  swingHighs5: ReturnType<typeof detectSwingHighs>;
  candles60: Candle[];
}): PriceActionEvaluation {
  const validLevel =
    params.levelTouch.type === 'Support' || params.levelTouch.type === 'Retest';
  if (!validLevel) {
    return baseResult(params, 'Bullish setup requires Support or Breakout Retest', [
      'Entry in middle of range',
    ]);
  }

  const confirmation = validateBuyConfirmation(params.current5, params.previous5);
  const prevSwingLow = params.swingLows5.at(-2)?.price ?? params.swingLows5.at(-1)?.price ?? null;
  const structureIntact =
    prevSwingLow !== null && params.current5.low >= prevSwingLow - safetyBuffer(prevSwingLow);

  const supportLevel = params.levels.majorSupport ?? params.levels.latestSwingLow;
  const stopBelowSupport = supportLevel !== null ? supportLevel - safetyBuffer(supportLevel) : null;
  const stopBelowCandle = params.current5.low - safetyBuffer(params.current5.low);
  const stopLoss = Math.min(
    stopBelowSupport ?? stopBelowCandle,
    stopBelowCandle,
  );

  const entryPrice = params.current5.high + MIN_TICK;
  const risk = entryPrice - stopLoss;
  if (risk <= 0) {
    return baseResult(params, 'Invalid risk for BUY — stop at or above entry', ['Weak candle']);
  }

  const structuralTarget = nearestResistanceAbove(
    entryPrice,
    params.swingHighs5.slice(-5).map((s) => s.price),
  );
  const targets = calculateRiskTargets({
    direction: 'BUY',
    entryPrice,
    stopLoss,
    structuralTarget,
  });

  const rr = targets.riskRewardRatio;
  const qualityBreakdown = scoreQuality({
    trendClear: params.trend60 === 'Bullish' && params.trend30m === 'Bullish',
    atLevel: validLevel && (params.levelTouch.flags.atSupport || params.levelTouch.flags.atRetest),
    confirmation: confirmation.valid,
    structureIntact,
    rrValid: rr >= MIN_RR,
  });

  const qualityScore = Object.values(qualityBreakdown).reduce((sum, v) => sum + v, 0);
  const noTradeReasons = collectNoTradeReasons({
    qualityScore,
    confirmation: confirmation.valid,
    rr,
    structureIntact,
  });

  const tradeable = qualityScore >= QUALITY_THRESHOLD && noTradeReasons.length === 0;

  return {
    tradingDay: params.tradingDay,
    trend: 'Bullish',
    trend30m: params.trend30m,
    levels: params.levels,
    ...params.levelTouch.flags,
    levelType: params.levelTouch.type,
    confirmationValid: confirmation.valid,
    confirmationReason: confirmation.reason,
    structureIntact,
    qualityScore,
    qualityBreakdown,
    signalType: tradeable ? 'BUY' : 'NO_TRADE',
    entryPrice,
    stopLoss,
    target1: targets.target1,
    target2: targets.target2,
    target3: pickTarget3Buy(targets, structuralTarget, entryPrice),
    riskRewardRatio: rr,
    tradeTaken: tradeable,
    reason: tradeable
      ? `BUY — Quality ${qualityScore}/100 at ${params.levelTouch.type}`
      : noTradeReasons[0] ?? confirmation.reason,
    noTradeReasons,
  };
}

function evaluateSellSetup(params: {
  tradingDay: string;
  current5: Candle;
  previous5: Candle;
  trend60: PriceActionTrend;
  trend30m: 'Bullish' | 'Bearish' | 'Sideways';
  levels: PriceActionLevels;
  levelTouch: LevelTouch;
  swingLows5: ReturnType<typeof detectSwingLows>;
  swingHighs5: ReturnType<typeof detectSwingHighs>;
  candles60: Candle[];
}): PriceActionEvaluation {
  const validLevel =
    params.levelTouch.type === 'Resistance' || params.levelTouch.type === 'Retest';
  if (!validLevel) {
    return baseResult(params, 'Bearish setup requires Resistance or Breakdown Retest', [
      'Entry in middle of range',
    ]);
  }

  const confirmation = validateSellConfirmation(params.current5, params.previous5);
  const prevSwingHigh = params.swingHighs5.at(-2)?.price ?? params.swingHighs5.at(-1)?.price ?? null;
  const structureIntact =
    prevSwingHigh !== null && params.current5.high <= prevSwingHigh + safetyBuffer(prevSwingHigh);

  const resistanceLevel = params.levels.majorResistance ?? params.levels.latestSwingHigh;
  const stopAboveResistance =
    resistanceLevel !== null ? resistanceLevel + safetyBuffer(resistanceLevel) : null;
  const stopAboveCandle = params.current5.high + safetyBuffer(params.current5.high);
  const stopLoss = Math.max(
    stopAboveResistance ?? stopAboveCandle,
    stopAboveCandle,
  );

  const entryPrice = params.current5.low - MIN_TICK;
  const risk = stopLoss - entryPrice;
  if (risk <= 0) {
    return baseResult(params, 'Invalid risk for SELL — stop at or below entry', ['Weak candle']);
  }

  const structuralTarget = nearestSupportBelow(
    entryPrice,
    params.swingLows5.slice(-5).map((s) => s.price),
  );
  const targets = calculateRiskTargets({
    direction: 'SELL',
    entryPrice,
    stopLoss,
    structuralTarget,
  });

  const rr = targets.riskRewardRatio;
  const qualityBreakdown = scoreQuality({
    trendClear: params.trend60 === 'Bearish' && params.trend30m === 'Bearish',
    atLevel: validLevel && (params.levelTouch.flags.atResistance || params.levelTouch.flags.atRetest),
    confirmation: confirmation.valid,
    structureIntact,
    rrValid: rr >= MIN_RR,
  });

  const qualityScore = Object.values(qualityBreakdown).reduce((sum, v) => sum + v, 0);
  const noTradeReasons = collectNoTradeReasons({
    qualityScore,
    confirmation: confirmation.valid,
    rr,
    structureIntact,
  });

  const tradeable = qualityScore >= QUALITY_THRESHOLD && noTradeReasons.length === 0;

  return {
    tradingDay: params.tradingDay,
    trend: 'Bearish',
    trend30m: params.trend30m,
    levels: params.levels,
    ...params.levelTouch.flags,
    levelType: params.levelTouch.type,
    confirmationValid: confirmation.valid,
    confirmationReason: confirmation.reason,
    structureIntact,
    qualityScore,
    qualityBreakdown,
    signalType: tradeable ? 'SELL' : 'NO_TRADE',
    entryPrice,
    stopLoss,
    target1: targets.target1,
    target2: targets.target2,
    target3: pickTarget3Sell(targets, structuralTarget, entryPrice),
    riskRewardRatio: rr,
    tradeTaken: tradeable,
    reason: tradeable
      ? `SELL — Quality ${qualityScore}/100 at ${params.levelTouch.type}`
      : noTradeReasons[0] ?? confirmation.reason,
    noTradeReasons,
  };
}

function detectTrend60m(candles60: Candle[]): PriceActionTrend {
  const swingHighs = detectSwingHighs(candles60);
  const swingLows = detectSwingLows(candles60);
  const trend = detectStructureTrend(swingHighs, swingLows);
  if (trend === 'Bullish') {
    return 'Bullish';
  }
  if (trend === 'Bearish') {
    return 'Bearish';
  }
  return 'Sideways';
}

function drawPriceActionLevels(candles60: Candle[], candles30: Candle[]): PriceActionLevels {
  const swingHighs60 = detectSwingHighs(candles60);
  const swingLows60 = detectSwingLows(candles60);
  const latestSwingHigh = swingHighs60.at(-1)?.price ?? null;
  const latestSwingLow = swingLows60.at(-1)?.price ?? null;

  const lookback = candles60.slice(-SWING_LOOKBACK);
  const majorResistance =
    swingHighs60.length >= 2
      ? Math.max(...swingHighs60.slice(-5).map((s) => s.price))
      : lookback.length
        ? Math.max(...lookback.map((c) => c.high))
        : null;
  const majorSupport =
    swingLows60.length >= 2
      ? Math.min(...swingLows60.slice(-5).map((s) => s.price))
      : lookback.length
        ? Math.min(...lookback.map((c) => c.low))
        : null;

  const breakout = findRecentBreakout(candles30, swingHighs60, swingLows60);

  return {
    latestSwingHigh,
    latestSwingLow,
    majorResistance,
    majorSupport,
    breakoutLevel: breakout.level,
    retestLevel: breakout.retestLevel,
  };
}

function findRecentBreakout(
  candles30: Candle[],
  swingHighs: ReturnType<typeof detectSwingHighs>,
  swingLows: ReturnType<typeof detectSwingLows>,
): { level: number | null; retestLevel: number | null } {
  const current = candles30.at(-1)!;
  const resistances = swingHighs.slice(-5).map((s) => s.price);
  const supports = swingLows.slice(-5).map((s) => s.price);

  for (let i = candles30.length - 2; i >= Math.max(1, candles30.length - 20); i -= 1) {
    const candle = candles30[i]!;
    const resistance = nearestResistanceAbove(candle.close, resistances);
    if (resistance !== null && candle.close > resistance) {
      return { level: resistance, retestLevel: resistance };
    }
    const support = nearestSupportBelow(candle.close, supports);
    if (support !== null && candle.close < support) {
      return { level: support, retestLevel: support };
    }
  }

  const resistance = nearestResistanceAbove(current.close, resistances);
  const support = nearestSupportBelow(current.close, supports);
  if (resistance !== null && current.close > resistance) {
    return { level: resistance, retestLevel: resistance };
  }
  if (support !== null && current.close < support) {
    return { level: support, retestLevel: support };
  }

  return { level: null, retestLevel: null };
}

interface LevelTouch {
  type: 'Support' | 'Resistance' | 'Breakout' | 'Retest' | 'None';
  flags: {
    atSupport: boolean;
    atResistance: boolean;
    atBreakout: boolean;
    atRetest: boolean;
  };
}

function detectLevelTouch(
  candle: Candle,
  levels: PriceActionLevels,
  trend: PriceActionTrend,
): LevelTouch {
  const flags = {
    atSupport: false,
    atResistance: false,
    atBreakout: false,
    atRetest: false,
  };

  const support = levels.majorSupport ?? levels.latestSwingLow;
  const resistance = levels.majorResistance ?? levels.latestSwingHigh;
  const retest = levels.retestLevel ?? levels.breakoutLevel;

  if (support !== null && touchesLevel(candle, support, 'support')) {
    flags.atSupport = true;
    return { type: 'Support', flags };
  }

  if (resistance !== null && touchesLevel(candle, resistance, 'resistance')) {
    flags.atResistance = true;
    return { type: 'Resistance', flags };
  }

  if (retest !== null && withinPullbackTolerance(candle.low, retest) && trend === 'Bullish') {
    flags.atRetest = true;
    return { type: 'Retest', flags };
  }

  if (retest !== null && withinPullbackTolerance(candle.high, retest) && trend === 'Bearish') {
    flags.atRetest = true;
    return { type: 'Retest', flags };
  }

  if (levels.breakoutLevel !== null) {
    if (trend === 'Bullish' && candle.close > levels.breakoutLevel) {
      flags.atBreakout = true;
      return { type: 'Breakout', flags };
    }
    if (trend === 'Bearish' && candle.close < levels.breakoutLevel) {
      flags.atBreakout = true;
      return { type: 'Breakout', flags };
    }
  }

  return { type: 'None', flags };
}

function touchesLevel(candle: Candle, level: number, side: 'support' | 'resistance'): boolean {
  if (side === 'support') {
    return (
      withinPullbackTolerance(candle.low, level) ||
      (candle.low <= level * (1 + LEVEL_TOLERANCE_PCT) && candle.close >= level)
    );
  }
  return (
    withinPullbackTolerance(candle.high, level) ||
    (candle.high >= level * (1 - LEVEL_TOLERANCE_PCT) && candle.close <= level)
  );
}

function validateBuyConfirmation(current: Candle, previous: Candle): { valid: boolean; reason: string } {
  const range = candleRange(current);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const closeNearHigh = range > 0 && current.close >= current.low + range * CLOSE_NEAR_EXTREME_PCT;

  const checks = [
    { ok: isBullishCandle(current), label: 'Close > Open' },
    { ok: bodySize(current) > bodySize(previous), label: 'Body larger than previous' },
    { ok: closeNearHigh, label: 'Close near High' },
    { ok: lowerWick > upperWick, label: 'Lower wick longer than upper wick' },
  ];

  const failed = checks.filter((c) => !c.ok);
  return {
    valid: failed.length === 0,
    reason:
      failed.length === 0
        ? 'Bullish confirmation candle valid'
        : `Weak candle — ${failed.map((f) => f.label).join(', ')}`,
  };
}

function validateSellConfirmation(current: Candle, previous: Candle): { valid: boolean; reason: string } {
  const range = candleRange(current);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const closeNearLow = range > 0 && current.close <= current.high - range * CLOSE_NEAR_EXTREME_PCT;

  const checks = [
    { ok: isBearishCandle(current), label: 'Close < Open' },
    { ok: bodySize(current) > bodySize(previous), label: 'Body larger than previous' },
    { ok: closeNearLow, label: 'Close near Low' },
    { ok: upperWick > lowerWick, label: 'Upper wick longer than lower wick' },
  ];

  const failed = checks.filter((c) => !c.ok);
  return {
    valid: failed.length === 0,
    reason:
      failed.length === 0
        ? 'Bearish confirmation candle valid'
        : `Weak candle — ${failed.map((f) => f.label).join(', ')}`,
  };
}

function scoreQuality(params: {
  trendClear: boolean;
  atLevel: boolean;
  confirmation: boolean;
  structureIntact: boolean;
  rrValid: boolean;
}): Record<string, number> {
  return {
    trend: params.trendClear ? 20 : 0,
    level: params.atLevel ? 20 : 0,
    confirmationCandle: params.confirmation ? 20 : 0,
    marketStructure: params.structureIntact ? 20 : 0,
    riskReward: params.rrValid ? 20 : 0,
  };
}

function collectNoTradeReasons(params: {
  qualityScore: number;
  confirmation: boolean;
  rr: number;
  structureIntact: boolean;
}): string[] {
  const reasons: string[] = [];
  if (params.qualityScore < QUALITY_THRESHOLD) {
    reasons.push(`Quality Score ${params.qualityScore} below ${QUALITY_THRESHOLD}`);
  }
  if (!params.confirmation) {
    reasons.push('Weak candle');
  }
  if (params.rr < MIN_RR) {
    reasons.push('Risk Reward below 1:2');
  }
  if (!params.structureIntact) {
    reasons.push('Structure failure');
  }
  return reasons;
}

function isMiddleOfRange(price: number, candles60: Candle[]): boolean {
  const window = candles60.slice(-SWING_LOOKBACK);
  if (!window.length) {
    return false;
  }
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  const range = high - low;
  if (range <= 0) {
    return false;
  }
  const position = (price - low) / range;
  return position > MIDDLE_RANGE_LOW && position < MIDDLE_RANGE_HIGH;
}

function levelsTooClose(levels: PriceActionLevels, price: number): boolean {
  const support = levels.majorSupport ?? levels.latestSwingLow;
  const resistance = levels.majorResistance ?? levels.latestSwingHigh;
  if (support === null || resistance === null || price <= 0) {
    return false;
  }
  const gap = Math.abs(resistance - support) / price;
  return gap < TOO_CLOSE_LEVEL_PCT;
}

function timeframesAgree(
  trend60: PriceActionTrend,
  trend30: 'Bullish' | 'Bearish' | 'Sideways',
): boolean {
  if (trend60 === 'Bullish') {
    return trend30 === 'Bullish';
  }
  if (trend60 === 'Bearish') {
    return trend30 === 'Bearish';
  }
  return false;
}

function toTrendLabel(trend: 'BUY' | 'SELL' | 'NEUTRAL'): 'Bullish' | 'Bearish' | 'Sideways' {
  if (trend === 'BUY') {
    return 'Bullish';
  }
  if (trend === 'SELL') {
    return 'Bearish';
  }
  return 'Sideways';
}

function pickTarget3Buy(
  targets: ReturnType<typeof calculateRiskTargets>,
  structural: number | null,
  entryPrice: number,
): number {
  if (structural !== null && structural > entryPrice && structural < targets.target2) {
    return structural;
  }
  return targets.target2;
}

function pickTarget3Sell(
  targets: ReturnType<typeof calculateRiskTargets>,
  structural: number | null,
  entryPrice: number,
): number {
  if (structural !== null && structural < entryPrice && structural > targets.target2) {
    return structural;
  }
  return targets.target2;
}

function extractDate(dateTime: string): string {
  if (dateTime.includes('T')) {
    return dateTime.split('T')[0]!;
  }
  return dateTime.slice(0, 10);
}

function baseResult(
  params: {
    tradingDay: string;
    trend60: PriceActionTrend;
    trend30m: 'Bullish' | 'Bearish' | 'Sideways';
    levels: PriceActionLevels;
    levelTouch: LevelTouch;
  },
  reason: string,
  noTradeReasons: string[],
): PriceActionEvaluation {
  return {
    tradingDay: params.tradingDay,
    trend: params.trend60,
    trend30m: params.trend30m,
    levels: params.levels,
    ...params.levelTouch.flags,
    levelType: params.levelTouch.type,
    confirmationValid: false,
    confirmationReason: reason,
    structureIntact: false,
    qualityScore: 0,
    qualityBreakdown: {},
    signalType: 'NO_TRADE',
    entryPrice: 0,
    stopLoss: 0,
    target1: 0,
    target2: 0,
    target3: 0,
    riskRewardRatio: 0,
    tradeTaken: false,
    reason,
    noTradeReasons,
  };
}

function emptyEvaluation(tradingDay: string, candle: Candle): PriceActionEvaluation {
  return {
    tradingDay,
    trend: 'Sideways',
    trend30m: 'Sideways',
    levels: {
      latestSwingHigh: null,
      latestSwingLow: null,
      majorResistance: null,
      majorSupport: null,
      breakoutLevel: null,
      retestLevel: null,
    },
    atSupport: false,
    atResistance: false,
    atBreakout: false,
    atRetest: false,
    levelType: 'None',
    confirmationValid: false,
    confirmationReason: '',
    structureIntact: false,
    qualityScore: 0,
    qualityBreakdown: {},
    signalType: 'NO_TRADE',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target1: candle.close,
    target2: candle.close,
    target3: candle.close,
    riskRewardRatio: 0,
    tradeTaken: false,
    reason: '',
    noTradeReasons: [],
  };
}

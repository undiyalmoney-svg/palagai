import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../models/strategy-context.model';
import { bodySize, candleRange, trend30m } from './ohlc-candle.util';
import {
  calculateRiskTargets,
  detectStructureTrend,
  detectSwingHighs,
  detectSwingLows,
  isBearishCandle,
  isBullishCandle,
  nearestResistanceAbove,
  nearestSupportBelow,
  safetyBuffer,
  withinPullbackTolerance,
} from './swing-level.util';

export const SMART_SPAR_STRATEGY_ID = 'smart-price-action-reversal-v1';
export const SMART_SPAR_MIN_TICK = 0.05;

export type SparTrend = 'Bullish' | 'Bearish' | 'Sideways';

export interface SparStageStatus {
  trendAlignment: boolean;
  pullback: boolean;
  breakOfStructure: boolean;
  retest: boolean;
  confirmation: boolean;
}

export interface SmartPriceActionReversalEvaluation {
  tradingDate: string;
  direction: 'BUY' | 'SELL' | 'NO_TRADE';
  trend60m: SparTrend;
  trend30m: SparTrend;
  pullbackDetected: boolean;
  breakOfStructure: boolean;
  retestHeld: boolean;
  confirmationCandle: boolean;
  qualityScore: number;
  qualityBreakdown: Record<string, number>;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  risk: number;
  reward: number;
  riskRewardRatio: number;
  pullbackLow: number;
  pullbackHigh: number;
  structureReferenceLow: number;
  structureReferenceHigh: number;
  finalDecision: 'BUY' | 'SELL' | 'NO_TRADE';
  tradeAllowed: boolean;
  reason: string;
  stages: SparStageStatus;
}

const SCAN_LOOKBACK = 80;
const PULLBACK_MIN_PCT = 0.003;
const QUALITY_THRESHOLD = 90;

export function evaluateSmartPriceActionReversal(ctx: StrategyContext): SmartPriceActionReversalEvaluation {
  const candles60 = [...ctx.previous60m, ctx.candle60m];
  const candles30 = [...ctx.previous30m, ctx.candle30m];
  const candles5 = [...ctx.previous5m, ctx.candle5m];
  const current5 = ctx.candle5m;
  const tradingDate = extractDate(current5.date);

  const empty = emptyEval(tradingDate, current5);

  if (candles60.length < 12 || candles30.length < 8 || candles5.length < 20) {
    return { ...empty, reason: 'Insufficient completed OHLC history' };
  }

  const trend60 = detectTrend60(candles60);
  if (trend60 === 'Sideways') {
    return {
      ...empty,
      trend60m: 'Sideways',
      reason: '60m trend sideways — NO TRADE',
    };
  }

  const trend30 = detectTrend30(candles30);
  if (!trendsAgree(trend60, trend30)) {
    return {
      ...empty,
      trend60m: trend60,
      trend30m: trend30,
      reason: '30m trend disagrees with 60m — NO TRADE',
    };
  }

  if (trend60 === 'Bullish') {
    return scanBullishSetup(candles5, candles30, tradingDate, trend60, trend30);
  }

  return scanBearishSetup(candles5, candles30, tradingDate, trend60, trend30);
}

function scanBullishSetup(
  candles5: Candle[],
  candles30: Candle[],
  tradingDate: string,
  trend60: SparTrend,
  trend30: SparTrend,
): SmartPriceActionReversalEvaluation {
  const currentIndex = candles5.length - 1;
  const current = candles5[currentIndex]!;
  const previous = candles5[currentIndex - 1]!;
  const empty = emptyEval(tradingDate, current);

  const confirmation = validateBullishConfirmation(current, previous);
  if (!confirmation.valid) {
    return {
      ...empty,
      trend60m: trend60,
      trend30m: trend30,
      confirmationCandle: false,
      reason: confirmation.reason,
    };
  }

  const swingLows30 = detectSwingLows(candles30);
  const supportZone =
    swingLows30.at(-1)?.price ?? detectSwingLows(candles5).at(-2)?.price ?? null;

  let best: SmartPriceActionReversalEvaluation | null = null;
  const start = Math.max(10, currentIndex - SCAN_LOOKBACK);

  for (let bosIndex = start; bosIndex < currentIndex; bosIndex += 1) {
    const history = candles5.slice(0, bosIndex + 1);
    const swingHighs = detectSwingHighs(history);
    const swingLows = detectSwingLows(history);
    if (swingHighs.length < 2 || swingLows.length < 3) {
      continue;
    }

    const brokenHigh = swingHighs[swingHighs.length - 1]!;
    const bosCandle = candles5[bosIndex]!;
    if (bosCandle.close <= brokenHigh.price) {
      continue;
    }

    if (!sellingPressureWeakened(candles5, bosIndex)) {
      continue;
    }

    const higherLow = findHigherLow(swingLows);
    if (!higherLow) {
      continue;
    }

    const pullback = detectBullishPullback(candles5, bosIndex, supportZone, higherLow.price);
    if (!pullback.detected) {
      continue;
    }

    const retest = evaluateBullishRetest(candles5, bosIndex, currentIndex, brokenHigh.price);
    if (!retest.valid) {
      continue;
    }

    const entryPrice = current.high + SMART_SPAR_MIN_TICK;
    const stopLoss = Math.min(pullback.low, current.low) - safetyBuffer(entryPrice);
    const risk = entryPrice - stopLoss;
    if (risk <= 0) {
      continue;
    }

    const structural = nearestResistanceAbove(
      entryPrice,
      detectSwingHighs(candles5)
        .slice(-5)
        .map((s) => s.price),
    );
    const targets = calculateRiskTargets({
      direction: 'BUY',
      entryPrice,
      stopLoss,
      structuralTarget: structural,
    });

    const target3 = targets.target3;
    const targetPrice =
      structural !== null && structural > entryPrice && structural < target3
        ? structural
        : target3;

    const stages: SparStageStatus = {
      trendAlignment: true,
      pullback: true,
      breakOfStructure: true,
      retest: true,
      confirmation: true,
    };
    const qualityBreakdown = scoreStages(stages);
    const qualityScore = 100;

    const evaluation: SmartPriceActionReversalEvaluation = {
      tradingDate,
      direction: 'BUY',
      trend60m: trend60,
      trend30m: trend30,
      pullbackDetected: true,
      breakOfStructure: true,
      retestHeld: true,
      confirmationCandle: true,
      qualityScore,
      qualityBreakdown,
      entryPrice,
      stopLoss,
      target1: targets.target1,
      target2: targets.target2,
      target3: targetPrice,
      risk,
      reward: targetPrice - entryPrice,
      riskRewardRatio: (targetPrice - entryPrice) / risk,
      pullbackLow: pullback.low,
      pullbackHigh: pullback.high,
      structureReferenceLow: higherLow.price,
      structureReferenceHigh: brokenHigh.price,
      finalDecision: qualityScore >= QUALITY_THRESHOLD ? 'BUY' : 'NO_TRADE',
      tradeAllowed: qualityScore >= QUALITY_THRESHOLD,
      reason: `BUY — Quality ${qualityScore}/100 — BOS retest confirmation`,
      stages,
    };

    if (!best) {
      best = evaluation;
    }
  }

  if (best && best.tradeAllowed) {
    return best;
  }

  return {
    ...empty,
    trend60m: trend60,
    trend30m: trend30,
    confirmationCandle: true,
    reason: best?.reason ?? 'Bullish reversal sequence incomplete — NO TRADE',
    stages: best?.stages ?? empty.stages,
    qualityScore: best?.qualityScore ?? scoreTotal(best?.stages ?? empty.stages),
    qualityBreakdown: best ? scoreStages(best.stages) : {},
  };
}

function scanBearishSetup(
  candles5: Candle[],
  candles30: Candle[],
  tradingDate: string,
  trend60: SparTrend,
  trend30: SparTrend,
): SmartPriceActionReversalEvaluation {
  const currentIndex = candles5.length - 1;
  const current = candles5[currentIndex]!;
  const previous = candles5[currentIndex - 1]!;
  const empty = emptyEval(tradingDate, current);

  const confirmation = validateBearishConfirmation(current, previous);
  if (!confirmation.valid) {
    return {
      ...empty,
      trend60m: trend60,
      trend30m: trend30,
      confirmationCandle: false,
      reason: confirmation.reason,
    };
  }

  const swingHighs30 = detectSwingHighs(candles30);
  const resistanceZone =
    swingHighs30.at(-1)?.price ?? detectSwingHighs(candles5).at(-2)?.price ?? null;

  let best: SmartPriceActionReversalEvaluation | null = null;
  const start = Math.max(10, currentIndex - SCAN_LOOKBACK);

  for (let bosIndex = start; bosIndex < currentIndex; bosIndex += 1) {
    const history = candles5.slice(0, bosIndex + 1);
    const swingHighs = detectSwingHighs(history);
    const swingLows = detectSwingLows(history);
    if (swingLows.length < 2 || swingHighs.length < 3) {
      continue;
    }

    const brokenLow = swingLows[swingLows.length - 1]!;
    const bosCandle = candles5[bosIndex]!;
    if (bosCandle.close >= brokenLow.price) {
      continue;
    }

    if (!buyingPressureWeakened(candles5, bosIndex)) {
      continue;
    }

    const lowerHigh = findLowerHigh(swingHighs);
    if (!lowerHigh) {
      continue;
    }

    const pullback = detectBearishPullback(candles5, bosIndex, resistanceZone, lowerHigh.price);
    if (!pullback.detected) {
      continue;
    }

    const retest = evaluateBearishRetest(candles5, bosIndex, currentIndex, brokenLow.price);
    if (!retest.valid) {
      continue;
    }

    const entryPrice = current.low - SMART_SPAR_MIN_TICK;
    const stopLoss = Math.max(pullback.high, current.high) + safetyBuffer(entryPrice);
    const risk = stopLoss - entryPrice;
    if (risk <= 0) {
      continue;
    }

    const structural = nearestSupportBelow(
      entryPrice,
      detectSwingLows(candles5)
        .slice(-5)
        .map((s) => s.price),
    );
    const targets = calculateRiskTargets({
      direction: 'SELL',
      entryPrice,
      stopLoss,
      structuralTarget: structural,
    });

    const target3 = targets.target3;
    const targetPrice =
      structural !== null && structural < entryPrice && structural > target3
        ? structural
        : target3;

    const stages: SparStageStatus = {
      trendAlignment: true,
      pullback: true,
      breakOfStructure: true,
      retest: true,
      confirmation: true,
    };
    const qualityScore = 100;

    const evaluation: SmartPriceActionReversalEvaluation = {
      tradingDate,
      direction: 'SELL',
      trend60m: trend60,
      trend30m: trend30,
      pullbackDetected: true,
      breakOfStructure: true,
      retestHeld: true,
      confirmationCandle: true,
      qualityScore,
      qualityBreakdown: scoreStages(stages),
      entryPrice,
      stopLoss,
      target1: targets.target1,
      target2: targets.target2,
      target3: targetPrice,
      risk,
      reward: entryPrice - targetPrice,
      riskRewardRatio: (entryPrice - targetPrice) / risk,
      pullbackLow: pullback.low,
      pullbackHigh: pullback.high,
      structureReferenceLow: brokenLow.price,
      structureReferenceHigh: lowerHigh.price,
      finalDecision: qualityScore >= QUALITY_THRESHOLD ? 'SELL' : 'NO_TRADE',
      tradeAllowed: qualityScore >= QUALITY_THRESHOLD,
      reason: `SELL — Quality ${qualityScore}/100 — BOS retest confirmation`,
      stages,
    };

    if (!best) {
      best = evaluation;
    }
  }

  if (best && best.tradeAllowed) {
    return best;
  }

  return {
    ...empty,
    trend60m: trend60,
    trend30m: trend30,
    confirmationCandle: true,
    reason: best?.reason ?? 'Bearish reversal sequence incomplete — NO TRADE',
    stages: best?.stages ?? empty.stages,
    qualityScore: best?.qualityScore ?? scoreTotal(best?.stages ?? empty.stages),
    qualityBreakdown: best ? scoreStages(best.stages) : {},
  };
}

function detectTrend60(candles60: Candle[]): SparTrend {
  const trend = detectStructureTrend(detectSwingHighs(candles60), detectSwingLows(candles60));
  if (trend === 'Bullish') {
    return 'Bullish';
  }
  if (trend === 'Bearish') {
    return 'Bearish';
  }
  return 'Sideways';
}

function detectTrend30(candles30: Candle[]): SparTrend {
  const result = trend30m(candles30);
  if (result.trend === 'BUY') {
    return 'Bullish';
  }
  if (result.trend === 'SELL') {
    return 'Bearish';
  }
  return 'Sideways';
}

function trendsAgree(t60: SparTrend, t30: SparTrend): boolean {
  return t60 === t30 && t60 !== 'Sideways';
}

function validateBullishConfirmation(
  current: Candle,
  previous: Candle,
): { valid: boolean; reason: string } {
  const range = candleRange(current);
  const body = bodySize(current);
  const upperWick = current.high - Math.max(current.open, current.close);
  const closeTop = range > 0 && current.close >= current.low + range * 0.75;

  const checks = [
    { ok: isBullishCandle(current), label: 'Close > Open' },
    { ok: body > bodySize(previous), label: 'Body larger than previous' },
    { ok: closeTop, label: 'Close within top 25%' },
    { ok: upperWick < body, label: 'Upper wick smaller than body' },
  ];
  const failed = checks.filter((c) => !c.ok);
  return {
    valid: failed.length === 0,
    reason:
      failed.length === 0
        ? 'Strong bullish confirmation candle'
        : `Confirmation failed — ${failed.map((f) => f.label).join(', ')}`,
  };
}

function validateBearishConfirmation(
  current: Candle,
  previous: Candle,
): { valid: boolean; reason: string } {
  const range = candleRange(current);
  const body = bodySize(current);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const closeBottom = range > 0 && current.close <= current.high - range * 0.75;

  const checks = [
    { ok: isBearishCandle(current), label: 'Close < Open' },
    { ok: body > bodySize(previous), label: 'Body larger than previous' },
    { ok: closeBottom, label: 'Close within bottom 25%' },
    { ok: lowerWick < body, label: 'Lower wick smaller than body' },
  ];
  const failed = checks.filter((c) => !c.ok);
  return {
    valid: failed.length === 0,
    reason:
      failed.length === 0
        ? 'Strong bearish confirmation candle'
        : `Confirmation failed — ${failed.map((f) => f.label).join(', ')}`,
  };
}

function sellingPressureWeakened(candles: Candle[], endIndex: number): boolean {
  const window = candles.slice(Math.max(0, endIndex - 8), endIndex + 1);
  let lowerLowCount = 0;
  for (let i = 1; i < window.length; i += 1) {
    if (window[i]!.low < window[i - 1]!.low) {
      lowerLowCount += 1;
    }
  }
  const recent = window.slice(-3);
  const noRecentLl = recent.length >= 2 && recent[1]!.low >= recent[0]!.low;
  return lowerLowCount <= 2 || noRecentLl;
}

function buyingPressureWeakened(candles: Candle[], endIndex: number): boolean {
  const window = candles.slice(Math.max(0, endIndex - 8), endIndex + 1);
  let higherHighCount = 0;
  for (let i = 1; i < window.length; i += 1) {
    if (window[i]!.high > window[i - 1]!.high) {
      higherHighCount += 1;
    }
  }
  const recent = window.slice(-3);
  const noRecentHh = recent.length >= 2 && recent[1]!.high <= recent[0]!.high;
  return higherHighCount <= 2 || noRecentHh;
}

function findHigherLow(swingLows: ReturnType<typeof detectSwingLows>): { price: number } | null {
  if (swingLows.length < 3) {
    return null;
  }
  const latest = swingLows[swingLows.length - 1]!;
  const prior = swingLows[swingLows.length - 2]!;
  return latest.price > prior.price ? latest : null;
}

function findLowerHigh(swingHighs: ReturnType<typeof detectSwingHighs>): { price: number } | null {
  if (swingHighs.length < 3) {
    return null;
  }
  const latest = swingHighs[swingHighs.length - 1]!;
  const prior = swingHighs[swingHighs.length - 2]!;
  return latest.price < prior.price ? latest : null;
}

function detectBullishPullback(
  candles: Candle[],
  bosIndex: number,
  supportZone: number | null,
  higherLow: number,
): { detected: boolean; low: number; high: number } {
  const preBos = candles.slice(Math.max(0, bosIndex - 15), bosIndex);
  if (preBos.length < 3) {
    return { detected: false, low: 0, high: 0 };
  }

  const segmentHigh = Math.max(...preBos.map((c) => c.high));
  const segmentLow = Math.min(...preBos.map((c) => c.low));
  const pullbackDepth = (segmentHigh - segmentLow) / segmentHigh;
  const nearSupport =
    supportZone !== null
      ? withinPullbackTolerance(segmentLow, supportZone) ||
        withinPullbackTolerance(segmentLow, higherLow)
      : withinPullbackTolerance(segmentLow, higherLow);

  return {
    detected: pullbackDepth >= PULLBACK_MIN_PCT && nearSupport,
    low: segmentLow,
    high: segmentHigh,
  };
}

function detectBearishPullback(
  candles: Candle[],
  bosIndex: number,
  resistanceZone: number | null,
  lowerHigh: number,
): { detected: boolean; low: number; high: number } {
  const preBos = candles.slice(Math.max(0, bosIndex - 15), bosIndex);
  if (preBos.length < 3) {
    return { detected: false, low: 0, high: 0 };
  }

  const segmentHigh = Math.max(...preBos.map((c) => c.high));
  const segmentLow = Math.min(...preBos.map((c) => c.low));
  const pullbackDepth = (segmentHigh - segmentLow) / segmentHigh;
  const nearResistance =
    resistanceZone !== null
      ? withinPullbackTolerance(segmentHigh, resistanceZone) ||
        withinPullbackTolerance(segmentHigh, lowerHigh)
      : withinPullbackTolerance(segmentHigh, lowerHigh);

  return {
    detected: pullbackDepth >= PULLBACK_MIN_PCT && nearResistance,
    low: segmentLow,
    high: segmentHigh,
  };
}

function evaluateBullishRetest(
  candles: Candle[],
  bosIndex: number,
  confirmIndex: number,
  bosLevel: number,
): { valid: boolean } {
  let touched = false;
  for (let i = bosIndex + 1; i < confirmIndex; i += 1) {
    const candle = candles[i]!;
    if (candle.close < bosLevel) {
      return { valid: false };
    }
    if (withinPullbackTolerance(candle.low, bosLevel)) {
      touched = true;
    }
  }
  return { valid: touched };
}

function evaluateBearishRetest(
  candles: Candle[],
  bosIndex: number,
  confirmIndex: number,
  bosLevel: number,
): { valid: boolean } {
  let touched = false;
  for (let i = bosIndex + 1; i < confirmIndex; i += 1) {
    const candle = candles[i]!;
    if (candle.close > bosLevel) {
      return { valid: false };
    }
    if (withinPullbackTolerance(candle.high, bosLevel)) {
      touched = true;
    }
  }
  return { valid: touched };
}

function scoreStages(stages: SparStageStatus): Record<string, number> {
  return {
    trendAlignment: stages.trendAlignment ? 20 : 0,
    pullback: stages.pullback ? 20 : 0,
    breakOfStructure: stages.breakOfStructure ? 20 : 0,
    retest: stages.retest ? 20 : 0,
    confirmationCandle: stages.confirmation ? 20 : 0,
  };
}

function scoreTotal(stages: SparStageStatus): number {
  return Object.values(scoreStages(stages)).reduce((sum, v) => sum + v, 0);
}

function extractDate(dateTime: string): string {
  return dateTime.includes('T') ? dateTime.split('T')[0]! : dateTime.slice(0, 10);
}

function emptyEval(tradingDate: string, candle: Candle): SmartPriceActionReversalEvaluation {
  const stages: SparStageStatus = {
    trendAlignment: false,
    pullback: false,
    breakOfStructure: false,
    retest: false,
    confirmation: false,
  };
  return {
    tradingDate,
    direction: 'NO_TRADE',
    trend60m: 'Sideways',
    trend30m: 'Sideways',
    pullbackDetected: false,
    breakOfStructure: false,
    retestHeld: false,
    confirmationCandle: false,
    qualityScore: 0,
    qualityBreakdown: scoreStages(stages),
    entryPrice: candle.close,
    stopLoss: candle.close,
    target1: candle.close,
    target2: candle.close,
    target3: candle.close,
    risk: 0,
    reward: 0,
    riskRewardRatio: 0,
    pullbackLow: 0,
    pullbackHigh: 0,
    structureReferenceLow: 0,
    structureReferenceHigh: 0,
    finalDecision: 'NO_TRADE',
    tradeAllowed: false,
    reason: '',
    stages,
  };
}

export function validateBullishConfirmationForExit(
  current: Candle,
  previous: Candle,
): boolean {
  return validateBullishConfirmation(current, previous).valid;
}

export function validateBearishConfirmationForExit(
  current: Candle,
  previous: Candle,
): boolean {
  return validateBearishConfirmation(current, previous).valid;
}

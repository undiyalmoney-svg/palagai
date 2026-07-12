import { Candle } from '../../models/candle.model';
import { bodySize, candleRange, midpoint } from './ohlc-candle.util';
import { calculateMomentumScore } from './momentum-score.util';
import {
  SwingPoint,
  StructureTrend,
  calculateRiskTargets,
  detectStructureTrend,
  detectSwingHighs,
  detectSwingLows,
  isBearishCandle,
  isBullishCandle,
  nearestResistanceAbove,
  nearestSupportBelow,
} from './swing-level.util';

export const REVERSAL_MIN_TICK = 0.05;
const SCAN_LOOKBACK = 60;
const SLIGHT_SWING_PCT = 0.005;
const RETEST_TOLERANCE_PCT = 0.002;

export interface ReversalStageStatus {
  trend: boolean;
  weakening: boolean;
  choch: boolean;
  bos: boolean;
  retest: boolean;
  confirmation: boolean;
}

export interface ReversalEvaluation {
  direction: 'BUY' | 'SELL' | null;
  marketTrend: StructureTrend;
  trendWeakeningStatus: string;
  chochStatus: string;
  bosStatus: string;
  retestStatus: string;
  confirmationStatus: string;
  stages: ReversalStageStatus;
  confidenceScore: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  structuralTarget: number | null;
  riskRewardRatio: number;
  totalRisk: number;
  expectedReward: number;
  signalType: 'BUY' | 'SELL' | 'NO_TRADE';
  reason: string;
}

export function evaluateReversalSetup(candles: Candle[]): ReversalEvaluation {
  const empty = emptyEvaluation(candles);
  if (candles.length < 12) {
    return { ...empty, reason: 'Need at least 12 completed candles for reversal detection' };
  }

  const buy = scanBuyReversal(candles);
  const sell = scanSellReversal(candles);

  if (buy.confidenceScore >= sell.confidenceScore && buy.signalType === 'BUY') {
    return buy;
  }
  if (sell.signalType === 'SELL') {
    return sell;
  }
  if (buy.confidenceScore > 0) {
    return buy;
  }

  const swingHighs = detectSwingHighs(candles);
  const swingLows = detectSwingLows(candles);
  const trend = detectStructureTrend(swingHighs, swingLows);

  return {
    ...empty,
    marketTrend: trend,
    trendWeakeningStatus: buy.trendWeakeningStatus || sell.trendWeakeningStatus,
    chochStatus: buy.chochStatus || sell.chochStatus,
    bosStatus: buy.bosStatus || sell.bosStatus,
    retestStatus: buy.retestStatus || sell.retestStatus,
    confirmationStatus: buy.confirmationStatus || sell.confirmationStatus,
    stages: mergeStages(buy.stages, sell.stages),
    confidenceScore: Math.max(buy.confidenceScore, sell.confidenceScore),
    reason: buy.reason || sell.reason,
  };
}

function scanBuyReversal(candles: Candle[]): ReversalEvaluation {
  const currentIndex = candles.length - 1;
  const current = candles[currentIndex]!;
  const previous = candles[currentIndex - 1]!;
  const empty = emptyEvaluation(candles);

  const confirmationValid = isBuyConfirmation(current, previous);
  const confirmationStatus = confirmationValid
    ? 'Valid bullish confirmation candle'
    : 'Confirmation candle not valid';

  let best: ReversalEvaluation | null = null;

  if (!confirmationValid) {
    return {
      ...empty,
      confirmationStatus,
      stages: { ...empty.stages, confirmation: false },
      reason: 'BUY reversal: confirmation candle requirements not met',
    };
  }

  const start = Math.max(6, currentIndex - SCAN_LOOKBACK);

  for (let bosIndex = start; bosIndex < currentIndex; bosIndex += 1) {
    const historyToBos = candles.slice(0, bosIndex + 1);
    const bosCandle = candles[bosIndex]!;
    const swingHighsAtBos = detectSwingHighs(historyToBos);
    const swingLowsAtBos = detectSwingLows(historyToBos);

    if (swingHighsAtBos.length === 0 || swingLowsAtBos.length < 3) {
      continue;
    }

    const brokenHigh = swingHighsAtBos[swingHighsAtBos.length - 1]!;
    if (bosCandle.close <= brokenHigh.price) {
      continue;
    }

    const choch = findBullishChoch(swingLowsAtBos);
    if (!choch) {
      continue;
    }

    const trendAtBos = detectStructureTrend(swingHighsAtBos, swingLowsAtBos);
    const stageTrend = trendAtBos === 'Bearish' || hadBearishTrend(swingHighsAtBos, swingLowsAtBos);

    const weakeningIndex = Math.max(choch.index, bosIndex - 5);
    const weakening = evaluateBearishWeakening(candles, weakeningIndex, swingLowsAtBos);

    const retest = evaluateBuyRetest(candles, bosIndex, currentIndex, brokenHigh.price);
    if (!retest.valid) {
      continue;
    }

    const zoneLow = Math.min(choch.price, retest.zoneLow, bosCandle.low);
    const entryPrice = current.high + REVERSAL_MIN_TICK;
    const stopLoss = zoneLow - Math.max(entryPrice * 0.001, REVERSAL_MIN_TICK);
    const resistances = detectSwingHighs(candles)
      .slice(-5)
      .map((s) => s.price);
    const structuralTarget = nearestResistanceAbove(entryPrice, resistances);
    const targets = calculateRiskTargets({
      direction: 'BUY',
      entryPrice,
      stopLoss,
      structuralTarget,
    });

    const stages: ReversalStageStatus = {
      trend: stageTrend,
      weakening: weakening.passed,
      choch: true,
      bos: true,
      retest: retest.valid,
      confirmation: true,
    };
    const confidenceScore = scoreStages(stages);

    if (confidenceScore < 4) {
      continue;
    }

    const evaluation: ReversalEvaluation = {
      direction: 'BUY',
      marketTrend: trendAtBos,
      trendWeakeningStatus: weakening.label,
      chochStatus: `Higher Low @ ${choch.price.toFixed(2)} after final LL`,
      bosStatus: `BOS: closed above swing high ${brokenHigh.price.toFixed(2)}`,
      retestStatus: retest.label,
      confirmationStatus,
      stages,
      confidenceScore,
      entryPrice,
      stopLoss,
      target1: targets.target1,
      target2: targets.target2,
      target3: targets.target3,
      structuralTarget: targets.structuralTarget,
      riskRewardRatio: targets.riskRewardRatio,
      totalRisk: targets.risk,
      expectedReward: targets.expectedReward,
      signalType: 'BUY',
      reason: `BUY reversal ${confidenceScore}/6 — multi-stage confirmed`,
    };

    if (!best || evaluation.confidenceScore > best.confidenceScore) {
      best = evaluation;
    }
  }

  return (
    best ?? {
      ...empty,
      confirmationStatus,
      stages: {
        trend: false,
        weakening: false,
        choch: false,
        bos: false,
        retest: false,
        confirmation: true,
      },
      confidenceScore: confirmationValid ? 1 : 0,
      reason: 'BUY reversal: confirmation present but prior stages incomplete',
    }
  );
}

function scanSellReversal(candles: Candle[]): ReversalEvaluation {
  const currentIndex = candles.length - 1;
  const current = candles[currentIndex]!;
  const previous = candles[currentIndex - 1]!;
  const empty = emptyEvaluation(candles);

  const confirmationValid = isSellConfirmation(current, previous);
  const confirmationStatus = confirmationValid
    ? 'Valid bearish confirmation candle'
    : 'Confirmation candle not valid';

  if (!confirmationValid) {
    return {
      ...empty,
      confirmationStatus,
      stages: { ...empty.stages, confirmation: false },
      reason: 'SELL reversal: confirmation candle requirements not met',
    };
  }

  let best: ReversalEvaluation | null = null;
  const start = Math.max(6, currentIndex - SCAN_LOOKBACK);

  for (let bosIndex = start; bosIndex < currentIndex; bosIndex += 1) {
    const historyToBos = candles.slice(0, bosIndex + 1);
    const bosCandle = candles[bosIndex]!;
    const swingHighsAtBos = detectSwingHighs(historyToBos);
    const swingLowsAtBos = detectSwingLows(historyToBos);

    if (swingLowsAtBos.length === 0 || swingHighsAtBos.length < 3) {
      continue;
    }

    const brokenLow = swingLowsAtBos[swingLowsAtBos.length - 1]!;
    if (bosCandle.close >= brokenLow.price) {
      continue;
    }

    const choch = findBearishChoch(swingHighsAtBos);
    if (!choch) {
      continue;
    }

    const trendAtBos = detectStructureTrend(swingHighsAtBos, swingLowsAtBos);
    const stageTrend = trendAtBos === 'Bullish' || hadBullishTrend(swingHighsAtBos, swingLowsAtBos);

    const weakeningIndex = Math.max(choch.index, bosIndex - 5);
    const weakening = evaluateBullishWeakening(candles, weakeningIndex, swingHighsAtBos);

    const retest = evaluateSellRetest(candles, bosIndex, currentIndex, brokenLow.price);
    if (!retest.valid) {
      continue;
    }

    const zoneHigh = Math.max(choch.price, retest.zoneHigh, bosCandle.high);
    const entryPrice = current.low - REVERSAL_MIN_TICK;
    const stopLoss = zoneHigh + Math.max(entryPrice * 0.001, REVERSAL_MIN_TICK);
    const supports = detectSwingLows(candles)
      .slice(-5)
      .map((s) => s.price);
    const structuralTarget = nearestSupportBelow(entryPrice, supports);
    const targets = calculateRiskTargets({
      direction: 'SELL',
      entryPrice,
      stopLoss,
      structuralTarget,
    });

    const stages: ReversalStageStatus = {
      trend: stageTrend,
      weakening: weakening.passed,
      choch: true,
      bos: true,
      retest: retest.valid,
      confirmation: true,
    };
    const confidenceScore = scoreStages(stages);

    if (confidenceScore < 4) {
      continue;
    }

    const evaluation: ReversalEvaluation = {
      direction: 'SELL',
      marketTrend: trendAtBos,
      trendWeakeningStatus: weakening.label,
      chochStatus: `Lower High @ ${choch.price.toFixed(2)} after final HH`,
      bosStatus: `BOS: closed below swing low ${brokenLow.price.toFixed(2)}`,
      retestStatus: retest.label,
      confirmationStatus,
      stages,
      confidenceScore,
      entryPrice,
      stopLoss,
      target1: targets.target1,
      target2: targets.target2,
      target3: targets.target3,
      structuralTarget: targets.structuralTarget,
      riskRewardRatio: targets.riskRewardRatio,
      totalRisk: targets.risk,
      expectedReward: targets.expectedReward,
      signalType: 'SELL',
      reason: `SELL reversal ${confidenceScore}/6 — multi-stage confirmed`,
    };

    if (!best || evaluation.confidenceScore > best.confidenceScore) {
      best = evaluation;
    }
  }

  return (
    best ?? {
      ...empty,
      confirmationStatus,
      stages: {
        trend: false,
        weakening: false,
        choch: false,
        bos: false,
        retest: false,
        confirmation: true,
      },
      confidenceScore: confirmationValid ? 1 : 0,
      reason: 'SELL reversal: confirmation present but prior stages incomplete',
    }
  );
}

function isBuyConfirmation(current: Candle, previous: Candle): boolean {
  const range = candleRange(current);
  if (range <= 0) {
    return false;
  }
  const top30Threshold = current.low + range * 0.7;
  return (
    isBullishCandle(current) &&
    current.close > previous.high &&
    bodySize(current) > bodySize(previous) &&
    current.close >= top30Threshold
  );
}

function isSellConfirmation(current: Candle, previous: Candle): boolean {
  const range = candleRange(current);
  if (range <= 0) {
    return false;
  }
  const bottom30Threshold = current.high - range * 0.7;
  return (
    isBearishCandle(current) &&
    current.close < previous.low &&
    bodySize(current) > bodySize(previous) &&
    current.close <= bottom30Threshold
  );
}

function findBullishChoch(swingLows: SwingPoint[]): SwingPoint | null {
  if (swingLows.length < 3) {
    return null;
  }
  const finalLl = swingLows[swingLows.length - 2]!;
  const latest = swingLows[swingLows.length - 1]!;
  if (latest.price <= finalLl.price) {
    return null;
  }
  if (latest.price <= swingLows[swingLows.length - 3]!.price) {
    return null;
  }
  return latest;
}

function findBearishChoch(swingHighs: SwingPoint[]): SwingPoint | null {
  if (swingHighs.length < 3) {
    return null;
  }
  const finalHh = swingHighs[swingHighs.length - 2]!;
  const latest = swingHighs[swingHighs.length - 1]!;
  if (latest.price >= finalHh.price) {
    return null;
  }
  if (latest.price >= swingHighs[swingHighs.length - 3]!.price) {
    return null;
  }
  return latest;
}

function hadBearishTrend(swingHighs: SwingPoint[], swingLows: SwingPoint[]): boolean {
  if (swingHighs.length < 3 || swingLows.length < 3) {
    return false;
  }
  const highs = swingHighs.slice(-3);
  const lows = swingLows.slice(-3);
  return (
    highs[1]!.price < highs[0]!.price &&
    highs[2]!.price < highs[1]!.price &&
    lows[1]!.price < lows[0]!.price &&
    lows[2]!.price < lows[1]!.price
  );
}

function hadBullishTrend(swingHighs: SwingPoint[], swingLows: SwingPoint[]): boolean {
  if (swingHighs.length < 3 || swingLows.length < 3) {
    return false;
  }
  const highs = swingHighs.slice(-3);
  const lows = swingLows.slice(-3);
  return (
    highs[1]!.price > highs[0]!.price &&
    highs[2]!.price > highs[1]!.price &&
    lows[1]!.price > lows[0]!.price &&
    lows[2]!.price > lows[1]!.price
  );
}

function evaluateBearishWeakening(
  candles: Candle[],
  endIndex: number,
  swingLows: SwingPoint[],
): { passed: boolean; label: string } {
  let score = 0;
  const checks: string[] = [];

  if (swingLows.length >= 2) {
    const prev = swingLows[swingLows.length - 2]!;
    const latest = swingLows[swingLows.length - 1]!;
    if (latest.price < prev.price && (prev.price - latest.price) / prev.price <= SLIGHT_SWING_PCT) {
      score += 1;
      checks.push('Slight lower low');
    }
  }

  if (endIndex >= 2 && bodiesShrinking(candles, endIndex)) {
    score += 1;
    checks.push('Shrinking bodies (3 candles)');
  }

  const candle = candles[endIndex]!;
  if (candle.close >= midpoint(candle)) {
    score += 1;
    checks.push('Close in upper half');
  }

  const momentumNow = calculateMomentumScore(candles.slice(0, endIndex + 1));
  const momentumPrev = calculateMomentumScore(candles.slice(0, endIndex));
  if (momentumNow && momentumPrev && momentumNow.bullishScore > momentumPrev.bullishScore) {
    score += 1;
    checks.push('Momentum improving');
  }

  const passed = score >= 3;
  return {
    passed,
    label: passed ? `Bearish trend weakening (${score}/4)` : `Weakening not confirmed (${score}/4)`,
  };
}

function evaluateBullishWeakening(
  candles: Candle[],
  endIndex: number,
  swingHighs: SwingPoint[],
): { passed: boolean; label: string } {
  let score = 0;
  const checks: string[] = [];

  if (swingHighs.length >= 2) {
    const prev = swingHighs[swingHighs.length - 2]!;
    const latest = swingHighs[swingHighs.length - 1]!;
    if (latest.price > prev.price && (latest.price - prev.price) / prev.price <= SLIGHT_SWING_PCT) {
      score += 1;
      checks.push('Slight higher high');
    }
  }

  if (endIndex >= 2 && bodiesShrinking(candles, endIndex)) {
    score += 1;
    checks.push('Shrinking bodies (3 candles)');
  }

  const candle = candles[endIndex]!;
  if (candle.close <= midpoint(candle)) {
    score += 1;
    checks.push('Close in lower half');
  }

  const momentumNow = calculateMomentumScore(candles.slice(0, endIndex + 1));
  const momentumPrev = calculateMomentumScore(candles.slice(0, endIndex));
  if (momentumNow && momentumPrev && momentumNow.bullishScore < momentumPrev.bullishScore) {
    score += 1;
    checks.push('Momentum decreasing');
  }

  const passed = score >= 3;
  return {
    passed,
    label: passed ? `Bullish trend weakening (${score}/4)` : `Weakening not confirmed (${score}/4)`,
  };
}

function bodiesShrinking(candles: Candle[], endIndex: number): boolean {
  const sizes = [endIndex - 2, endIndex - 1, endIndex].map((i) => bodySize(candles[i]!));
  return sizes[0]! > sizes[1]! && sizes[1]! > sizes[2]!;
}

function evaluateBuyRetest(
  candles: Candle[],
  bosIndex: number,
  confirmationIndex: number,
  bosLevel: number,
): { valid: boolean; label: string; zoneLow: number } {
  let touched = false;
  let zoneLow = candles[bosIndex]!.low;
  let invalid = false;

  for (let i = bosIndex + 1; i < confirmationIndex; i += 1) {
    const candle = candles[i]!;
    zoneLow = Math.min(zoneLow, candle.low);
    if (candle.close < bosLevel) {
      invalid = true;
      break;
    }
    const dist = Math.abs(candle.low - bosLevel) / bosLevel;
    if (dist <= RETEST_TOLERANCE_PCT || candle.low <= bosLevel * (1 + RETEST_TOLERANCE_PCT)) {
      touched = true;
    }
  }

  const valid = touched && !invalid;
  return {
    valid,
    zoneLow,
    label: valid
      ? `Retest held above ${bosLevel.toFixed(2)}`
      : invalid
        ? 'Retest failed — closed below BOS level'
        : 'No retest of BOS level',
  };
}

function evaluateSellRetest(
  candles: Candle[],
  bosIndex: number,
  confirmationIndex: number,
  bosLevel: number,
): { valid: boolean; label: string; zoneHigh: number } {
  let touched = false;
  let zoneHigh = candles[bosIndex]!.high;
  let invalid = false;

  for (let i = bosIndex + 1; i < confirmationIndex; i += 1) {
    const candle = candles[i]!;
    zoneHigh = Math.max(zoneHigh, candle.high);
    if (candle.close > bosLevel) {
      invalid = true;
      break;
    }
    const dist = Math.abs(candle.high - bosLevel) / bosLevel;
    if (dist <= RETEST_TOLERANCE_PCT || candle.high >= bosLevel * (1 - RETEST_TOLERANCE_PCT)) {
      touched = true;
    }
  }

  const valid = touched && !invalid;
  return {
    valid,
    zoneHigh,
    label: valid
      ? `Retest held below ${bosLevel.toFixed(2)}`
      : invalid
        ? 'Retest failed — closed above BOS level'
        : 'No retest of BOS level',
  };
}

function scoreStages(stages: ReversalStageStatus): number {
  return Object.values(stages).filter(Boolean).length;
}

function mergeStages(a: ReversalStageStatus, b: ReversalStageStatus): ReversalStageStatus {
  return {
    trend: a.trend || b.trend,
    weakening: a.weakening || b.weakening,
    choch: a.choch || b.choch,
    bos: a.bos || b.bos,
    retest: a.retest || b.retest,
    confirmation: a.confirmation || b.confirmation,
  };
}

function emptyEvaluation(candles: Candle[]): ReversalEvaluation {
  const current = candles[candles.length - 1]!;
  const swingHighs = detectSwingHighs(candles);
  const swingLows = detectSwingLows(candles);
  const trend = detectStructureTrend(swingHighs, swingLows);
  const entryPrice = current.close;

  return {
    direction: null,
    marketTrend: trend,
    trendWeakeningStatus: 'Not detected',
    chochStatus: 'Not detected',
    bosStatus: 'Not detected',
    retestStatus: 'Not detected',
    confirmationStatus: 'Not detected',
    stages: {
      trend: trend !== 'Sideways',
      weakening: false,
      choch: false,
      bos: false,
      retest: false,
      confirmation: false,
    },
    confidenceScore: trend !== 'Sideways' ? 1 : 0,
    entryPrice,
    stopLoss: entryPrice * 0.995,
    target1: entryPrice,
    target2: entryPrice,
    target3: entryPrice,
    structuralTarget: null,
    riskRewardRatio: 0,
    totalRisk: 0,
    expectedReward: 0,
    signalType: 'NO_TRADE',
    reason: trend === 'Sideways' ? 'Sideways market — no reversal trade' : 'Reversal setup incomplete',
  };
}

export function confidenceLabel(score: number): string {
  if (score >= 6) {
    return 'Very Strong Reversal';
  }
  if (score === 5) {
    return 'Strong Reversal';
  }
  if (score === 4) {
    return 'Moderate Reversal';
  }
  return 'Insufficient confidence';
}

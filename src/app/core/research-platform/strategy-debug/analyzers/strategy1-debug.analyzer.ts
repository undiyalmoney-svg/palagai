import { Candle } from '../../../models/candle.model';
import { StrategyContext } from '../../../strategy-engine/models/strategy-context.model';
import {
  detectStructureTrend,
  detectSwingHighs,
  detectSwingLows,
  isBearishCandle,
  isBullishCandle,
  nearestResistanceAbove,
  nearestSupportBelow,
  safetyBuffer,
} from '../../../strategy-engine/utils/swing-level.util';
import { bodySize, candleRange } from '../../../strategy-engine/utils/ohlc-candle.util';
import {
  buildResistanceTrendline,
  buildSupportTrendline,
  detectTrendlineBreakout,
  detectTrendlineRetest,
  entryAboveHigh,
  entryBelowLow,
  trendlinePriceAtIndex,
} from '../../shared/trendline.util';
import { calcTargets } from '../../shared/research-signal.util';
import {
  CandleDebugRecord,
  DebugRuleCheck,
  ModuleKey,
  WaitingState,
} from '../models/strategy-research-debug.model';
import { RESEARCH_STRATEGY_IDS } from '../../interfaces/research-strategy.interface';
import { analyzeTrendFromCandles, emptyTrendDebug } from '../utils/debug-trend.util';
import { extractTradingDate } from '../../shared/research-signal.util';

const SCAN = 60;
const STRATEGY_NAME = 'Strategy 1 — Trendline Breakout + Retest';

export function analyzeStrategy1Candle(ctx: StrategyContext): Omit<CandleDebugRecord, 'tradeDetails' | 'openTradeActive'> {
  const candles60 = [...ctx.previous60m, ctx.candle60m];
  const candles30 = [...ctx.previous30m, ctx.candle30m];
  const candles5 = [...ctx.previous5m, ctx.candle5m];
  const current = ctx.candle5m;
  const previous = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
  const tradingDate = extractTradingDate(current.date);

  const swingHighs5 = detectSwingHighs(candles5);
  const swingLows5 = detectSwingLows(candles5);
  const trend5 = detectStructureTrend(swingHighs5, swingLows5);

  const trend =
    candles60.length >= 8
      ? analyzeTrendFromCandles(candles60, '60 Minute')
      : emptyTrendDebug('Insufficient 60m OHLC');

  const levels = detectSwingHighs(candles30).slice(-3).map((s) => s.price);
  const supports = detectSwingLows(candles30).slice(-3).map((s) => s.price);
  const nearestSupport = supports.length ? Math.max(...supports.filter((p) => p < current.close)) : null;
  const nearestResistance = levels.length ? Math.min(...levels.filter((p) => p > current.close)) : null;

  let structurePassed = false;
  let structureReason = 'No valid trendline structure';
  let trendline: string | null = null;
  let breakoutLevel: number | null = null;
  let retestLevel: number | null = null;
  const structureChecks: DebugRuleCheck[] = [];

  let breakoutPassed = false;
  let breakoutReason = 'No trendline breakout detected';
  const breakoutChecks: DebugRuleCheck[] = [];

  let retestPassed = false;
  let retestReason = 'Waiting for trendline retest';
  const retestChecks: DebugRuleCheck[] = [];

  let confirmationPassed = false;
  let confirmationReason = 'Confirmation candle not valid';
  const confirmationChecks: DebugRuleCheck[] = [];

  let entryPassed = false;
  let entryReason = 'Entry trigger not reached';
  const entryChecks: DebugRuleCheck[] = [];

  let waitingState: WaitingState = 'None';
  let finalDecision: 'BUY' | 'SELL' | 'NO_TRADE' = 'NO_TRADE';
  let blockingModule: ModuleKey | null = null;

  if (trend5 === 'Sideways') {
    trend.passed = false;
    trend.reason = '5m structure trend is Sideways';
  }

  if (!previous || candles5.length < 20) {
    return buildRecord({
      ctx,
      tradingDate,
      trend,
      structure: failStructure('Insufficient 5m history', nearestSupport, nearestResistance, swingHighs5, swingLows5),
      breakout: { passed: false, reason: 'Insufficient data', checks: [] },
      retest: { passed: false, reason: 'Insufficient data', checks: [] },
      confirmation: { passed: false, reason: 'Insufficient data', checks: [] },
      entry: { passed: false, reason: 'Insufficient data', entryTrigger: 'NOT REACHED', checks: [] },
      waitingState: 'None',
      finalDecision: 'NO_TRADE',
      rejectionReason: 'Insufficient 5m OHLC history',
      blockingModule: 'trend',
    });
  }

  const currentIndex = candles5.length - 1;

  if (trend5 === 'Bullish') {
    const line = buildSupportTrendline(swingLows5);
    trendline = line ? `Support slope ${line.slope.toFixed(4)}, intercept ${line.intercept.toFixed(2)}` : null;

    let breakoutIndex = -1;
    if (line) {
      for (let i = Math.max(10, currentIndex - SCAN); i < currentIndex; i += 1) {
        if (detectTrendlineBreakout(candles5[i]!, i, line)) {
          breakoutIndex = i;
          breakoutLevel = candles5[i]!.high;
          break;
        }
      }
    }

    breakoutPassed = breakoutIndex >= 0;
    breakoutReason = breakoutPassed
      ? `Breakout at index ${breakoutIndex}, level ${breakoutLevel?.toFixed(2)}`
      : 'No trendline breakout detected';
    breakoutChecks.push({
      name: 'Trendline Breakout',
      passed: breakoutPassed,
      reason: breakoutReason,
      expected: 'Price breaks above support trendline',
      actual: breakoutPassed ? 'YES' : 'NO',
    });

    if (breakoutPassed) {
      for (let i = breakoutIndex + 1; i < currentIndex; i += 1) {
        if (line && detectTrendlineRetest(candles5[i]!, i, line)) {
          retestPassed = true;
          retestLevel = trendlinePriceAtIndex(line, i);
          break;
        }
      }
    }
    retestReason = retestPassed
      ? `Retest held at ${retestLevel?.toFixed(2)}`
      : breakoutPassed
        ? 'Waiting for trendline retest'
        : 'Breakout required before retest';
    retestChecks.push({
      name: 'Trendline Retest',
      passed: retestPassed,
      reason: retestReason,
      expected: 'Price retests trendline and holds',
      actual: retestPassed ? 'PASS' : 'FAIL',
    });

    const bullish = isStrongBullish(current, previous);
    confirmationPassed = bullish;
    confirmationReason = bullish ? 'Strong bullish confirmation candle' : 'Confirmation candle not valid';
    confirmationChecks.push(
      { name: 'Bullish Candle', passed: isBullishCandle(current), reason: isBullishCandle(current) ? 'PASS' : 'FAIL' },
      { name: 'Body Size', passed: bodySize(current) > bodySize(previous), reason: `Body ${bodySize(current).toFixed(2)} vs prev ${bodySize(previous).toFixed(2)}` },
      { name: 'Close in upper 60%', passed: bullish, reason: bullish ? 'PASS' : 'FAIL' },
    );

    if (bullish && retestPassed) {
      const entryPrice = entryAboveHigh(current);
      const stopLoss = current.low - safetyBuffer(entryPrice);
      const structural = nearestResistanceAbove(entryPrice, swingHighs5.slice(-5).map((s) => s.price));
      const { riskRewardRatio } = calcTargets({ direction: 'BUY', entryPrice, stopLoss, structuralTarget: structural });
      entryPassed = riskRewardRatio >= 2;
      entryReason = entryPassed ? `R:R ${riskRewardRatio.toFixed(2)}` : `Risk reward ${riskRewardRatio.toFixed(2)} below 1:2`;
      entryChecks.push({ name: 'Risk Reward >= 2', passed: entryPassed, reason: entryReason });
      if (entryPassed) {
        finalDecision = 'BUY';
      }
    }

    structurePassed = line !== null && trend5 === 'Bullish';
    structureReason = structurePassed ? 'Support trendline valid for bullish setup' : 'No valid support trendline';
    structureChecks.push({ name: 'Support Trendline', passed: line !== null, reason: structureReason });
  } else if (trend5 === 'Bearish') {
    const line = buildResistanceTrendline(swingHighs5);
    trendline = line ? `Resistance slope ${line.slope.toFixed(4)}, intercept ${line.intercept.toFixed(2)}` : null;

    let breakoutIndex = -1;
    if (line) {
      for (let i = Math.max(10, currentIndex - SCAN); i < currentIndex; i += 1) {
        if (detectTrendlineBreakout(candles5[i]!, i, line)) {
          breakoutIndex = i;
          breakoutLevel = candles5[i]!.low;
          break;
        }
      }
    }

    breakoutPassed = breakoutIndex >= 0;
    breakoutReason = breakoutPassed ? `Breakdown at index ${breakoutIndex}` : 'No trendline breakout detected';
    breakoutChecks.push({ name: 'Trendline Breakout', passed: breakoutPassed, reason: breakoutReason });

    if (breakoutPassed && line) {
      for (let i = breakoutIndex + 1; i < currentIndex; i += 1) {
        if (detectTrendlineRetest(candles5[i]!, i, line)) {
          retestPassed = true;
          retestLevel = trendlinePriceAtIndex(line, i);
          break;
        }
      }
    }
    retestReason = retestPassed ? `Retest held at ${retestLevel?.toFixed(2)}` : 'Waiting for trendline retest';

    const bearish = isStrongBearish(current, previous);
    confirmationPassed = bearish;
    confirmationReason = bearish ? 'Strong bearish confirmation' : 'Confirmation candle not valid';
    confirmationChecks.push(
      { name: 'Bearish Candle', passed: isBearishCandle(current), reason: isBearishCandle(current) ? 'PASS' : 'FAIL' },
      { name: 'Body Size', passed: bodySize(current) > bodySize(previous), reason: `Body ${bodySize(current).toFixed(2)}` },
    );

    if (bearish && retestPassed) {
      const entryPrice = entryBelowLow(current);
      const stopLoss = current.high + safetyBuffer(entryPrice);
      const structural = nearestSupportBelow(entryPrice, swingLows5.slice(-5).map((s) => s.price));
      const { riskRewardRatio } = calcTargets({ direction: 'SELL', entryPrice, stopLoss, structuralTarget: structural });
      entryPassed = riskRewardRatio >= 2;
      entryReason = entryPassed ? `R:R ${riskRewardRatio.toFixed(2)}` : `Risk reward below 1:2`;
      if (entryPassed) {
        finalDecision = 'SELL';
      }
    }

    structurePassed = line !== null;
    structureReason = structurePassed ? 'Resistance trendline valid' : 'No valid resistance trendline';
  } else {
    structureReason = 'Sideways 5m structure — no trendline setup';
  }

  if (finalDecision === 'NO_TRADE') {
    if (!breakoutPassed) {
      waitingState = 'Waiting for Breakout';
      blockingModule = 'breakout';
    } else if (!retestPassed) {
      waitingState = 'Waiting for Retest';
      blockingModule = 'retest';
    } else if (!confirmationPassed) {
      waitingState = 'Waiting for Confirmation';
      blockingModule = 'confirmation';
    } else if (!entryPassed) {
      waitingState = 'Waiting for Entry Trigger';
      blockingModule = 'entry';
    } else if (!trend.passed) {
      blockingModule = 'trend';
    } else if (!structurePassed) {
      blockingModule = 'structure';
    }
  }

  const rejectionReason =
    finalDecision === 'NO_TRADE'
      ? waitingState !== 'None'
        ? waitingState
        : blockingModule === 'trend'
          ? trend.reason
          : structureReason
      : 'All conditions passed';

  return buildRecord({
    ctx,
    tradingDate,
    trend,
    structure: {
      passed: structurePassed,
      reason: structureReason,
      support: nearestSupport,
      resistance: nearestResistance,
      swingHighs: swingHighs5.slice(-5).map((s) => s.price),
      swingLows: swingLows5.slice(-5).map((s) => s.price),
      trendline,
      breakoutLevel,
      retestLevel,
      distanceFromSupport: nearestSupport !== null ? current.close - nearestSupport : null,
      distanceFromResistance: nearestResistance !== null ? nearestResistance - current.close : null,
      expectedCondition: trend5 === 'Bullish' ? 'Support trendline breakout + retest' : 'Resistance trendline breakout + retest',
      actualCondition: structureReason,
      checks: structureChecks,
    },
    breakout: { passed: breakoutPassed, reason: breakoutReason, checks: breakoutChecks },
    retest: { passed: retestPassed, reason: retestReason, checks: retestChecks },
    confirmation: { passed: confirmationPassed, reason: confirmationReason, checks: confirmationChecks },
    entry: {
      passed: entryPassed,
      reason: entryReason,
      entryTrigger: entryPassed ? 'REACHED' : 'NOT REACHED',
      checks: entryChecks,
    },
    waitingState,
    finalDecision,
    rejectionReason,
    blockingModule,
  });
}

function isStrongBullish(current: Candle, previous: Candle): boolean {
  const range = candleRange(current);
  return (
    isBullishCandle(current) &&
    bodySize(current) > bodySize(previous) &&
    range > 0 &&
    current.close >= current.low + range * 0.6
  );
}

function isStrongBearish(current: Candle, previous: Candle): boolean {
  const range = candleRange(current);
  return (
    isBearishCandle(current) &&
    bodySize(current) > bodySize(previous) &&
    range > 0 &&
    current.close <= current.high - range * 0.6
  );
}

function failStructure(
  reason: string,
  support: number | null,
  resistance: number | null,
  highs: ReturnType<typeof detectSwingHighs>,
  lows: ReturnType<typeof detectSwingLows>,
) {
  return {
    passed: false,
    reason,
    support,
    resistance,
    swingHighs: highs.slice(-5).map((s) => s.price),
    swingLows: lows.slice(-5).map((s) => s.price),
    trendline: null,
    breakoutLevel: null,
    retestLevel: null,
    distanceFromSupport: null,
    distanceFromResistance: null,
    expectedCondition: 'Valid structure',
    actualCondition: reason,
    checks: [],
  };
}

function buildRecord(
  params: Omit<CandleDebugRecord, 'tradeDetails' | 'openTradeActive' | 'strategyId' | 'strategyName' | 'timestamp' | 'pullback' | 'strategy3Details'> & {
    ctx: StrategyContext;
    tradingDate: string;
  },
): Omit<CandleDebugRecord, 'tradeDetails' | 'openTradeActive'> {
  return {
    timestamp: params.ctx.candle5m.date,
    tradingDate: params.tradingDate,
    strategyId: RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT,
    strategyName: STRATEGY_NAME,
    trend: params.trend,
    structure: params.structure,
    pullback: { passed: true, reason: 'Not used in Strategy 1', checks: [] },
    breakout: params.breakout,
    retest: params.retest,
    confirmation: params.confirmation,
    entry: params.entry,
    waitingState: params.waitingState,
    finalDecision: params.finalDecision,
    rejectionReason: params.rejectionReason,
    blockingModule: params.blockingModule,
  };
}

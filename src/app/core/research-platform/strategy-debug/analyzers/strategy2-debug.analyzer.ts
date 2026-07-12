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
  withinPullbackTolerance,
} from '../../../strategy-engine/utils/swing-level.util';
import { bodySize, trend30m } from '../../../strategy-engine/utils/ohlc-candle.util';
import { ResearchStrategyResult } from '../../interfaces/research-strategy.interface';
import { calcTargets, extractTradingDate } from '../../shared/research-signal.util';
import { RESEARCH_STRATEGY_IDS } from '../../interfaces/research-strategy.interface';
import {
  CandleDebugRecord,
  DebugRuleCheck,
  ModuleKey,
  Strategy2AuditDetail,
  WaitingState,
} from '../models/strategy-research-debug.model';

const STRATEGY_NAME = 'Strategy 2 — Multi Timeframe Pullback';
const PULLBACK_TOLERANCE_PCT = 0.002;

export function analyzeStrategy2Candle(
  ctx: StrategyContext,
  evaluatorResult: ResearchStrategyResult,
): Omit<CandleDebugRecord, 'tradeDetails' | 'openTradeActive'> {
  const candles60 = [...ctx.previous60m, ctx.candle60m];
  const candles30 = [...ctx.previous30m, ctx.candle30m];
  const candles15 = [...ctx.previous15m, ctx.candle15m];
  const candles5 = [...ctx.previous5m, ctx.candle5m];
  const current5 = ctx.candle5m;
  const previous5 = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
  const tradingDate = extractTradingDate(current5.date);

  const swingHighs60 = detectSwingHighs(candles60);
  const swingLows60 = detectSwingLows(candles60);
  const trend60 = detectStructureTrend(swingHighs60, swingLows60);
  const trend30Result = trend30m(candles30);
  const support30 = detectSwingLows(candles30).at(-1)?.price ?? null;
  const resistance30 = detectSwingHighs(candles30).at(-1)?.price ?? null;

  const trendChecks: DebugRuleCheck[] = [
    {
      name: '60m Trend',
      passed: trend60 !== 'Sideways',
      reason: `Detected ${trend60}`,
      expected: 'Bullish or Bearish',
      actual: trend60,
    },
    {
      name: '60m Swing Highs (last 3)',
      passed: swingHighs60.length >= 3,
      reason: swingHighs60
        .slice(-3)
        .map((s) => s.price.toFixed(2))
        .join(', ') || 'none',
      actual: String(swingHighs60.length),
    },
    {
      name: '60m Swing Lows (last 3)',
      passed: swingLows60.length >= 3,
      reason: swingLows60
        .slice(-3)
        .map((s) => s.price.toFixed(2))
        .join(', ') || 'none',
      actual: String(swingLows60.length),
    },
  ];

  const c30 = candles30.length >= 1 ? candles30[candles30.length - 1]! : null;
  const p30 = candles30.length >= 2 ? candles30[candles30.length - 2]! : null;

  let structurePassed = false;
  let structureReason = '30m does not confirm 60m trend';
  const structureChecks: DebugRuleCheck[] = [
    {
      name: '30m Trend Signal',
      passed: trend30Result.trend !== 'NEUTRAL',
      reason: trend30Result.reason,
      expected: trend60 === 'Bullish' ? 'BUY' : trend60 === 'Bearish' ? 'SELL' : 'N/A',
      actual: trend30Result.trend,
    },
  ];

  if (c30 && p30) {
    structureChecks.push(
      {
        name: '30m H > prev H',
        passed: c30.high > p30.high,
        expected: 'true for BUY',
        actual: String(c30.high > p30.high),
        reason: `${c30.high.toFixed(2)} vs ${p30.high.toFixed(2)}`,
      },
      {
        name: '30m L > prev L',
        passed: c30.low > p30.low,
        expected: 'true for BUY',
        actual: String(c30.low > p30.low),
        reason: `${c30.low.toFixed(2)} vs ${p30.low.toFixed(2)}`,
      },
      {
        name: '30m C > prev H (bullish)',
        passed: c30.close > p30.high,
        expected: 'true for BUY',
        actual: String(c30.close > p30.high),
        reason: `${c30.close.toFixed(2)} vs ${p30.high.toFixed(2)}`,
      },
    );
  }

  if (trend60 === 'Bullish' && trend30Result.trend === 'BUY') {
    structurePassed = support30 !== null;
    structureReason = structurePassed
      ? `30m support at ${support30!.toFixed(2)}`
      : 'No 30m support identified';
    structureChecks.push({
      name: '30m Support Level',
      passed: support30 !== null,
      reason: support30 !== null ? `Support ${support30.toFixed(2)}` : 'No swing low',
      expected: 'Latest 30m swing low',
      actual: support30?.toFixed(2) ?? 'null',
    });
  } else if (trend60 === 'Bearish' && trend30Result.trend === 'SELL') {
    structurePassed = resistance30 !== null;
    structureReason = structurePassed
      ? `30m resistance at ${resistance30!.toFixed(2)}`
      : 'No 30m resistance identified';
    structureChecks.push({
      name: '30m Resistance Level',
      passed: resistance30 !== null,
      reason: resistance30 !== null ? `Resistance ${resistance30.toFixed(2)}` : 'No swing high',
      expected: 'Latest 30m swing high',
      actual: resistance30?.toFixed(2) ?? 'null',
    });
  } else if (trend60 === 'Sideways') {
    structureReason = '60m trend sideways';
  }

  let pullbackLevel: number | null = null;
  let pullbackSide: 'support' | 'resistance' | null = null;
  if (trend60 === 'Bullish') {
    pullbackLevel = support30;
    pullbackSide = 'support';
  } else if (trend60 === 'Bearish') {
    pullbackLevel = resistance30;
    pullbackSide = 'resistance';
  }

  const pullbackWindow = buildPullbackWindow(candles15, pullbackLevel, pullbackSide);
  const pullbackPassed = pullbackWindow.some((w) => w.touchesLevel);
  const pullbackReason = pullbackPassed
    ? `15m touched ${pullbackSide} level ${pullbackLevel?.toFixed(2)} (tol ${PULLBACK_TOLERANCE_PCT * 100}%)`
    : pullbackLevel !== null
      ? `No 15m candle within tolerance of ${pullbackLevel.toFixed(2)}`
      : 'No S/R level for pullback check';

  const pullbackChecks: DebugRuleCheck[] = pullbackWindow.map((w) => ({
    name: `15m ${w.date.slice(11, 16)}`,
    passed: w.touchesLevel,
    reason: w.touchesLevel ? 'TOUCH' : `dist ${w.distancePct.toFixed(3)}%`,
    expected: `Within ${PULLBACK_TOLERANCE_PCT * 100}% of ${pullbackLevel?.toFixed(2)}`,
    actual: w.touchesLevel ? 'PASS' : 'FAIL',
  }));

  let confirmationPassed = false;
  let confirmationReason = 'Waiting for 5m confirmation';
  const confirmationChecks: DebugRuleCheck[] = [];
  let confirmation5m: Strategy2AuditDetail['confirmation5m'] = null;

  if (previous5) {
    const isBull = isBullishCandle(current5);
    const isBear = isBearishCandle(current5);
    const curBody = bodySize(current5);
    const prevBody = bodySize(previous5);
    const bodyOk = curBody > prevBody;

    if (trend60 === 'Bullish') {
      confirmationPassed = isBull && bodyOk;
      confirmationReason = confirmationPassed
        ? '5m bullish + body > previous'
        : !isBull
          ? '5m not bullish'
          : '5m body not larger than previous';
    } else if (trend60 === 'Bearish') {
      confirmationPassed = isBear && bodyOk;
      confirmationReason = confirmationPassed
        ? '5m bearish + body > previous'
        : !isBear
          ? '5m not bearish'
          : '5m body not larger than previous';
    }

    confirmationChecks.push(
      { name: '5m Bullish Candle', passed: isBull, reason: `O=${current5.open} C=${current5.close}`, actual: isBull ? 'YES' : 'NO' },
      { name: '5m Bearish Candle', passed: isBear, reason: `O=${current5.open} C=${current5.close}`, actual: isBear ? 'YES' : 'NO' },
      { name: '5m Body Size', passed: bodyOk, reason: `${curBody.toFixed(2)} vs prev ${prevBody.toFixed(2)}`, actual: bodyOk ? 'PASS' : 'FAIL' },
    );

    confirmation5m = {
      isBullish: isBull,
      isBearish: isBear,
      bodySize: curBody,
      prevBodySize: prevBody,
      passed: confirmationPassed,
    };
  }

  let entryPassed = false;
  let entryReason = 'Entry / R:R not reached';
  let riskRewardRatio: number | null = null;
  const entryChecks: DebugRuleCheck[] = [];

  if (trend60 === 'Bullish' && pullbackPassed && confirmationPassed && previous5 && support30 !== null) {
    const pullback15 = detectPullbackToLevel(candles15, support30, 'support');
    const entryPrice = current5.high + 0.05;
    const stopLoss = (pullback15?.low ?? current5.low) - safetyBuffer(entryPrice);
    const structural = nearestResistanceAbove(
      entryPrice,
      detectSwingHighs(candles5)
        .slice(-5)
        .map((s) => s.price),
    );
    const targets = calcTargets({ direction: 'BUY', entryPrice, stopLoss, structuralTarget: structural });
    riskRewardRatio = targets.riskRewardRatio;
    entryPassed = riskRewardRatio >= 2;
    entryReason = entryPassed ? `R:R ${riskRewardRatio.toFixed(2)}` : `R:R ${riskRewardRatio.toFixed(2)} < 2`;
    entryChecks.push(
      { name: 'Entry Price', passed: true, reason: entryPrice.toFixed(2), actual: entryPrice.toFixed(2) },
      { name: 'Stop Loss', passed: true, reason: stopLoss.toFixed(2), actual: stopLoss.toFixed(2) },
      { name: 'Risk Reward >= 2', passed: entryPassed, reason: entryReason, expected: '>= 2', actual: riskRewardRatio.toFixed(2) },
    );
  } else if (trend60 === 'Bearish' && pullbackPassed && confirmationPassed && previous5 && resistance30 !== null) {
    const pullback15 = detectPullbackToLevel(candles15, resistance30, 'resistance');
    const entryPrice = current5.low - 0.05;
    const stopLoss = (pullback15?.high ?? current5.high) + safetyBuffer(entryPrice);
    const structural = nearestSupportBelow(
      entryPrice,
      detectSwingLows(candles5)
        .slice(-5)
        .map((s) => s.price),
    );
    const targets = calcTargets({ direction: 'SELL', entryPrice, stopLoss, structuralTarget: structural });
    riskRewardRatio = targets.riskRewardRatio;
    entryPassed = riskRewardRatio >= 2;
    entryReason = entryPassed ? `R:R ${riskRewardRatio.toFixed(2)}` : `R:R ${riskRewardRatio.toFixed(2)} < 2`;
    entryChecks.push(
      { name: 'Risk Reward >= 2', passed: entryPassed, reason: entryReason, expected: '>= 2', actual: riskRewardRatio.toFixed(2) },
    );
  }

  const debugDecision: 'BUY' | 'SELL' | 'NO_TRADE' = entryPassed
    ? trend60 === 'Bullish'
      ? 'BUY'
      : 'SELL'
    : 'NO_TRADE';
  const evaluatorAction = evaluatorResult.action;
  const debugMatchesEvaluator = debugDecision === evaluatorAction;
  let mismatchNote: string | null = null;
  if (!debugMatchesEvaluator) {
    mismatchNote = `Debug inferred ${debugDecision} but evaluator returned ${evaluatorAction}: ${evaluatorResult.reason}`;
  }

  let waitingState: WaitingState = 'None';
  let blockingModule: ModuleKey | null = null;

  if (evaluatorAction === 'NO_TRADE') {
    if (trend60 === 'Sideways') {
      blockingModule = 'trend';
    } else if (!structurePassed) {
      blockingModule = 'structure';
    } else if (!pullbackPassed) {
      waitingState = 'Waiting for Pullback';
      blockingModule = 'pullback';
    } else if (!confirmationPassed) {
      waitingState = 'Waiting for Confirmation';
      blockingModule = 'confirmation';
    } else if (!entryPassed) {
      waitingState = 'Waiting for Entry Trigger';
      blockingModule = 'entry';
    } else {
      blockingModule = 'entry';
    }
  }

  const strategy2Audit: Strategy2AuditDetail = {
    trend60,
    trend60SwingHighs: swingHighs60.slice(-3).map((s) => s.price),
    trend60SwingLows: swingLows60.slice(-3).map((s) => s.price),
    trend30: trend30Result.trend,
    trend30Reason: trend30Result.reason,
    trend30Current: c30 ? { high: c30.high, low: c30.low, close: c30.close } : null,
    trend30Previous: p30 ? { high: p30.high, low: p30.low, close: p30.close } : null,
    support30,
    resistance30,
    pullbackLevel,
    pullbackSide,
    pullbackWindow,
    pullbackDetected: pullbackPassed,
    confirmation5m,
    riskRewardRatio,
    evaluatorAction,
    evaluatorReason: evaluatorResult.reason,
    debugMatchesEvaluator,
    mismatchNote,
  };

  return {
    timestamp: current5.date,
    tradingDate,
    strategyId: RESEARCH_STRATEGY_IDS.MTF_PULLBACK,
    strategyName: STRATEGY_NAME,
    trend: {
      passed: trend60 !== 'Sideways',
      detectedTrend: trend60,
      requiredCondition: '60m structure trend Bullish or Bearish',
      actualResult: `Trend=${trend60}, highs=[${strategy2Audit.trend60SwingHighs.join(', ')}], lows=[${strategy2Audit.trend60SwingLows.join(', ')}]`,
      reason: trend60 === 'Sideways' ? '60m trend sideways' : `60m trend ${trend60}`,
      latestSwingHighs: swingHighs60.slice(-5).map((s) => s.price),
      latestSwingLows: swingLows60.slice(-5).map((s) => s.price),
      higherHighCount: 0,
      higherLowCount: 0,
      lowerHighCount: 0,
      lowerLowCount: 0,
      checks: trendChecks,
    },
    structure: {
      passed: structurePassed,
      reason: structureReason,
      support: support30,
      resistance: resistance30,
      swingHighs: detectSwingHighs(candles30).slice(-5).map((s) => s.price),
      swingLows: detectSwingLows(candles30).slice(-5).map((s) => s.price),
      trendline: null,
      breakoutLevel: null,
      retestLevel: null,
      distanceFromSupport: support30 !== null ? current5.close - support30 : null,
      distanceFromResistance: resistance30 !== null ? resistance30 - current5.close : null,
      expectedCondition: '30m confirms 60m with S/R',
      actualCondition: structureReason,
      checks: structureChecks,
    },
    pullback: { passed: pullbackPassed, reason: pullbackReason, checks: pullbackChecks },
    breakout: { passed: true, reason: 'Not used in Strategy 2', checks: [] },
    retest: { passed: true, reason: 'Not used in Strategy 2', checks: [] },
    confirmation: { passed: confirmationPassed, reason: confirmationReason, checks: confirmationChecks },
    entry: {
      passed: entryPassed,
      reason: entryReason,
      entryTrigger: entryPassed ? 'REACHED' : 'NOT REACHED',
      checks: entryChecks,
    },
    waitingState,
    finalDecision: evaluatorAction,
    rejectionReason: evaluatorAction === 'NO_TRADE' ? evaluatorResult.reason : 'All conditions passed',
    blockingModule,
    strategy2Audit,
  };
}

function buildPullbackWindow(
  candles15: Candle[],
  level: number | null,
  side: 'support' | 'resistance' | null,
) {
  if (level === null || !side) {
    return [];
  }
  return candles15.slice(-8).map((c) => {
    const price = side === 'support' ? c.low : c.high;
    const distancePct = (Math.abs(price - level) / level) * 100;
    return {
      date: c.date,
      low: c.low,
      high: c.high,
      touchesLevel: withinPullbackTolerance(price, level),
      distancePct,
    };
  });
}

function detectPullbackToLevel(
  candles15: Candle[],
  level: number,
  side: 'support' | 'resistance',
): { low: number; high: number } | null {
  const window = candles15.slice(-8);
  if (window.length < 3) {
    return null;
  }
  const touched = window.some((c) =>
    side === 'support'
      ? withinPullbackTolerance(c.low, level)
      : withinPullbackTolerance(c.high, level),
  );
  if (!touched) {
    return null;
  }
  return {
    low: Math.min(...window.map((c) => c.low)),
    high: Math.max(...window.map((c) => c.high)),
  };
}

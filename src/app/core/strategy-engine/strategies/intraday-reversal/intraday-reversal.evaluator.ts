import { StrategyContext } from '../../models/strategy-context.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { extractHhMm, resolveSessionFromContext } from '../../utils/market-session.util';
import { NSE_SESSION } from '../../../config/session.config';
import { MarketRegime } from '../../utils/market-regime.util';
import {
  confidenceLabel,
  evaluateReversalSetup,
  ReversalEvaluation,
} from '../../utils/reversal-detection.util';
import {
  calculateEntryQualityScore,
  passesEntryQuality,
  EntryQualityBreakdown,
} from '../../utils/entry-quality-score.util';
import { buildSignalDebug } from '../../utils/signal-debug.util';
import { bodyStrengthPct } from '../../utils/ohlc-candle.util';

/** Minimum stage score (out of 6) for a full reversal entry. */
export const INTRADAY_REVERSAL_MIN_CONFIDENCE = 4;

/** No new entries before this time. */
export const INTRADAY_REVERSAL_FIRST_ENTRY = '10:00';

/** No new trades after this time — still hold until session close. */
export const INTRADAY_REVERSAL_LAST_ENTRY = NSE_SESSION.lastEntryTime;

/** Cooldown in 5m candles after a signal to avoid duplicate entries. */
export const INTRADAY_REVERSAL_COOLDOWN_CANDLES = 6;

export type IntradayReversalSignalAction = 'BUY' | 'SELL' | 'NO_TRADE' | 'WAITING' | 'SKIPPED';

export interface IntradayReversalResult {
  action: IntradayReversalSignalAction;
  entryPrice: number;
  stopLoss: number;
  target: number;
  riskRewardRatio: number;
  reason: string;
  analysis: Record<string, unknown>;
}

export interface IntradayReversalState {
  tradingDate: string | null;
  cooldownUntilStep: number;
  lastClosedDirection: 'BUY' | 'SELL' | null;
}

export function createIntradayReversalState(): IntradayReversalState {
  return { tradingDate: null, cooldownUntilStep: -1, lastClosedDirection: null };
}

export function runIntradayReversal(
  ctx: StrategyContext,
  state: IntradayReversalState,
  marketRegime: MarketRegime = 'UNKNOWN',
): IntradayReversalResult {
  const current5 = ctx.candle5m;
  const tradingDate = extractTradeDate(current5.date);
  const session = resolveSessionFromContext(ctx);
  const time = extractHhMm(current5.date, session.timezone);

  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.cooldownUntilStep = -1;
    state.lastClosedDirection = null;
  }

  const baseAnalysis = {
    tradingDate,
    time,
    marketRegime,
    strategy: 'Intraday Reversal',
  };

  if (marketRegime !== 'RANGING') {
    return skipped(
      current5,
      `Strategy inactive — requires RANGING regime (current: ${marketRegime})`,
      baseAnalysis,
      marketRegime,
    );
  }

  if (ctx.replayStepIndex <= state.cooldownUntilStep) {
    return waiting(current5, 'Cooldown after recent reversal signal', {
      ...baseAnalysis,
      currentStep: 'Cooldown',
      blockingRule: 'Post-signal cooldown active',
      nextConditionRequired: `${state.cooldownUntilStep - ctx.replayStepIndex + 1} candles remaining`,
    });
  }

  if (time < session.marketOpen) {
    return waiting(current5, 'Before market open', {
      ...baseAnalysis,
      currentStep: 'Session',
      nextConditionRequired: `Market open at ${session.marketOpen}`,
    });
  }

  if (time < INTRADAY_REVERSAL_FIRST_ENTRY) {
    return waiting(current5, 'Reversal entries not allowed before 10:00 AM', {
      ...baseAnalysis,
      currentStep: 'Time Filter',
      blockingRule: 'Before 10:00 entry window',
      expectedValue: `≥ ${INTRADAY_REVERSAL_FIRST_ENTRY}`,
      actualValue: time,
      nextConditionRequired: 'Wait until 10:00 AM',
    });
  }

  if (time > session.lastEntryTime) {
    return waiting(current5, `Past last entry window (${session.lastEntryTime})`, {
      ...baseAnalysis,
      currentStep: 'Time Filter',
      blockingRule: `No new entries after ${session.lastEntryTime}`,
      expectedValue: `≤ ${session.lastEntryTime}`,
      actualValue: time,
    });
  }

  const candles5m = [...ctx.previous5m, current5];
  if (candles5m.length < 12) {
    return waiting(current5, 'Insufficient 5m candles for reversal scan', {
      ...baseAnalysis,
      currentStep: 'Data',
      nextConditionRequired: 'At least 12 completed 5m candles',
    });
  }

  const evaluation = evaluateReversalSetup(candles5m);
  const stageAnalysis = buildAnalysis(evaluation, tradingDate, time, marketRegime);

  const trendExhaustion = evaluation.stages.weakening && evaluation.stages.trend;
  const structureShift = evaluation.stages.choch && evaluation.stages.bos;
  const hasConfirmation = evaluation.stages.confirmation;

  if (!trendExhaustion) {
    return waiting(current5, 'Trend exhaustion not detected', {
      ...stageAnalysis,
      currentStep: 'Trend Exhaustion',
      blockingRule: 'Weakening trend required',
      nextConditionRequired: 'Prior trend with momentum fade',
    });
  }

  if (!structureShift) {
    return waiting(current5, 'Structure shift incomplete (CHoCH + BOS required)', {
      ...stageAnalysis,
      currentStep: 'Structure Shift',
      blockingRule: 'CHoCH and BOS both required',
      expectedValue: 'CHoCH + BOS',
      actualValue: `CHoCH: ${evaluation.stages.choch}, BOS: ${evaluation.stages.bos}`,
      nextConditionRequired: 'Change of character and break of structure',
    });
  }

  if (!hasConfirmation) {
    return waiting(current5, 'Confirmation candle not valid', {
      ...stageAnalysis,
      currentStep: 'Confirmation Candle',
      blockingRule: evaluation.confirmationStatus,
      nextConditionRequired: 'Strong confirmation candle',
    });
  }

  if (evaluation.signalType === 'NO_TRADE' || evaluation.confidenceScore < INTRADAY_REVERSAL_MIN_CONFIDENCE) {
    return waiting(current5, evaluation.reason, {
      ...stageAnalysis,
      currentStep: 'Confidence',
      blockingRule: 'Confidence below threshold',
      expectedValue: `≥ ${INTRADAY_REVERSAL_MIN_CONFIDENCE}/6`,
      actualValue: `${evaluation.confidenceScore}/6`,
      nextConditionRequired: 'Higher stage confidence score',
    });
  }

  if (evaluation.riskRewardRatio < 1.5) {
    return waiting(current5, `Risk/reward too low (${evaluation.riskRewardRatio.toFixed(2)})`, {
      ...stageAnalysis,
      currentStep: 'Risk Reward',
      blockingRule: 'RR below minimum',
      expectedValue: '≥ 1.5',
      actualValue: evaluation.riskRewardRatio.toFixed(2),
      minRrRequired: 1.5,
    });
  }

  if (
    state.lastClosedDirection === evaluation.signalType &&
    ctx.replayStepIndex <= state.cooldownUntilStep
  ) {
    return waiting(current5, 'Duplicate direction — fresh setup required', {
      ...stageAnalysis,
      currentStep: 'Duplicate Guard',
      blockingRule: 'Same direction without fresh setup',
    });
  }

  const structureScorePct = (evaluation.confidenceScore / 6) * 100;
  const confirmationScorePct = bodyStrengthPct(current5);
  const entryQuality = calculateEntryQualityScore({
    trendAligned: evaluation.stages.trend,
    breakoutStrengthPct: structureScorePct,
    structureScorePct,
    confirmationScorePct,
    riskRewardRatio: evaluation.riskRewardRatio,
  });

  if (!passesEntryQuality(entryQuality)) {
    return waiting(
      current5,
      `Entry quality score ${entryQuality.total}/100 below minimum 80`,
      {
        ...stageAnalysis,
        currentStep: 'Entry Quality',
        blockingRule: 'Score below threshold',
        expectedValue: '≥ 80',
        actualValue: String(entryQuality.total),
        entryQuality,
      },
    );
  }

  state.cooldownUntilStep = ctx.replayStepIndex + INTRADAY_REVERSAL_COOLDOWN_CANDLES;

  const debug = buildSignalDebug({
    marketRegime,
    strategyStatus: 'PASS',
    currentStep: 'Entry',
    blockingRule: 'None',
    expectedValue: evaluation.signalType,
    actualValue: evaluation.signalType,
    nextConditionRequired: 'Trade execution',
    steps: [
      { name: 'Market Regime', status: 'PASS', actualValue: 'RANGING' },
      { name: 'Trend Exhaustion', status: 'PASS' },
      { name: 'Structure Shift', status: 'PASS' },
      { name: 'Confirmation', status: 'PASS' },
      { name: 'Confidence', status: 'PASS', actualValue: `${evaluation.confidenceScore}/6` },
      { name: 'Risk Reward', status: 'PASS', actualValue: evaluation.riskRewardRatio.toFixed(2) },
      { name: 'Entry Quality', status: 'PASS', actualValue: String(entryQuality.total) },
    ],
    entryQuality,
  });

  return {
    action: evaluation.signalType,
    entryPrice: evaluation.entryPrice,
    stopLoss: evaluation.stopLoss,
    target: evaluation.target1,
    riskRewardRatio: evaluation.riskRewardRatio,
    reason: `${confidenceLabel(evaluation.confidenceScore)} — ${evaluation.reason}`,
    analysis: {
      ...stageAnalysis,
      finalDecision: evaluation.signalType,
      entryPrice: evaluation.entryPrice,
      stopLoss: evaluation.stopLoss,
      target1: evaluation.target1,
      target2: evaluation.target2,
      structuralTarget: evaluation.structuralTarget,
      entryQuality,
      debug,
    },
  };
}

function buildAnalysis(
  evaluation: ReversalEvaluation,
  tradingDate: string,
  time: string,
  marketRegime: MarketRegime,
): Record<string, unknown> {
  return {
    tradingDate,
    time,
    marketRegime,
    strategy: 'Intraday Reversal',
    marketTrend: evaluation.marketTrend,
    confidenceScore: evaluation.confidenceScore,
    confidenceLabel: confidenceLabel(evaluation.confidenceScore),
    stages: evaluation.stages,
    trendWeakening: evaluation.trendWeakeningStatus,
    choch: evaluation.chochStatus,
    bos: evaluation.bosStatus,
    retest: evaluation.retestStatus,
    confirmation: evaluation.confirmationStatus,
  };
}

function skipped(
  candle: { close: number },
  reason: string,
  analysis: Record<string, unknown>,
  regime: MarketRegime,
): IntradayReversalResult {
  const debug = buildSignalDebug({
    marketRegime: regime,
    strategyStatus: 'SKIPPED',
    currentStep: 'Strategy Activation',
    blockingRule: reason,
    expectedValue: 'RANGING',
    actualValue: regime,
    nextConditionRequired: 'Ranging market day',
    steps: [{ name: 'Market Regime', status: 'SKIPPED', expectedValue: 'RANGING', actualValue: regime }],
  });
  return {
    action: 'SKIPPED',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { ...analysis, finalDecision: 'SKIPPED', debug, reason },
  };
}

function waiting(
  candle: { close: number },
  reason: string,
  analysis: Record<string, unknown>,
): IntradayReversalResult {
  const debug = buildSignalDebug({
    marketRegime: String(analysis['marketRegime'] ?? 'UNKNOWN'),
    strategyStatus: 'WAITING',
    currentStep: String(analysis['currentStep'] ?? 'Evaluation'),
    blockingRule: String(analysis['blockingRule'] ?? reason),
    expectedValue: String(analysis['expectedValue'] ?? '—'),
    actualValue: String(analysis['actualValue'] ?? '—'),
    nextConditionRequired: String(analysis['nextConditionRequired'] ?? '—'),
    entryQuality: analysis['entryQuality'] as EntryQualityBreakdown | undefined,
  });
  return {
    action: 'WAITING',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { ...analysis, finalDecision: 'WAITING', debug, reason },
  };
}

export function markIntradayReversalTradeClosed(
  state: IntradayReversalState,
  direction: 'BUY' | 'SELL',
): void {
  state.lastClosedDirection = direction;
}

import { Candle } from '../../../models/candle.model';
import { StrategyContext } from '../../models/strategy-context.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { extractHhMm, resolveSessionFromContext } from '../../utils/market-session.util';
import { MarketRegime } from '../../utils/market-regime.util';
import { evaluateBreakoutCandleQuality } from '../../utils/breakout-candle-quality.util';
import {
  calculateEntryQualityScore,
  passesEntryQuality,
  EntryQualityBreakdown,
} from '../../utils/entry-quality-score.util';
import { buildSignalDebug, SignalDebugInfo } from '../../utils/signal-debug.util';
import { bodyStrengthPct } from '../../utils/ohlc-candle.util';

export type FirstHourSignalAction = 'BUY' | 'SELL' | 'NO_TRADE' | 'WAITING' | 'SKIPPED';

/** Profit-optimized filters from NIFTY backtest (Mar–Jul 2026). */
export const FIRST_HOUR_MAX_BREAKOUT_DISTANCE_PTS = 20;
export const FIRST_HOUR_MAX_BREAKOUT_OPPOSITE_WICK_PCT = 8;

export interface BreakoutDistanceFilterResult {
  passed: boolean;
  distancePts: number;
  maxAllowedPts: number;
  reason: string;
}

export function breakoutDistanceBeyondRange(
  candle: Candle,
  direction: 'BUY' | 'SELL',
  rangeHigh: number,
  rangeLow: number,
): number {
  return direction === 'BUY' ? candle.close - rangeHigh : rangeLow - candle.close;
}

export function evaluateBreakoutDistanceFilter(
  candle: Candle,
  direction: 'BUY' | 'SELL',
  rangeHigh: number,
  rangeLow: number,
  maxDistancePts = FIRST_HOUR_MAX_BREAKOUT_DISTANCE_PTS,
): BreakoutDistanceFilterResult {
  const distancePts = breakoutDistanceBeyondRange(candle, direction, rangeHigh, rangeLow);
  if (distancePts > maxDistancePts) {
    return {
      passed: false,
      distancePts,
      maxAllowedPts: maxDistancePts,
      reason: `Breakout distance ${distancePts.toFixed(1)} pts exceeds max ${maxDistancePts} pts`,
    };
  }
  return {
    passed: true,
    distancePts,
    maxAllowedPts: maxDistancePts,
    reason: 'Breakout distance within limit',
  };
}

export function evaluateBreakoutOppositeWickFilter(
  oppositeWickPct: number,
  maxWickPct = FIRST_HOUR_MAX_BREAKOUT_OPPOSITE_WICK_PCT,
): { passed: boolean; reason: string } {
  if (oppositeWickPct > maxWickPct) {
    return {
      passed: false,
      reason: `Breakout opposite wick ${oppositeWickPct.toFixed(1)}% exceeds max ${maxWickPct}%`,
    };
  }
  return { passed: true, reason: 'Breakout opposite wick within limit' };
}

export interface FirstHourBreakoutResult {
  action: FirstHourSignalAction;
  entryPrice: number;
  stopLoss: number;
  target: number;
  riskRewardRatio: number;
  reason: string;
  analysis: Record<string, unknown>;
}

export interface PendingBreakout {
  direction: 'BUY' | 'SELL';
  breakoutStepIndex: number;
  firstHourHigh: number;
  firstHourLow: number;
  entryPrice: number;
  stopLoss: number;
  target: number;
  riskRewardRatio: number;
  qualityBodyPct: number;
}

export interface FirstHourBreakoutState {
  tradingDate: string | null;
  tradedToday: boolean;
  pendingBreakout: PendingBreakout | null;
  lastClosedDirection: 'BUY' | 'SELL' | null;
}

export interface FirstHourRange {
  high: number;
  low: number;
  barCount: number;
  source: '5m' | '60m';
  referenceDate: string;
}

export function createFirstHourBreakoutState(): FirstHourBreakoutState {
  return {
    tradingDate: null,
    tradedToday: false,
    pendingBreakout: null,
    lastClosedDirection: null,
  };
}

export function firstHourRangeFrom5m(ctx: StrategyContext): FirstHourRange | null {
  const session = resolveSessionFromContext(ctx);
  const tradingDate = extractTradeDate(ctx.candle5m.date);
  const time = extractHhMm(ctx.candle5m.date, session.timezone);

  if (time < session.firstHourReadyTime) {
    return null;
  }

  const bars = [...ctx.previous5m, ctx.candle5m].filter(
    (c) =>
      extractTradeDate(c.date) === tradingDate &&
      extractHhMm(c.date, session.timezone) >= session.marketOpen &&
      extractHhMm(c.date, session.timezone) < session.firstHourEnd,
  );

  if (!bars.length) {
    return null;
  }

  return {
    high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)),
    barCount: bars.length,
    source: '5m',
    referenceDate: bars[0]!.date,
  };
}

export function firstCompletedHourOfDay(ctx: StrategyContext): Candle | null {
  const session = resolveSessionFromContext(ctx);
  const tradingDate = extractTradeDate(ctx.candle5m.date);
  const time = extractHhMm(ctx.candle5m.date, session.timezone);

  if (time < session.firstHourReadyTime) {
    return null;
  }

  const all60 = [...ctx.previous60m, ctx.candle60m];
  const dayHours = all60
    .filter((c) => extractTradeDate(c.date) === tradingDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!dayHours.length) {
    return null;
  }

  const sessionFirst =
    dayHours.find((c) => extractHhMm(c.date, session.timezone) === session.marketOpen) ??
    dayHours[0]!;

  if (ctx.candle60m.date === sessionFirst.date) {
    return null;
  }

  return sessionFirst;
}

export function resolveFirstHourRange(ctx: StrategyContext): FirstHourRange | null {
  const from5m = firstHourRangeFrom5m(ctx);
  if (from5m) {
    return from5m;
  }

  const hourBar = firstCompletedHourOfDay(ctx);
  if (!hourBar) {
    return null;
  }

  return {
    high: hourBar.high,
    low: hourBar.low,
    barCount: 1,
    source: '60m',
    referenceDate: hourBar.date,
  };
}

export function runFirstHourBreakout(
  ctx: StrategyContext,
  state: FirstHourBreakoutState,
  marketRegime: MarketRegime = 'UNKNOWN',
): FirstHourBreakoutResult {
  const current5 = ctx.candle5m;
  const tradingDate = extractTradeDate(current5.date);
  const session = resolveSessionFromContext(ctx);
  const time = extractHhMm(current5.date, session.timezone);

  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.tradedToday = false;
    state.pendingBreakout = null;
    state.lastClosedDirection = null;
  }

  const baseAnalysis = {
    tradingDate,
    time,
    marketRegime,
    strategy: 'First Hour Breakout',
  };

  if (marketRegime !== 'TRENDING') {
    return skipped(
      current5,
      `Strategy inactive — requires TRENDING regime (current: ${marketRegime})`,
      baseAnalysis,
      marketRegime,
    );
  }

  if (state.tradedToday) {
    return noTrade(current5, 'One trade per day already taken', baseAnalysis, 'WAITING');
  }

  const firstHour = resolveFirstHourRange(ctx);
  if (!firstHour) {
    return waiting(
      current5,
      `Waiting for first 1-hour range to complete (after ${session.firstHourReadyTime})`,
      {
        ...baseAnalysis,
        currentStep: 'First Hour Range',
        nextConditionRequired: `Complete ${session.marketOpen}–${session.firstHourEnd} range`,
      },
    );
  }

  const rangeAnalysis = {
    ...baseAnalysis,
    firstHourHigh: firstHour.high,
    firstHourLow: firstHour.low,
    firstHourSource: firstHour.source,
    firstHourBarCount: firstHour.barCount,
    firstHourReference: firstHour.referenceDate,
  };

  if (state.pendingBreakout) {
    return handlePendingConfirmation(ctx, state, current5, rangeAnalysis);
  }

  const previous5 = ctx.previous5m.at(-1) ?? null;
  const bullishBreak = current5.close > firstHour.high;
  const bearishBreak = current5.close < firstHour.low;

  if (!bullishBreak && !bearishBreak) {
    return waiting(
      current5,
      'Waiting for 5m close beyond first 1H range',
      {
        ...rangeAnalysis,
        currentStep: 'Breakout',
        expectedValue: `Close > ${firstHour.high.toFixed(2)} or < ${firstHour.low.toFixed(2)}`,
        actualValue: current5.close.toFixed(2),
        nextConditionRequired: 'Strong breakout candle closing outside range',
      },
    );
  }

  const direction: 'BUY' | 'SELL' = bullishBreak ? 'BUY' : 'SELL';
  const quality = evaluateBreakoutCandleQuality(
    current5,
    previous5,
    direction,
    firstHour.high,
    firstHour.low,
  );

  if (!quality.passed) {
    return waiting(
      current5,
      quality.reason,
      {
        ...rangeAnalysis,
        currentStep: 'Breakout Quality',
        blockingRule: quality.reason,
        expectedValue: 'Body ≥60%, close in top/bottom 20%, strong wick profile',
        actualValue: `Body ${quality.bodyPct.toFixed(0)}%, close zone ${quality.closePositionPct.toFixed(0)}%`,
        nextConditionRequired: 'Valid breakout candle',
        breakoutQuality: quality,
      },
    );
  }

  const distanceFilter = evaluateBreakoutDistanceFilter(
    current5,
    direction,
    firstHour.high,
    firstHour.low,
  );
  if (!distanceFilter.passed) {
    return waiting(
      current5,
      distanceFilter.reason,
      {
        ...rangeAnalysis,
        currentStep: 'Breakout Distance',
        blockingRule: distanceFilter.reason,
        expectedValue: `≤ ${distanceFilter.maxAllowedPts} pts beyond 1H range`,
        actualValue: `${distanceFilter.distancePts.toFixed(1)} pts`,
        nextConditionRequired: 'Moderate breakout extension (not overextended)',
        breakoutDistancePts: distanceFilter.distancePts,
      },
    );
  }

  const wickFilter = evaluateBreakoutOppositeWickFilter(quality.oppositeWickPct * 100);
  if (!wickFilter.passed) {
    return waiting(
      current5,
      wickFilter.reason,
      {
        ...rangeAnalysis,
        currentStep: 'Breakout Wick',
        blockingRule: wickFilter.reason,
        expectedValue: `≤ ${FIRST_HOUR_MAX_BREAKOUT_OPPOSITE_WICK_PCT}% of body`,
        actualValue: `${(quality.oppositeWickPct * 100).toFixed(1)}%`,
        nextConditionRequired: 'Tight opposite wick on breakout candle',
        breakoutQuality: quality,
      },
    );
  }

  const entryPrice = current5.close;
  const stopLoss = direction === 'BUY' ? current5.low : current5.high;
  const risk = Math.abs(entryPrice - stopLoss);
  const target =
    direction === 'BUY' ? entryPrice + risk * 10 : entryPrice - risk * 10;
  const rr = risk > 0 ? 10 : 0;

  state.pendingBreakout = {
    direction,
    breakoutStepIndex: ctx.replayStepIndex,
    firstHourHigh: firstHour.high,
    firstHourLow: firstHour.low,
    entryPrice,
    stopLoss,
    target,
    riskRewardRatio: rr,
    qualityBodyPct: quality.bodyPct,
  };

  return waiting(
    current5,
    'Breakout quality passed — waiting for next completed candle confirmation',
    {
      ...rangeAnalysis,
      currentStep: 'Confirmation Candle',
      blockingRule: 'Awaiting confirmation candle',
      expectedValue:
        direction === 'BUY'
          ? 'Next close stays above first hour high'
          : 'Next close stays below first hour low',
      actualValue: 'Pending next 5m bar',
      nextConditionRequired: 'One additional completed 5-minute candle',
      pendingDirection: direction,
      breakoutQuality: quality,
    },
  );
}

function handlePendingConfirmation(
  ctx: StrategyContext,
  state: FirstHourBreakoutState,
  current5: Candle,
  rangeAnalysis: Record<string, unknown>,
): FirstHourBreakoutResult {
  const pending = state.pendingBreakout!;

  if (ctx.replayStepIndex <= pending.breakoutStepIndex) {
    return waiting(current5, 'Breakout candle still forming', {
      ...rangeAnalysis,
      currentStep: 'Confirmation Candle',
      nextConditionRequired: 'Wait for breakout candle to complete',
    });
  }

  const confirmed =
    pending.direction === 'BUY'
      ? current5.close > pending.firstHourHigh
      : current5.close < pending.firstHourLow;

  if (!confirmed) {
    state.pendingBreakout = null;
    const failReason =
      pending.direction === 'BUY'
        ? 'Confirmation failed — close re-entered first hour range'
        : 'Confirmation failed — close back above first hour low';
    return waiting(current5, failReason, {
      ...rangeAnalysis,
      currentStep: 'Confirmation Candle',
      blockingRule: failReason,
      expectedValue:
        pending.direction === 'BUY'
          ? `Close > ${pending.firstHourHigh.toFixed(2)}`
          : `Close < ${pending.firstHourLow.toFixed(2)}`,
      actualValue: current5.close.toFixed(2),
      nextConditionRequired: 'Fresh breakout setup required',
    });
  }

  if (
    state.lastClosedDirection === pending.direction &&
    state.tradedToday === false
  ) {
    // Fresh setup confirmed via new pending cycle — allow
  }

  const confirmationScorePct = Math.min(100, bodyStrengthPct(current5) + 30);
  const entryQuality = calculateEntryQualityScore({
    trendAligned: true,
    breakoutStrengthPct: pending.qualityBodyPct,
    structureScorePct: 85,
    confirmationScorePct,
    riskRewardRatio: pending.riskRewardRatio,
  });

  if (!passesEntryQuality(entryQuality)) {
    state.pendingBreakout = null;
    return waiting(
      current5,
      `Entry quality score ${entryQuality.total}/100 below minimum 80`,
      {
        ...rangeAnalysis,
        currentStep: 'Entry Quality',
        blockingRule: 'Score below threshold',
        expectedValue: '≥ 80',
        actualValue: String(entryQuality.total),
        nextConditionRequired: 'Higher quality setup',
        entryQuality,
      },
    );
  }

  state.pendingBreakout = null;
  markFirstHourTradeTaken(state, extractTradeDate(current5.date));

  const debug = buildSignalDebug({
    marketRegime: String(rangeAnalysis['marketRegime'] ?? 'TRENDING'),
    strategyStatus: 'PASS',
    currentStep: 'Entry',
    blockingRule: 'None',
    expectedValue: pending.direction,
    actualValue: pending.direction,
    nextConditionRequired: 'Trade execution',
    steps: [
      { name: 'Market Regime', status: 'PASS', actualValue: 'TRENDING' },
      { name: 'Breakout', status: 'PASS' },
      { name: 'Breakout Quality', status: 'PASS' },
      { name: 'Confirmation Candle', status: 'PASS' },
      { name: 'Entry Quality', status: 'PASS', actualValue: String(entryQuality.total) },
    ],
    entryQuality,
  });

  return {
    action: pending.direction,
    entryPrice: current5.close,
    stopLoss: pending.direction === 'BUY' ? current5.low : current5.high,
    target: pending.target,
    riskRewardRatio: pending.riskRewardRatio,
    reason: `${pending.direction} confirmed after first hour ${pending.direction === 'BUY' ? 'high' : 'low'} breakout`,
    analysis: {
      ...rangeAnalysis,
      finalDecision: pending.direction,
      entryQuality,
      debug,
      confirmationClose: current5.close,
    },
  };
}

function skipped(
  candle: Candle,
  reason: string,
  analysis: Record<string, unknown>,
  regime: MarketRegime,
): FirstHourBreakoutResult {
  const debug = buildSignalDebug({
    marketRegime: regime,
    strategyStatus: 'SKIPPED',
    currentStep: 'Strategy Activation',
    blockingRule: reason,
    expectedValue: 'TRENDING',
    actualValue: regime,
    nextConditionRequired: 'Trending market day',
    steps: [{ name: 'Market Regime', status: 'SKIPPED', expectedValue: 'TRENDING', actualValue: regime }],
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
  candle: Candle,
  reason: string,
  analysis: Record<string, unknown>,
): FirstHourBreakoutResult {
  const debug = buildSignalDebug({
    marketRegime: String(analysis['marketRegime'] ?? 'UNKNOWN'),
    strategyStatus: 'WAITING',
    currentStep: String(analysis['currentStep'] ?? 'Evaluation'),
    blockingRule: String(analysis['blockingRule'] ?? reason),
    expectedValue: String(analysis['expectedValue'] ?? '—'),
    actualValue: String(analysis['actualValue'] ?? '—'),
    nextConditionRequired: String(analysis['nextConditionRequired'] ?? '—'),
    steps: buildStepsFromAnalysis(analysis),
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

function noTrade(
  candle: Candle,
  reason: string,
  analysis: Record<string, unknown>,
  status: 'NO_TRADE' | 'WAITING' = 'NO_TRADE',
): FirstHourBreakoutResult {
  return waiting(candle, reason, { ...analysis, finalDecision: status });
}

function buildStepsFromAnalysis(analysis: Record<string, unknown>) {
  const steps = [];
  if (analysis['marketRegime']) {
    steps.push({
      name: 'Market Regime',
      status: analysis['marketRegime'] === 'TRENDING' ? ('PASS' as const) : ('SKIPPED' as const),
      expectedValue: 'TRENDING',
      actualValue: String(analysis['marketRegime']),
    });
  }
  if (analysis['currentStep']) {
    steps.push({
      name: String(analysis['currentStep']),
      status: 'WAITING' as const,
      expectedValue: String(analysis['expectedValue'] ?? '—'),
      actualValue: String(analysis['actualValue'] ?? '—'),
    });
  }
  return steps;
}

export function markFirstHourTradeTaken(state: FirstHourBreakoutState, tradingDate: string): void {
  state.tradingDate = tradingDate;
  state.tradedToday = true;
}

export function markFirstHourTradeClosed(
  state: FirstHourBreakoutState,
  direction: 'BUY' | 'SELL',
): void {
  state.lastClosedDirection = direction;
}

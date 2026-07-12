import { HistoricalTrade } from '../../models/historical-test.model';
import { CandleDataset } from '../models/candle-dataset.model';
import {
  ExitMethod,
  LossReason,
  TimeframeTrendLabel,
  TradeDiagnosticRecord,
  TradingSession,
} from '../models/loss-pattern.model';
import { calculateMomentumScore } from './momentum-score.util';
import { evaluateSidewaysMarketFilter } from './sideways-market-filter.util';
import { evaluateReversalSetup } from './reversal-detection.util';
import {
  averageBodySize,
  bodySize,
  candleRange,
  trend30m,
  trend60m,
} from './ohlc-candle.util';
import {
  detectSwingHighs,
  detectSwingLows,
  rankStoredLevels,
} from './swing-level.util';
import { extractTradeDate, formatDayOfWeek } from '../../utils/trade-date.util';
import { Candle } from '../../models/candle.model';

export interface TradeSequenceContext {
  tradeNumber: number;
  tradeNumberOfDay: number;
  consecutiveBuy: number;
  consecutiveSell: number;
  previousTradeResult: HistoricalTrade['outcome'] | null;
  twoConsecutiveLossesBefore: boolean;
}

const LARGE_MOVE_PCT = 0.008;
const NEAR_LEVEL_PCT = 0.003;
const EXTREME_CANDLE_MULTIPLIER = 2.5;
const LONG_HOLDING_MINUTES = 120;

export function buildTradeDiagnostic(params: {
  trade: HistoricalTrade;
  dataset: CandleDataset;
  sequence: TradeSequenceContext;
}): TradeDiagnosticRecord | null {
  const entryStep = params.dataset.findReplayStepByDateTime(params.trade.entryTime);
  const exitStep = params.dataset.findReplayStepByDateTime(params.trade.exitTime);
  if (entryStep < 0 || exitStep < 0) {
    return null;
  }

  const entryContext = params.dataset.buildContext(entryStep);
  const exitContext = params.dataset.buildContext(exitStep);
  const entryCandles5 = [...entryContext.previous5m, entryContext.candle5m];
  const exitCandles5 = [...exitContext.previous5m, exitContext.candle5m];

  const entryMomentum = calculateMomentumScore(entryCandles5);
  const exitMomentum = calculateMomentumScore(exitCandles5);
  const momentumPath = trackMomentumDuringTrade(params.dataset, entryStep, exitStep, params.trade.direction);

  const entryCandle = entryContext.candle5m;
  const structureCounts = countStructure(entryCandles5.slice(-6));
  const sideways = evaluateSidewaysMarketFilter(
    entryCandles5,
    entryMomentum?.winningScore ?? 0,
  );
  const reversal = evaluateReversalSetup(entryCandles5);

  const swingHighs = detectSwingHighs(entryCandles5);
  const swingLows = detectSwingLows(entryCandles5);
  const levels = rankStoredLevels(entryCandle.close, swingHighs, swingLows);

  const trend30 = toTimeframeTrend(
    trend30m([...entryContext.previous30m, entryContext.candle30m]).trend,
  );
  const trend60 = toTimeframeTrend(
    trend60m([...entryContext.previous60m, entryContext.candle60m]).trend,
  );

  const candleQuality = analyzeEntryCandle(entryCandle, entryCandles5);
  const distances = analyzeDistances(entryCandle.close, swingHighs, swingLows, levels);
  const risk = Math.abs(params.trade.entryPrice - params.trade.stopLoss);
  const reward = Math.abs(params.trade.targetPrice - params.trade.entryPrice);
  const exitMethod = classifyExitMethod(params.trade.exitReason);
  const tradeDate = extractTradeDate(params.trade.entryTime);

  const record: TradeDiagnosticRecord = {
    tradeId: params.trade.id,
    tradeNumber: params.sequence.tradeNumber,
    tradeDate,
    dayOfWeek: formatDayOfWeek(tradeDate),
    entryTime: params.trade.entryTime,
    exitTime: params.trade.exitTime,
    holdingMinutes: params.trade.holdingMinutes,
    direction: params.trade.direction,
    entryPrice: params.trade.entryPrice,
    exitPrice: params.trade.exitPrice,
    stopLoss: params.trade.stopLoss,
    target: params.trade.targetPrice,
    risk,
    reward,
    profitLoss: params.trade.profitLoss,
    points: params.trade.points,
    tradeResult: params.trade.outcome,

    momentumAtEntry: directionalMomentum(entryMomentum, params.trade.direction),
    momentumAtExit: directionalMomentum(exitMomentum, params.trade.direction),
    highestMomentum: momentumPath.highest,
    lowestMomentum: momentumPath.lowest,
    momentumWeakened: momentumPath.weakened,
    momentumWeakenPath: momentumPath.path,

    higherHighCount: structureCounts.higherHigh,
    higherLowCount: structureCounts.higherLow,
    lowerHighCount: structureCounts.lowerHigh,
    lowerLowCount: structureCounts.lowerLow,
    marketTrending: sideways.marketState === 'Trending',
    marketSideways: sideways.marketState === 'Sideways' || sideways.sidewaysScore >= 4,
    marketReversal: detectReversalAtEntry(reversal, params.trade.direction),

    trend30m: trend30,
    trend60m: trend60,
    trend30mAgrees: timeframeAgrees(trend30, params.trade.direction),
    trend60mAgrees: timeframeAgrees(trend60, params.trade.direction),

    entryCandleBody: candleQuality.body,
    entryCandleUpperWick: candleQuality.upperWick,
    entryCandleLowerWick: candleQuality.lowerWick,
    entryCandleRange: candleQuality.range,
    entryCandleClosePosition: candleQuality.closePosition,
    entryCandleLargerThanAvg: candleQuality.largerThanAvg,
    entryCandleExtremelyLarge: candleQuality.extremelyLarge,

    distanceFromSwingHigh: distances.swingHigh,
    distanceFromSwingLow: distances.swingLow,
    distanceFromResistance: distances.resistance,
    distanceFromSupport: distances.support,
    enteredAfterLargeMove: distances.afterLargeMove,

    sidewaysScore: sideways.sidewaysScore,
    priceCompression: sideways.priceCompression,
    overlapZone: sideways.overlapZone,
    failedBreakouts: sideways.failedBreakoutZone,
    flatStructure: sideways.flatStructure,
    smallBodyCluster: sideways.smallBodyCluster,

    tradeNumberOfDay: params.sequence.tradeNumberOfDay,
    tradeNumberOfDayLabel: ordinalLabel(params.sequence.tradeNumberOfDay),
    consecutiveBuy: params.sequence.consecutiveBuy,
    consecutiveSell: params.sequence.consecutiveSell,
    previousTradeResult: params.sequence.previousTradeResult,
    twoConsecutiveLossesBefore: params.sequence.twoConsecutiveLossesBefore,

    tradingSession: classifySession(params.trade.entryTime),
    exitMethod,
    momentumDisappearedBeforeStopLoss:
      momentumPath.weakened && exitMethod === 'Stop Loss',

    lossReasons: [],
    lossScore: 0,
  };

  record.lossReasons = classifyLossReasons(record);
  record.lossScore = record.lossReasons.filter((r) => r !== 'UNKNOWN').length;

  return record;
}

export function buildSequenceContexts(trades: HistoricalTrade[]): TradeSequenceContext[] {
  const sorted = [...trades].sort((a, b) => a.entryTime.localeCompare(b.entryTime));
  const dayCounts = new Map<string, number>();
  let consecutiveBuy = 0;
  let consecutiveSell = 0;
  let previousResult: HistoricalTrade['outcome'] | null = null;
  let recentLosses = 0;

  return sorted.map((trade, index) => {
    const date = extractTradeDate(trade.entryTime);
    const dayCount = (dayCounts.get(date) ?? 0) + 1;
    dayCounts.set(date, dayCount);

    if (trade.direction === 'BUY') {
      consecutiveBuy += 1;
      consecutiveSell = 0;
    } else {
      consecutiveSell += 1;
      consecutiveBuy = 0;
    }

    const twoConsecutiveLossesBefore = recentLosses >= 2;
    const ctx: TradeSequenceContext = {
      tradeNumber: index + 1,
      tradeNumberOfDay: dayCount,
      consecutiveBuy,
      consecutiveSell,
      previousTradeResult: previousResult,
      twoConsecutiveLossesBefore,
    };

    if (trade.outcome === 'LOSS') {
      recentLosses += 1;
    } else {
      recentLosses = 0;
    }
    previousResult = trade.outcome;

    return ctx;
  });
}

function trackMomentumDuringTrade(
  dataset: CandleDataset,
  entryStep: number,
  exitStep: number,
  direction: HistoricalTrade['direction'],
): { highest: number; lowest: number; weakened: boolean; path: string[] } {
  const scores: number[] = [];
  const path: string[] = [];
  let prev: number | null = null;

  for (let step = entryStep; step <= exitStep; step += 1) {
    const ctx = dataset.buildContext(step);
    const candles5 = [...ctx.previous5m, ctx.candle5m];
    const momentum = calculateMomentumScore(candles5);
    if (!momentum) {
      continue;
    }
    const score = directionalMomentum(momentum, direction);
    scores.push(score);

    if (prev !== null && score < prev) {
      path.push(`${prev} → ${score}`);
    }
    prev = score;
  }

  if (!scores.length) {
    return { highest: 0, lowest: 0, weakened: false, path: [] };
  }

  return {
    highest: Math.max(...scores),
    lowest: Math.min(...scores),
    weakened: path.length > 0,
    path,
  };
}

function directionalMomentum(
  momentum: ReturnType<typeof calculateMomentumScore>,
  direction: HistoricalTrade['direction'],
): number {
  if (!momentum) {
    return 0;
  }
  return direction === 'BUY' ? momentum.bullishScore : momentum.bearishScore;
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

function toTimeframeTrend(trend: 'BUY' | 'SELL' | 'NEUTRAL'): TimeframeTrendLabel {
  if (trend === 'BUY') {
    return 'Bullish';
  }
  if (trend === 'SELL') {
    return 'Bearish';
  }
  return 'Sideways';
}

function timeframeAgrees(trend: TimeframeTrendLabel, direction: HistoricalTrade['direction']): boolean {
  if (trend === 'Sideways') {
    return false;
  }
  return (direction === 'BUY' && trend === 'Bullish') || (direction === 'SELL' && trend === 'Bearish');
}

function detectReversalAtEntry(
  reversal: ReturnType<typeof evaluateReversalSetup>,
  direction: HistoricalTrade['direction'],
): boolean {
  if (reversal.marketTrend === 'Sideways') {
    return false;
  }
  if (direction === 'BUY' && reversal.marketTrend === 'Bearish') {
    return reversal.confidenceScore >= 2;
  }
  if (direction === 'SELL' && reversal.marketTrend === 'Bullish') {
    return reversal.confidenceScore >= 2;
  }
  return reversal.signalType !== 'NO_TRADE' && reversal.direction !== direction;
}

function analyzeEntryCandle(entryCandle: Candle, candles5: Candle[]): {
  body: number;
  upperWick: number;
  lowerWick: number;
  range: number;
  closePosition: 'Top' | 'Middle' | 'Bottom';
  largerThanAvg: boolean;
  extremelyLarge: boolean;
} {
  const range = candleRange(entryCandle);
  const body = bodySize(entryCandle);
  const upperWick = entryCandle.high - Math.max(entryCandle.open, entryCandle.close);
  const lowerWick = Math.min(entryCandle.open, entryCandle.close) - entryCandle.low;
  const prior = candles5.slice(0, -1);
  const avgBody = averageBodySize(prior, 5);
  const closePosition = closePositionInCandle(entryCandle);

  return {
    body,
    upperWick,
    lowerWick,
    range,
    closePosition,
    largerThanAvg: avgBody > 0 && body > avgBody,
    extremelyLarge: avgBody > 0 && body >= avgBody * EXTREME_CANDLE_MULTIPLIER,
  };
}

function closePositionInCandle(candle: Candle): 'Top' | 'Middle' | 'Bottom' {
  const range = candleRange(candle);
  if (range <= 0) {
    return 'Middle';
  }
  const position = (candle.close - candle.low) / range;
  if (position >= 0.66) {
    return 'Top';
  }
  if (position <= 0.33) {
    return 'Bottom';
  }
  return 'Middle';
}

function analyzeDistances(
  price: number,
  swingHighs: ReturnType<typeof detectSwingHighs>,
  swingLows: ReturnType<typeof detectSwingLows>,
  levels: ReturnType<typeof rankStoredLevels>,
): {
  swingHigh: number | null;
  swingLow: number | null;
  resistance: number | null;
  support: number | null;
  afterLargeMove: boolean;
} {
  const lastHigh = swingHighs.at(-1)?.price ?? null;
  const lastLow = swingLows.at(-1)?.price ?? null;
  const resistance = levels.nearestResistance;
  const support = levels.nearestSupport;

  const swingHighDist = lastHigh !== null ? pctDistance(price, lastHigh) : null;
  const swingLowDist = lastLow !== null ? pctDistance(price, lastLow) : null;

  const recentMove =
    swingHighs.length >= 2
      ? Math.abs(swingHighs.at(-1)!.price - swingHighs.at(-2)!.price) / swingHighs.at(-2)!.price
      : 0;

  return {
    swingHigh: swingHighDist,
    swingLow: swingLowDist,
    resistance: resistance !== null ? pctDistance(price, resistance) : null,
    support: support !== null ? pctDistance(price, support) : null,
    afterLargeMove: recentMove >= LARGE_MOVE_PCT,
  };
}

function pctDistance(a: number, b: number): number {
  if (b === 0) {
    return 0;
  }
  return Math.abs(a - b) / b;
}

function classifySession(entryTime: string): TradingSession {
  const time = extractHhMm(entryTime);
  if (time >= '09:15' && time < '10:30') {
    return 'Morning';
  }
  if (time >= '10:30' && time < '13:00') {
    return 'Mid Session';
  }
  return 'Afternoon';
}

function extractHhMm(dateTime: string): string {
  const normalized = dateTime.includes('T') ? dateTime.replace('T', ' ') : dateTime;
  return (normalized.split(' ')[1] ?? '').slice(0, 5);
}

function classifyExitMethod(exitReason: string): ExitMethod {
  const reason = exitReason.toLowerCase();
  if (reason.includes('target')) {
    return 'Target';
  }
  if (reason.includes('early exit') && reason.includes('momentum')) {
    return 'Momentum Exit';
  }
  if (reason.includes('early exit')) {
    return 'Early Exit';
  }
  if (reason.includes('stop loss')) {
    return 'Stop Loss';
  }
  if (reason.includes('time')) {
    return 'Time Exit';
  }
  return 'Manual Exit';
}

function ordinalLabel(n: number): string {
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? 'st'
      : n % 10 === 2 && n % 100 !== 12
        ? 'nd'
        : n % 10 === 3 && n % 100 !== 13
          ? 'rd'
          : 'th';
  return `${n}${suffix} Trade`;
}

function classifyLossReasons(record: TradeDiagnosticRecord): LossReason[] {
  if (record.tradeResult !== 'LOSS') {
    return [];
  }

  const reasons: LossReason[] = [];

  if (record.enteredAfterLargeMove) {
    reasons.push('Late Entry', 'Trend Exhaustion');
  }
  if (record.momentumAtEntry < 4) {
    reasons.push('Weak Momentum');
  }
  if (record.marketSideways || record.sidewaysScore >= 4) {
    reasons.push('Sideways Market');
  }
  if (!record.trend30mAgrees || !record.trend60mAgrees) {
    reasons.push('Counter Trend');
  }
  if (!record.trend60mAgrees) {
    reasons.push('Higher Timeframe Conflict');
  }
  if (
    record.direction === 'BUY' &&
    record.distanceFromResistance !== null &&
    record.distanceFromResistance <= NEAR_LEVEL_PCT
  ) {
    reasons.push('Near Resistance');
  }
  if (
    record.direction === 'SELL' &&
    record.distanceFromSupport !== null &&
    record.distanceFromSupport <= NEAR_LEVEL_PCT
  ) {
    reasons.push('Near Support');
  }
  if (isPoorEntryCandle(record)) {
    reasons.push('Poor Candle');
  }
  if (record.entryCandleExtremelyLarge) {
    reasons.push('Large Entry Candle');
  }
  if (record.momentumWeakened && record.momentumWeakenPath.length >= 2) {
    reasons.push('Momentum Collapse');
  }
  if (record.twoConsecutiveLossesBefore) {
    reasons.push('Trade After Consecutive Loss');
  }
  if (record.tradingSession === 'Mid Session') {
    reasons.push('Middle Session Trade');
  }
  if (record.tradeNumberOfDay >= 3 || record.consecutiveBuy >= 2 || record.consecutiveSell >= 2) {
    reasons.push('Duplicate Entry');
  }
  if (record.holdingMinutes >= LONG_HOLDING_MINUTES) {
    reasons.push('Long Holding Time');
  }
  if (record.marketReversal) {
    reasons.push('Structure Failure');
  }

  const unique = [...new Set(reasons)];
  return unique.length ? unique : ['UNKNOWN'];
}

function isPoorEntryCandle(record: TradeDiagnosticRecord): boolean {
  if (record.direction === 'BUY') {
    return record.entryCandleClosePosition === 'Bottom';
  }
  return record.entryCandleClosePosition === 'Top';
}

import { StrategyContext } from '../../../strategy-engine/models/strategy-context.model';
import { ResearchStrategyResult } from '../../interfaces/research-strategy.interface';
import { HourBreakoutState } from '../../strategies/hour-breakout/hour-breakout.evaluator';
import { extractTradingDate, previousCompletedHourBar } from '../../shared/research-signal.util';
import { RESEARCH_STRATEGY_IDS } from '../../interfaces/research-strategy.interface';
import {
  CandleDebugRecord,
  DebugRuleCheck,
  ModuleKey,
  Strategy3AuditDetail,
  Strategy3HourDebug,
  WaitingState,
} from '../models/strategy-research-debug.model';
import { emptyTrendDebug } from '../utils/debug-trend.util';

const STRATEGY_NAME = 'Strategy 3 — 1 Hour Breakout';
const MIN_TICK = 0.05;

export function analyzeStrategy3Candle(
  ctx: StrategyContext,
  stateAfterEval: HourBreakoutState,
  evaluatorResult: ResearchStrategyResult,
): Omit<CandleDebugRecord, 'tradeDetails' | 'openTradeActive'> {
  const current5 = ctx.candle5m;
  const candles5 = [...ctx.previous5m, current5];
  const previous5 = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
  const candles60 = [...ctx.previous60m, ctx.candle60m];
  const formingHour = candles60.length >= 1 ? candles60[candles60.length - 1]! : null;
  const hourBar = previousCompletedHourBar(ctx);
  const expectedCompleted = candles60.length >= 2 ? candles60[candles60.length - 2]! : null;
  const usesCompletedHourVerified =
    hourBar !== null && expectedCompleted !== null && hourBar.date === expectedCompleted.date;
  const tradingDate = extractTradingDate(current5.date);

  const prev5Close = previous5?.close ?? null;
  const hourHigh = hourBar?.high ?? null;
  const hourLow = hourBar?.low ?? null;

  const bullishBreakoutCloseCondition =
    hourBar !== null &&
    previous5 !== null &&
    previous5.close <= hourBar.high &&
    current5.close > hourBar.high;

  const bearishBreakoutCloseCondition =
    hourBar !== null &&
    previous5 !== null &&
    previous5.close >= hourBar.low &&
    current5.close < hourBar.low;

  const storedBreakout = stateAfterEval.pendingBreakoutCandle
    ? {
        date: stateAfterEval.pendingBreakoutCandle.date,
        open: stateAfterEval.pendingBreakoutCandle.open,
        high: stateAfterEval.pendingBreakoutCandle.high,
        low: stateAfterEval.pendingBreakoutCandle.low,
        close: stateAfterEval.pendingBreakoutCandle.close,
      }
    : null;

  const followThroughBuy =
    storedBreakout !== null &&
    stateAfterEval.pendingDirection === 'BUY' &&
    current5.high > storedBreakout.high;

  const followThroughSell =
    storedBreakout !== null &&
    stateAfterEval.pendingDirection === 'SELL' &&
    current5.low < storedBreakout.low;

  const followThroughLevel =
    storedBreakout !== null
      ? stateAfterEval.pendingDirection === 'BUY'
        ? storedBreakout.high + MIN_TICK
        : storedBreakout.low - MIN_TICK
      : null;

  const evaluatorAction = evaluatorResult.action;
  const tradeable = evaluatorAction === 'BUY' || evaluatorAction === 'SELL';

  let evaluatorPhase: Strategy3AuditDetail['evaluatorPhase'] = 'waiting_range_break';
  let exactBlockReason = evaluatorResult.reason;

  if (!hourBar || !previous5) {
    evaluatorPhase = 'no_hour_reference';
    exactBlockReason = 'Waiting for completed 1-hour candle reference';
  } else if (tradeable && evaluatorAction === 'BUY') {
    evaluatorPhase = 'entry_buy';
  } else if (tradeable && evaluatorAction === 'SELL') {
    evaluatorPhase = 'entry_sell';
  } else if (evaluatorResult.reason.includes('Risk reward below')) {
    evaluatorPhase = 'rr_rejected';
  } else if (storedBreakout && stateAfterEval.pendingDirection === 'BUY') {
    evaluatorPhase = 'waiting_follow_through_buy';
    exactBlockReason = `Waiting: current5.high ${current5.high.toFixed(2)} must exceed stored high ${storedBreakout.high.toFixed(2)}`;
  } else if (storedBreakout && stateAfterEval.pendingDirection === 'SELL') {
    evaluatorPhase = 'waiting_follow_through_sell';
    exactBlockReason = `Waiting: current5.low ${current5.low.toFixed(2)} must break stored low ${storedBreakout.low.toFixed(2)}`;
  } else if (bullishBreakoutCloseCondition) {
    evaluatorPhase = 'breakout_stored_buy';
    exactBlockReason = 'Breakout above 1H high — breakout candle stored, waiting follow-through';
  } else if (bearishBreakoutCloseCondition) {
    evaluatorPhase = 'breakout_stored_sell';
    exactBlockReason = 'Breakdown below 1H low — breakout candle stored, waiting follow-through';
  } else {
    exactBlockReason = `Waiting: prev5.close ${prev5Close?.toFixed(2)} / current5.close ${current5.close.toFixed(2)} vs 1H H ${hourHigh?.toFixed(2)} L ${hourLow?.toFixed(2)}`;
  }

  const strategy3Details: Strategy3HourDebug = {
    previousHourCandle: hourBar
      ? { open: hourBar.open, high: hourBar.high, low: hourBar.low, close: hourBar.close, date: hourBar.date }
      : null,
    current5mCandle: {
      open: current5.open,
      high: current5.high,
      low: current5.low,
      close: current5.close,
      date: current5.date,
    },
    highCrossedPreviousHourHigh: hourBar ? current5.high > hourBar.high : false,
    lowCrossedPreviousHourLow: hourBar ? current5.low < hourBar.low : false,
    breakoutDetected: bullishBreakoutCloseCondition || bearishBreakoutCloseCondition || storedBreakout !== null,
    waitingForNextCandle: storedBreakout !== null && !tradeable,
    entryTriggerHit: tradeable,
  };

  const strategy3Audit: Strategy3AuditDetail = {
    formingHourCandle: formingHour
      ? { date: formingHour.date, open: formingHour.open, high: formingHour.high, low: formingHour.low, close: formingHour.close }
      : null,
    previousCompletedHourCandle: hourBar
      ? { date: hourBar.date, open: hourBar.open, high: hourBar.high, low: hourBar.low, close: hourBar.close }
      : null,
    usesCompletedHourVerified,
    hourBarIndexNote: usesCompletedHourVerified
      ? `Verified: previousCompletedHourBar === candles60[${candles60.length - 2}] (NOT forming candle)`
      : hourBar
        ? `WARNING: hour bar date ${hourBar.date} vs forming ${formingHour?.date}`
        : 'No 60m history',
    previous5Close: prev5Close,
    current5Close: current5.close,
    hourHigh,
    hourLow,
    bullishBreakoutCloseCondition,
    bearishBreakoutCloseCondition,
    highCrossedHourHigh: strategy3Details.highCrossedPreviousHourHigh,
    lowCrossedHourLow: strategy3Details.lowCrossedPreviousHourLow,
    storedBreakoutCandle: storedBreakout,
    pendingDirection: stateAfterEval.pendingDirection,
    followThroughBuy,
    followThroughSell,
    followThroughLevel,
    evaluatorPhase,
    exactBlockReason,
    evaluatorAction,
    evaluatorReason: evaluatorResult.reason,
  };

  let waitingState: WaitingState = 'None';
  let blockingModule: ModuleKey | null = null;

  if (!tradeable) {
    if (evaluatorPhase === 'no_hour_reference') {
      waitingState = 'Waiting for Breakout';
      blockingModule = 'trend';
    } else if (evaluatorPhase.startsWith('waiting_follow_through')) {
      waitingState = 'Waiting for Entry Trigger';
      blockingModule = 'entry';
    } else if (evaluatorPhase.startsWith('breakout_stored')) {
      waitingState = 'Waiting for Entry Trigger';
      blockingModule = 'entry';
    } else if (evaluatorPhase === 'rr_rejected') {
      waitingState = 'Waiting for Entry Trigger';
      blockingModule = 'entry';
    } else {
      waitingState = 'Waiting for Breakout';
      blockingModule = 'breakout';
    }
  }

  const breakoutChecks: DebugRuleCheck[] = [
    {
      name: 'Uses Previous COMPLETED 1H (not forming)',
      passed: usesCompletedHourVerified,
      reason: strategy3Audit.hourBarIndexNote,
      expected: 'hourBar === candles60[length-2]',
      actual: hourBar?.date ?? 'null',
    },
    {
      name: 'Bullish Breakout (close cross)',
      passed: bullishBreakoutCloseCondition,
      reason: `prev5.close ${prev5Close?.toFixed(2) ?? '--'} <= H ${hourHigh?.toFixed(2) ?? '--'} AND current5.close ${current5.close.toFixed(2)} > H`,
      actual: bullishBreakoutCloseCondition ? 'YES' : 'NO',
    },
    {
      name: 'Bearish Breakout (close cross)',
      passed: bearishBreakoutCloseCondition,
      reason: `prev5.close ${prev5Close?.toFixed(2) ?? '--'} >= L ${hourLow?.toFixed(2) ?? '--'} AND current5.close ${current5.close.toFixed(2)} < L`,
      actual: bearishBreakoutCloseCondition ? 'YES' : 'NO',
    },
    {
      name: 'Breakout Candle Stored',
      passed: storedBreakout !== null,
      reason: storedBreakout
        ? `Stored ${storedBreakout.date} H=${storedBreakout.high} L=${storedBreakout.low}`
        : 'No pending breakout candle',
      actual: storedBreakout ? 'YES' : 'NO',
    },
  ];

  const entryChecks: DebugRuleCheck[] = [
    {
      name: 'Follow-Through BUY (high > stored high)',
      passed: followThroughBuy,
      reason: storedBreakout
        ? `current5.high ${current5.high.toFixed(2)} > stored ${storedBreakout.high.toFixed(2)}`
        : 'No stored breakout',
      actual: followThroughBuy ? 'YES' : 'NO',
    },
    {
      name: 'Follow-Through SELL (low < stored low)',
      passed: followThroughSell,
      reason: storedBreakout
        ? `current5.low ${current5.low.toFixed(2)} < stored ${storedBreakout.low.toFixed(2)}`
        : 'No stored breakout',
      actual: followThroughSell ? 'YES' : 'NO',
    },
    {
      name: 'Entry Trigger Hit',
      passed: tradeable,
      reason: tradeable ? evaluatorResult.reason : exactBlockReason,
      actual: tradeable ? 'YES' : 'NO',
    },
  ];

  return {
    timestamp: current5.date,
    tradingDate,
    strategyId: RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT,
    strategyName: STRATEGY_NAME,
    trend: hourBar
      ? {
          passed: usesCompletedHourVerified,
          detectedTrend:
            current5.close > hourBar.close ? 'Bullish' : current5.close < hourBar.close ? 'Bearish' : 'Sideways',
          requiredCondition: 'Previous COMPLETED 1H candle (index length-2)',
          actualResult: `Completed ${hourBar.date} O=${hourBar.open} H=${hourBar.high} L=${hourBar.low} C=${hourBar.close}`,
          reason: usesCompletedHourVerified
            ? 'Using previous completed 1H candle ✓'
            : 'Hour reference verification failed',
          latestSwingHighs: [hourBar.high],
          latestSwingLows: [hourBar.low],
          higherHighCount: 0,
          higherLowCount: 0,
          lowerHighCount: 0,
          lowerLowCount: 0,
          checks: [
            {
              name: 'Previous Completed 1H OHLC',
              passed: true,
              reason: `O=${hourBar.open} H=${hourBar.high} L=${hourBar.low} C=${hourBar.close}`,
            },
            {
              name: 'Forming 1H Candle (NOT used)',
              passed: formingHour !== null && formingHour.date !== hourBar.date,
              reason: formingHour
                ? `Forming ${formingHour.date} — excluded from rules`
                : 'N/A',
            },
          ],
        }
      : emptyTrendDebug('Waiting for completed 1-hour candle reference'),
    structure: {
      passed: hourBar !== null,
      reason: hourBar ? '1H range reference from completed candle' : 'No 1H reference',
      support: hourLow,
      resistance: hourHigh,
      swingHighs: hourHigh !== null ? [hourHigh] : [],
      swingLows: hourLow !== null ? [hourLow] : [],
      trendline: null,
      breakoutLevel: hourHigh,
      retestLevel: hourLow,
      distanceFromSupport: hourLow !== null ? current5.close - hourLow : null,
      distanceFromResistance: hourHigh !== null ? hourHigh - current5.close : null,
      expectedCondition: '5m close crosses 1H high/low with prev5 close on opposite side',
      actualCondition: exactBlockReason,
      checks: [
        {
          name: '5m High vs 1H High',
          passed: hourHigh !== null && current5.high > hourHigh,
          reason: `${current5.high.toFixed(2)} vs ${hourHigh?.toFixed(2) ?? '--'}`,
          actual: current5.high > (hourHigh ?? Infinity) ? 'YES' : 'NO',
        },
        {
          name: '5m Low vs 1H Low',
          passed: hourLow !== null && current5.low < hourLow,
          reason: `${current5.low.toFixed(2)} vs ${hourLow?.toFixed(2) ?? '--'}`,
          actual: current5.low < (hourLow ?? -Infinity) ? 'YES' : 'NO',
        },
      ],
    },
    pullback: { passed: true, reason: 'Not used in Strategy 3', checks: [] },
    breakout: {
      passed: strategy3Details.breakoutDetected,
      reason: strategy3Details.breakoutDetected ? 'Breakout condition met or pending' : exactBlockReason,
      checks: breakoutChecks,
    },
    retest: { passed: true, reason: 'Not used in Strategy 3', checks: [] },
    confirmation: {
      passed: storedBreakout !== null || tradeable,
      reason: storedBreakout ? 'Breakout stored — awaiting follow-through' : 'No breakout stored yet',
      checks: [
        {
          name: 'Pending Direction',
          passed: stateAfterEval.pendingDirection !== null || tradeable,
          reason: stateAfterEval.pendingDirection ?? 'none',
          actual: stateAfterEval.pendingDirection ?? 'none',
        },
      ],
    },
    entry: {
      passed: tradeable,
      reason: tradeable ? evaluatorResult.reason : exactBlockReason,
      entryTrigger: tradeable ? 'REACHED' : 'NOT REACHED',
      checks: entryChecks,
    },
    waitingState,
    finalDecision: evaluatorAction,
    rejectionReason: tradeable ? 'All conditions passed' : exactBlockReason,
    blockingModule,
    strategy3Details,
    strategy3Audit,
  };
}

export type { HourBreakoutState };

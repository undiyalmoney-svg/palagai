import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import {
  detectStructureTrend,
  detectSwingHighs,
  detectSwingLows,
  isBearishCandle,
  isBullishCandle,
  withinPullbackTolerance,
} from '../../strategy-engine/utils/swing-level.util';
import { bodySize, candleRange, trend30m } from '../../strategy-engine/utils/ohlc-candle.util';
import { RESEARCH_STRATEGY_IDS } from '../interfaces/research-strategy.interface';
import { previousCompletedHourBar } from './research-signal.util';
import {
  buildResistanceTrendline,
  buildSupportTrendline,
  detectTrendlineBreakout,
  detectTrendlineRetest,
} from './trendline.util';
import { HourBreakoutState } from '../strategies/hour-breakout/hour-breakout.evaluator';

export interface StrategyDebugStep {
  passed: boolean;
  label: string;
  reason: string;
}

export interface StrategyDebugPanel {
  trend1h: StrategyDebugStep;
  condition30m: StrategyDebugStep;
  condition15m: StrategyDebugStep;
  entry5m: StrategyDebugStep;
  finalDecision: 'BUY' | 'SELL' | 'NO_TRADE';
  rejectionReason: string;
}

function pass(label: string, reason: string): StrategyDebugStep {
  return { passed: true, label, reason };
}

function fail(label: string, reason: string): StrategyDebugStep {
  return { passed: false, label, reason };
}

function finalize(
  steps: Omit<StrategyDebugPanel, 'finalDecision' | 'rejectionReason'>,
  finalDecision: 'BUY' | 'SELL' | 'NO_TRADE',
): StrategyDebugPanel {
  const ordered = [steps.trend1h, steps.condition30m, steps.condition15m, steps.entry5m];
  const blocking = ordered.find((s) => !s.passed);
  return {
    ...steps,
    finalDecision,
    rejectionReason:
      finalDecision === 'NO_TRADE'
        ? blocking?.reason ?? 'No trade signal'
        : 'All conditions passed',
  };
}

export function buildTrendlineBreakoutDebug(ctx: StrategyContext): StrategyDebugPanel {
  const candles60 = [...ctx.previous60m, ctx.candle60m];
  const candles30 = [...ctx.previous30m, ctx.candle30m];
  const candles15 = [...ctx.previous15m, ctx.candle15m];
  const candles5 = [...ctx.previous5m, ctx.candle5m];
  const current = ctx.candle5m;
  const previous = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;

  const trend60 = detectStructureTrend(
    detectSwingHighs(candles60),
    detectSwingLows(candles60),
  );
  const trend30 = trend30m(candles30).trend;

  const trend1h =
    trend60 === 'Sideways'
      ? fail('1H Trend', '60m trend is sideways')
      : pass('1H Trend', `60m trend ${trend60}`);

  const condition30m =
    trend60 === 'Bullish' && trend30 !== 'BUY'
      ? fail('30m Condition', '30m does not confirm bullish 60m trend')
      : trend60 === 'Bearish' && trend30 !== 'SELL'
        ? fail('30m Condition', '30m does not confirm bearish 60m trend')
        : trend60 === 'Sideways'
          ? fail('30m Condition', '60m sideways — 30m not evaluated')
          : pass('30m Condition', `30m confirms ${trend60} bias`);

  if (!previous || candles5.length < 20) {
    return finalize(
      {
        trend1h,
        condition30m,
        condition15m: fail('15m Condition', 'Insufficient 5m history for structure'),
        entry5m: fail('5m Entry Condition', 'Insufficient 5m history'),
      },
      'NO_TRADE',
    );
  }

  const swingHighs = detectSwingHighs(candles5);
  const swingLows = detectSwingLows(candles5);
  const trend5 = detectStructureTrend(swingHighs, swingLows);
  const currentIndex = candles5.length - 1;
  const SCAN = 60;

  let condition15m = fail('15m Condition', 'No trendline breakout + retest');
  let entry5m = fail('5m Entry Condition', 'No confirmation candle');
  let finalDecision: 'BUY' | 'SELL' | 'NO_TRADE' = 'NO_TRADE';

  if (trend5 === 'Bullish') {
    const line = buildSupportTrendline(swingLows);
    if (line) {
      let breakoutIndex = -1;
      for (let i = Math.max(10, currentIndex - SCAN); i < currentIndex; i += 1) {
        if (detectTrendlineBreakout(candles5[i]!, i, line)) {
          breakoutIndex = i;
          break;
        }
      }
      if (breakoutIndex >= 0) {
        let retestOk = false;
        for (let i = breakoutIndex + 1; i < currentIndex; i += 1) {
          if (detectTrendlineRetest(candles5[i]!, i, line)) {
            retestOk = true;
            break;
          }
        }
        condition15m = retestOk
          ? pass('15m Condition', 'Trendline breakout and retest confirmed')
          : fail('15m Condition', 'Waiting for trendline retest');
      } else {
        condition15m = fail('15m Condition', 'No trendline breakout detected');
      }
    } else {
      condition15m = fail('15m Condition', 'No valid support trendline');
    }

    if (isStrongBullishConfirmation(current, previous)) {
      entry5m = pass('5m Entry Condition', 'Bullish confirmation candle');
      if (trend1h.passed && condition30m.passed && condition15m.passed) {
        finalDecision = 'BUY';
      }
    } else {
      entry5m = fail('5m Entry Condition', 'Confirmation candle not valid');
    }
  } else if (trend5 === 'Bearish') {
    const line = buildResistanceTrendline(swingHighs);
    if (line) {
      let breakoutIndex = -1;
      for (let i = Math.max(10, currentIndex - SCAN); i < currentIndex; i += 1) {
        if (detectTrendlineBreakout(candles5[i]!, i, line)) {
          breakoutIndex = i;
          break;
        }
      }
      if (breakoutIndex >= 0) {
        let retestOk = false;
        for (let i = breakoutIndex + 1; i < currentIndex; i += 1) {
          if (detectTrendlineRetest(candles5[i]!, i, line)) {
            retestOk = true;
            break;
          }
        }
        condition15m = retestOk
          ? pass('15m Condition', 'Trendline breakout and retest confirmed')
          : fail('15m Condition', 'Waiting for trendline retest');
      } else {
        condition15m = fail('15m Condition', 'No trendline breakout detected');
      }
    } else {
      condition15m = fail('15m Condition', 'No valid resistance trendline');
    }

    if (isStrongBearishConfirmation(current, previous)) {
      entry5m = pass('5m Entry Condition', 'Bearish confirmation candle');
      if (trend1h.passed && condition30m.passed && condition15m.passed) {
        finalDecision = 'SELL';
      }
    } else {
      entry5m = fail('5m Entry Condition', 'Confirmation candle not valid');
    }
  } else {
    condition15m = fail('15m Condition', 'Sideways 5m structure');
    entry5m = fail('5m Entry Condition', 'No directional setup');
  }

  void candles15;

  return finalize({ trend1h, condition30m, condition15m, entry5m }, finalDecision);
}

export function buildMtfPullbackDebug(ctx: StrategyContext): StrategyDebugPanel {
  const candles60 = [...ctx.previous60m, ctx.candle60m];
  const candles30 = [...ctx.previous30m, ctx.candle30m];
  const candles15 = [...ctx.previous15m, ctx.candle15m];
  const candles5 = [...ctx.previous5m, ctx.candle5m];
  const current5 = ctx.candle5m;
  const previous5 = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;

  const trend60 = detectStructureTrend(
    detectSwingHighs(candles60),
    detectSwingLows(candles60),
  );
  const trend30Result = trend30m(candles30);
  const support30 = detectSwingLows(candles30).at(-1)?.price ?? null;
  const resistance30 = detectSwingHighs(candles30).at(-1)?.price ?? null;

  const trend1h =
    trend60 === 'Sideways'
      ? fail('1H Trend', '60m trend is sideways')
      : pass('1H Trend', `60m trend ${trend60}`);

  let condition30m = fail('30m Condition', '30m does not confirm 60m trend');
  if (trend60 === 'Bullish' && trend30Result.trend === 'BUY') {
    condition30m = pass('30m Condition', '30m bullish — support available');
  } else if (trend60 === 'Bearish' && trend30Result.trend === 'SELL') {
    condition30m = pass('30m Condition', '30m bearish — resistance available');
  } else if (trend60 === 'Sideways') {
    condition30m = fail('30m Condition', '60m sideways');
  }

  let condition15m = fail('15m Condition', 'No 15m pullback detected');
  let entry5m = fail('5m Entry Condition', 'No 5m confirmation');
  let finalDecision: 'BUY' | 'SELL' | 'NO_TRADE' = 'NO_TRADE';

  if (trend60 === 'Bullish' && support30 !== null) {
    const pullback = detectPullbackToLevel(candles15, support30, 'support');
    condition15m = pullback
      ? pass('15m Condition', '15m pullback to 30m support')
      : fail('15m Condition', 'Waiting for 15m pullback to 30m support');

    if (previous5 && isBullishCandle(current5) && bodySize(current5) > bodySize(previous5)) {
      entry5m = pass('5m Entry Condition', '5m bullish confirmation candle');
      if (trend1h.passed && condition30m.passed && condition15m.passed) {
        finalDecision = 'BUY';
      }
    } else {
      entry5m = fail('5m Entry Condition', 'Waiting for 5m bullish confirmation');
    }
  } else if (trend60 === 'Bearish' && resistance30 !== null) {
    const pullback = detectPullbackToLevel(candles15, resistance30, 'resistance');
    condition15m = pullback
      ? pass('15m Condition', '15m pullback to 30m resistance')
      : fail('15m Condition', 'Waiting for 15m pullback to 30m resistance');

    if (previous5 && isBearishCandle(current5) && bodySize(current5) > bodySize(previous5)) {
      entry5m = pass('5m Entry Condition', '5m bearish confirmation candle');
      if (trend1h.passed && condition30m.passed && condition15m.passed) {
        finalDecision = 'SELL';
      }
    } else {
      entry5m = fail('5m Entry Condition', 'Waiting for 5m bearish confirmation');
    }
  }

  return finalize({ trend1h, condition30m, condition15m, entry5m }, finalDecision);
}

export function buildHourBreakoutDebug(
  ctx: StrategyContext,
  state: HourBreakoutState,
): StrategyDebugPanel {
  const current5 = ctx.candle5m;
  const candles5 = [...ctx.previous5m, current5];
  const previous5 = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
  const hourBar = previousCompletedHourBar(ctx);

  const trend1h = hourBar
    ? pass('1H Trend', `Completed 1H bar H ${hourBar.high.toFixed(2)} / L ${hourBar.low.toFixed(2)}`)
    : fail('1H Trend', 'Waiting for completed 1-hour candle');

  const condition30m = hourBar
    ? pass('30m Condition', '1H range reference available')
    : fail('30m Condition', 'No 1H range reference');

  let condition15m = fail('15m Condition', 'No breakout stored');
  if (state.pendingBreakoutCandle && state.pendingDirection) {
    condition15m = pass(
      '15m Condition',
      `${state.pendingDirection} breakout stored — awaiting follow-through`,
    );
  } else if (hourBar && previous5) {
    if (previous5.close <= hourBar.high && current5.close > hourBar.high) {
      condition15m = pass('15m Condition', 'Breakout above 1H high detected');
    } else if (previous5.close >= hourBar.low && current5.close < hourBar.low) {
      condition15m = pass('15m Condition', 'Breakdown below 1H low detected');
    } else {
      condition15m = fail('15m Condition', 'Waiting for 5m close beyond 1H range');
    }
  }

  let entry5m = fail('5m Entry Condition', 'No follow-through entry');
  let finalDecision: 'BUY' | 'SELL' | 'NO_TRADE' = 'NO_TRADE';

  if (state.pendingBreakoutCandle && state.pendingDirection === 'BUY') {
    if (current5.high > state.pendingBreakoutCandle.high) {
      entry5m = pass('5m Entry Condition', 'Follow-through above breakout high');
      if (trend1h.passed && condition30m.passed && condition15m.passed) {
        finalDecision = 'BUY';
      }
    } else {
      entry5m = fail('5m Entry Condition', 'Waiting for follow-through above breakout high');
    }
  } else if (state.pendingBreakoutCandle && state.pendingDirection === 'SELL') {
    if (current5.low < state.pendingBreakoutCandle.low) {
      entry5m = pass('5m Entry Condition', 'Follow-through below breakout low');
      if (trend1h.passed && condition30m.passed && condition15m.passed) {
        finalDecision = 'SELL';
      }
    } else {
      entry5m = fail('5m Entry Condition', 'Waiting for follow-through below breakout low');
    }
  }

  return finalize({ trend1h, condition30m, condition15m, entry5m }, finalDecision);
}

export function buildResearchStrategyDebug(
  strategyId: string,
  ctx: StrategyContext,
  hourState?: HourBreakoutState,
): StrategyDebugPanel | null {
  switch (strategyId) {
    case RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT:
      return buildTrendlineBreakoutDebug(ctx);
    case RESEARCH_STRATEGY_IDS.MTF_PULLBACK:
      return buildMtfPullbackDebug(ctx);
    case RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT:
      return hourState ? buildHourBreakoutDebug(ctx, hourState) : null;
    default:
      return null;
  }
}

function detectPullbackToLevel(
  candles15: Candle[],
  level: number,
  side: 'support' | 'resistance',
): boolean {
  const window = candles15.slice(-8);
  return window.some((c) =>
    side === 'support'
      ? withinPullbackTolerance(c.low, level)
      : withinPullbackTolerance(c.high, level),
  );
}

function isStrongBullishConfirmation(current: Candle, previous: Candle): boolean {
  const range = candleRange(current);
  return (
    isBullishCandle(current) &&
    bodySize(current) > bodySize(previous) &&
    range > 0 &&
    current.close >= current.low + range * 0.6
  );
}

function isStrongBearishConfirmation(current: Candle, previous: Candle): boolean {
  const range = candleRange(current);
  return (
    isBearishCandle(current) &&
    bodySize(current) > bodySize(previous) &&
    range > 0 &&
    current.close <= current.high - range * 0.6
  );
}

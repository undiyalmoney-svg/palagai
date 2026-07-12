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
import {
  calcTargets,
  extractTradingDate,
  noTradeResult,
} from '../../shared/research-signal.util';

export function runMultiTimeframePullback(ctx: StrategyContext): ResearchStrategyResult {
  const candles60 = [...ctx.previous60m, ctx.candle60m];
  const candles30 = [...ctx.previous30m, ctx.candle30m];
  const candles15 = [...ctx.previous15m, ctx.candle15m];
  const candles5 = [...ctx.previous5m, ctx.candle5m];
  const current5 = ctx.candle5m;
  const previous5 = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
  const tradingDate = extractTradingDate(current5.date);

  if (!previous5 || candles60.length < 8 || candles30.length < 6 || candles15.length < 6) {
    return noTradeResult(current5, 'Insufficient multi-timeframe OHLC history');
  }

  const trend60 = detectStructureTrend(detectSwingHighs(candles60), detectSwingLows(candles60));
  const trend30Result = trend30m(candles30);
  const support30 = detectSwingLows(candles30).at(-1)?.price ?? null;
  const resistance30 = detectSwingHighs(candles30).at(-1)?.price ?? null;

  if (trend60 === 'Bullish' && trend30Result.trend !== 'BUY') {
    return noTradeResult(current5, '30m does not confirm bullish 60m trend', { trend60, strategy: 'MTF Pullback' });
  }
  if (trend60 === 'Bearish' && trend30Result.trend !== 'SELL') {
    return noTradeResult(current5, '30m does not confirm bearish 60m trend', { trend60, strategy: 'MTF Pullback' });
  }
  if (trend60 === 'Sideways') {
    return noTradeResult(current5, '60m trend sideways', { trend60, strategy: 'MTF Pullback' });
  }

  if (trend60 === 'Bullish') {
    if (support30 === null) {
      return noTradeResult(current5, 'No 30m support identified', { trend60 });
    }

    const pullback15 = detectPullbackToLevel(candles15, support30, 'support');
    if (!pullback15) {
      return noTradeResult(current5, 'Waiting for 15m pullback to 30m support', { trend60, support30 });
    }

    if (!isBullishCandle(current5) || bodySize(current5) <= bodySize(previous5)) {
      return noTradeResult(current5, 'Waiting for 5m bullish confirmation', { pullback15: true });
    }

    const entryPrice = entryAboveHigh(current5);
    const stopLoss = pullback15.low - safetyBuffer(entryPrice);
    const structural = nearestResistanceAbove(
      entryPrice,
      detectSwingHighs(candles5)
        .slice(-5)
        .map((s) => s.price),
    );
    const { target, riskRewardRatio } = calcTargets({
      direction: 'BUY',
      entryPrice,
      stopLoss,
      structuralTarget: structural,
    });

    if (riskRewardRatio < 2) {
      return noTradeResult(current5, 'Risk reward below 1:2', { riskRewardRatio });
    }

    return {
      action: 'BUY',
      entryPrice,
      stopLoss,
      target,
      riskRewardRatio,
      reason: '60m bullish + 30m support + 15m pullback + 5m confirmation',
      analysis: {
        strategy: 'Multi Timeframe Pullback',
        tradingDate,
        trend60: 'Bullish',
        trend30: 'Bullish',
        support: support30,
        pullback: 'YES',
        confirmation: 'YES',
      },
    };
  }

  if (resistance30 === null) {
    return noTradeResult(current5, 'No 30m resistance identified', { trend60: 'Bearish' });
  }

  const pullback15 = detectPullbackToLevel(candles15, resistance30, 'resistance');
  if (!pullback15) {
    return noTradeResult(current5, 'Waiting for 15m pullback to 30m resistance', { resistance30 });
  }

  if (!isBearishCandle(current5) || bodySize(current5) <= bodySize(previous5)) {
    return noTradeResult(current5, 'Waiting for 5m bearish confirmation', { pullback15: true });
  }

  const entryPrice = current5.low - 0.05;
  const stopLoss = pullback15.high + safetyBuffer(entryPrice);
  const structural = nearestSupportBelow(
    entryPrice,
    detectSwingLows(candles5)
      .slice(-5)
      .map((s) => s.price),
  );
  const { target, riskRewardRatio } = calcTargets({
    direction: 'SELL',
    entryPrice,
    stopLoss,
    structuralTarget: structural,
  });

  if (riskRewardRatio < 2) {
    return noTradeResult(current5, 'Risk reward below 1:2', { riskRewardRatio });
  }

  return {
    action: 'SELL',
    entryPrice,
    stopLoss,
    target,
    riskRewardRatio,
    reason: '60m bearish + 30m resistance + 15m pullback + 5m confirmation',
    analysis: {
      strategy: 'Multi Timeframe Pullback',
      tradingDate,
      trend60: 'Bearish',
      trend30: 'Bearish',
      resistance: resistance30,
      pullback: 'YES',
      confirmation: 'YES',
    },
  };
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

function entryAboveHigh(candle: Candle): number {
  return candle.high + 0.05;
}

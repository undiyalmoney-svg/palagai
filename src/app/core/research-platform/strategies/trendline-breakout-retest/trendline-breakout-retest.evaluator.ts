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
import { ResearchStrategyResult } from '../../interfaces/research-strategy.interface';
import {
  calcTargets,
  extractTradingDate,
  noTradeResult,
} from '../../shared/research-signal.util';
import {
  buildResistanceTrendline,
  buildSupportTrendline,
  detectTrendlineBreakout,
  detectTrendlineRetest,
  entryAboveHigh,
  entryBelowLow,
} from '../../shared/trendline.util';

const SCAN = 60;

export function runTrendlineBreakoutRetest(ctx: StrategyContext): ResearchStrategyResult {
  const candles5 = [...ctx.previous5m, ctx.candle5m];
  const current = ctx.candle5m;
  const previous = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
  const tradingDate = extractTradingDate(current.date);

  if (!previous || candles5.length < 20) {
    return noTradeResult(current, 'Insufficient 5m OHLC history');
  }

  const swingHighs = detectSwingHighs(candles5);
  const swingLows = detectSwingLows(candles5);
  const trend = detectStructureTrend(swingHighs, swingLows);
  const currentIndex = candles5.length - 1;

  if (trend === 'Bullish') {
    const line = buildSupportTrendline(swingLows);
    if (!line) {
      return noTradeResult(current, 'No valid support trendline', { trend, strategy: 'Trendline Breakout + Retest' });
    }

    let breakoutIndex = -1;
    for (let i = Math.max(10, currentIndex - SCAN); i < currentIndex; i += 1) {
      if (detectTrendlineBreakout(candles5[i]!, i, line)) {
        breakoutIndex = i;
        break;
      }
    }
    if (breakoutIndex < 0) {
      return noTradeResult(current, 'No trendline breakout detected', { trend, strategy: 'Trendline Breakout + Retest' });
    }

    let retestOk = false;
    for (let i = breakoutIndex + 1; i < currentIndex; i += 1) {
      if (detectTrendlineRetest(candles5[i]!, i, line)) {
        retestOk = true;
        break;
      }
    }
    if (!retestOk) {
      return noTradeResult(current, 'Waiting for trendline retest', { trend, breakout: true, retest: false });
    }

    if (!isStrongBullishConfirmation(current, previous)) {
      return noTradeResult(current, 'Confirmation candle not valid', { trend, retest: true });
    }

    const entryPrice = entryAboveHigh(current);
    const stopLoss = current.low - safetyBuffer(entryPrice);
    const structural = nearestResistanceAbove(
      entryPrice,
      swingHighs.slice(-5).map((s) => s.price),
    );
    const { target, riskRewardRatio } = calcTargets({
      direction: 'BUY',
      entryPrice,
      stopLoss,
      structuralTarget: structural,
    });

    if (riskRewardRatio < 2) {
      return noTradeResult(current, 'Risk reward below 1:2', { trend, riskRewardRatio });
    }

    return {
      action: 'BUY',
      entryPrice,
      stopLoss,
      target,
      riskRewardRatio,
      reason: 'Trendline breakout + retest + bullish confirmation',
      analysis: {
        strategy: 'Trendline Breakout + Retest',
        tradingDate,
        trend,
        structure: 'Support trendline breakout',
        pullback: 'Retest held',
        breakout: 'YES',
        retest: 'YES',
        confirmation: 'YES',
      },
    };
  }

  if (trend === 'Bearish') {
    const line = buildResistanceTrendline(swingHighs);
    if (!line) {
      return noTradeResult(current, 'No valid resistance trendline', { trend, strategy: 'Trendline Breakout + Retest' });
    }

    let breakoutIndex = -1;
    for (let i = Math.max(10, currentIndex - SCAN); i < currentIndex; i += 1) {
      if (detectTrendlineBreakout(candles5[i]!, i, line)) {
        breakoutIndex = i;
        break;
      }
    }
    if (breakoutIndex < 0) {
      return noTradeResult(current, 'No trendline breakout detected', { trend });
    }

    let retestOk = false;
    for (let i = breakoutIndex + 1; i < currentIndex; i += 1) {
      if (detectTrendlineRetest(candles5[i]!, i, line)) {
        retestOk = true;
        break;
      }
    }
    if (!retestOk) {
      return noTradeResult(current, 'Waiting for trendline retest', { trend, retest: false });
    }

    if (!isStrongBearishConfirmation(current, previous)) {
      return noTradeResult(current, 'Confirmation candle not valid', { trend, retest: true });
    }

    const entryPrice = entryBelowLow(current);
    const stopLoss = current.high + safetyBuffer(entryPrice);
    const structural = nearestSupportBelow(
      entryPrice,
      swingLows.slice(-5).map((s) => s.price),
    );
    const { target, riskRewardRatio } = calcTargets({
      direction: 'SELL',
      entryPrice,
      stopLoss,
      structuralTarget: structural,
    });

    if (riskRewardRatio < 2) {
      return noTradeResult(current, 'Risk reward below 1:2', { riskRewardRatio });
    }

    return {
      action: 'SELL',
      entryPrice,
      stopLoss,
      target,
      riskRewardRatio,
      reason: 'Trendline breakout + retest + bearish confirmation',
      analysis: {
        strategy: 'Trendline Breakout + Retest',
        tradingDate,
        trend,
        structure: 'Resistance trendline breakout',
        pullback: 'Retest held',
        breakout: 'YES',
        retest: 'YES',
        confirmation: 'YES',
      },
    };
  }

  return noTradeResult(current, 'Sideways market — NO TRADE', { trend: 'Sideways', strategy: 'Trendline Breakout + Retest' });
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

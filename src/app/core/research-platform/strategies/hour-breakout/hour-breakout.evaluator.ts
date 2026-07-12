import { Candle } from '../../../models/candle.model';
import { StrategyContext } from '../../../strategy-engine/models/strategy-context.model';
import { ResearchStrategyResult } from '../../interfaces/research-strategy.interface';
import {
  calcTargets,
  extractTradingDate,
  noTradeResult,
  previousCompletedHourBar,
} from '../../shared/research-signal.util';

const MIN_TICK = 0.05;

export interface HourBreakoutState {
  pendingBreakoutCandle: Candle | null;
  pendingDirection: 'BUY' | 'SELL' | null;
  hourBarKey: string | null;
}

export function createHourBreakoutState(): HourBreakoutState {
  return { pendingBreakoutCandle: null, pendingDirection: null, hourBarKey: null };
}

export function runHourBreakout(
  ctx: StrategyContext,
  state: HourBreakoutState,
): ResearchStrategyResult {
  const current5 = ctx.candle5m;
  const candles5 = [...ctx.previous5m, current5];
  const previous5 = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
  const hourBar = previousCompletedHourBar(ctx);
  const tradingDate = extractTradingDate(current5.date);

  if (!hourBar || !previous5) {
    return noTradeResult(current5, 'Waiting for completed 1-hour candle reference', {
      strategy: '1 Hour Breakout',
    });
  }

  const hourKey = hourBar.date;

  if (state.hourBarKey !== hourKey) {
    state.pendingBreakoutCandle = null;
    state.pendingDirection = null;
    state.hourBarKey = hourKey;
  }

  if (state.pendingBreakoutCandle && state.pendingDirection === 'BUY') {
    if (current5.high > state.pendingBreakoutCandle.high) {
      const entryPrice = state.pendingBreakoutCandle.high + MIN_TICK;
      const stopLoss = state.pendingBreakoutCandle.low;
      const { target, riskRewardRatio } = calcTargets({
        direction: 'BUY',
        entryPrice,
        stopLoss,
        structuralTarget: null,
      });
      if (riskRewardRatio < 2) {
        state.pendingBreakoutCandle = null;
        state.pendingDirection = null;
        return noTradeResult(current5, 'Risk reward below 1:2', { riskRewardRatio });
      }
      state.pendingBreakoutCandle = null;
      state.pendingDirection = null;
      return {
        action: 'BUY',
        entryPrice,
        stopLoss,
        target,
        riskRewardRatio,
        reason: '1H high breakout — follow-through on 5m',
        analysis: {
          strategy: '1 Hour Breakout',
          tradingDate,
          hourHigh: hourBar.high,
          hourLow: hourBar.low,
          breakout: 'YES',
          followThrough: 'YES',
        },
      };
    }
    return noTradeResult(current5, 'Waiting for 5m follow-through above breakout high', {
      strategy: '1 Hour Breakout',
      pendingBreakout: true,
    });
  }

  if (state.pendingBreakoutCandle && state.pendingDirection === 'SELL') {
    if (current5.low < state.pendingBreakoutCandle.low) {
      const entryPrice = state.pendingBreakoutCandle.low - MIN_TICK;
      const stopLoss = state.pendingBreakoutCandle.high;
      const { target, riskRewardRatio } = calcTargets({
        direction: 'SELL',
        entryPrice,
        stopLoss,
        structuralTarget: null,
      });
      if (riskRewardRatio < 2) {
        state.pendingBreakoutCandle = null;
        state.pendingDirection = null;
        return noTradeResult(current5, 'Risk reward below 1:2', { riskRewardRatio });
      }
      state.pendingBreakoutCandle = null;
      state.pendingDirection = null;
      return {
        action: 'SELL',
        entryPrice,
        stopLoss,
        target,
        riskRewardRatio,
        reason: '1H low breakdown — follow-through on 5m',
        analysis: {
          strategy: '1 Hour Breakout',
          tradingDate,
          hourHigh: hourBar.high,
          hourLow: hourBar.low,
          breakout: 'YES',
          followThrough: 'YES',
        },
      };
    }
    return noTradeResult(current5, 'Waiting for 5m follow-through below breakout low', {
      strategy: '1 Hour Breakout',
      pendingBreakout: true,
    });
  }

  if (previous5.close <= hourBar.high && current5.close > hourBar.high) {
    state.pendingBreakoutCandle = { ...current5 };
    state.pendingDirection = 'BUY';
    return noTradeResult(current5, 'Breakout above 1H high — waiting follow-through', {
      strategy: '1 Hour Breakout',
      hourHigh: hourBar.high,
      breakoutStored: true,
    });
  }

  if (previous5.close >= hourBar.low && current5.close < hourBar.low) {
    state.pendingBreakoutCandle = { ...current5 };
    state.pendingDirection = 'SELL';
    return noTradeResult(current5, 'Breakdown below 1H low — waiting follow-through', {
      strategy: '1 Hour Breakout',
      hourLow: hourBar.low,
      breakoutStored: true,
    });
  }

  return noTradeResult(current5, 'Waiting for 5m close beyond previous 1H range', {
    strategy: '1 Hour Breakout',
    hourHigh: hourBar.high,
    hourLow: hourBar.low,
    hourOpen: hourBar.open,
    hourClose: hourBar.close,
  });
}

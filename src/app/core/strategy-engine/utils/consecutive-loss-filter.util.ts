import { Candle } from '../../models/candle.model';
import { MomentumScoreResult } from './momentum-score.util';
import { last3HigherHighHigherLow, last3LowerHighLowerLow } from './ohlc-candle.util';

export interface ConsecutiveLossFilterState {
  consecutiveLosses: number;
  tradingPaused: boolean;
}

export interface ConsecutiveLossFilterResult {
  allowed: boolean;
  consecutiveLosses: number;
  tradingPaused: boolean;
  reason: string;
}

export function createConsecutiveLossState(): ConsecutiveLossFilterState {
  return { consecutiveLosses: 0, tradingPaused: false };
}

export function recordTradeOutcome(
  state: ConsecutiveLossFilterState,
  outcome: 'WIN' | 'LOSS',
  exitReason: string,
): void {
  const stopLossHit = exitReason.toLowerCase().includes('stop loss');
  if (outcome === 'LOSS' && stopLossHit) {
    state.consecutiveLosses += 1;
    if (state.consecutiveLosses >= 2) {
      state.tradingPaused = true;
    }
    return;
  }

  if (outcome === 'WIN') {
    state.consecutiveLosses = 0;
  }
}

export function evaluateConsecutiveLossFilter(
  state: ConsecutiveLossFilterState,
  momentum: MomentumScoreResult | null,
  candles5: Candle[],
): ConsecutiveLossFilterResult {
  if (!state.tradingPaused) {
    return {
      allowed: true,
      consecutiveLosses: state.consecutiveLosses,
      tradingPaused: false,
      reason: 'Consecutive loss filter clear',
    };
  }

  const maxScore = momentum ? Math.max(momentum.bullishScore, momentum.bearishScore) : 0;
  const freshBullish = last3HigherHighHigherLow(candles5);
  const freshBearish = last3LowerHighLowerLow(candles5);

  if (maxScore === 5) {
    state.tradingPaused = false;
    return {
      allowed: true,
      consecutiveLosses: state.consecutiveLosses,
      tradingPaused: false,
      reason: 'Trading resumed — momentum score returned to maximum (5)',
    };
  }

  if (freshBullish) {
    state.tradingPaused = false;
    return {
      allowed: true,
      consecutiveLosses: state.consecutiveLosses,
      tradingPaused: false,
      reason: 'Trading resumed — fresh Higher High + Higher Low structure',
    };
  }

  if (freshBearish) {
    state.tradingPaused = false;
    return {
      allowed: true,
      consecutiveLosses: state.consecutiveLosses,
      tradingPaused: false,
      reason: 'Trading resumed — fresh Lower High + Lower Low structure',
    };
  }

  return {
    allowed: false,
    consecutiveLosses: state.consecutiveLosses,
    tradingPaused: true,
    reason: `Trading paused after ${state.consecutiveLosses} consecutive stop losses`,
  };
}

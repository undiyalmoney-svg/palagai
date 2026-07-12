import { Candle } from '../../models/candle.model';
import { OpenTrade } from '../models/open-trade.model';
import { ExitResult } from '../models/module-result.model';
import {
  validateBearishConfirmationForExit,
  validateBullishConfirmationForExit,
} from './smart-price-action-reversal.util';

export interface SparTradeContext {
  direction: OpenTrade['direction'];
  structureReferenceLow: number;
  structureReferenceHigh: number;
}

export function createSparTradeContext(params: {
  trade: OpenTrade;
  structureReferenceLow: number;
  structureReferenceHigh: number;
}): SparTradeContext {
  return {
    direction: params.trade.direction,
    structureReferenceLow: params.structureReferenceLow,
    structureReferenceHigh: params.structureReferenceHigh,
  };
}

export function evaluateSparEarlyExit(params: {
  context: SparTradeContext;
  candle: Candle;
  previousCandle: Candle | null;
  trade: OpenTrade;
}): ExitResult | null {
  const { context, candle, previousCandle, trade } = params;

  if (context.direction === 'BUY') {
    if (candle.low < context.structureReferenceLow) {
      return exitAt(candle, trade, 'Structure break — Higher Low violated');
    }
    if (previousCandle && validateBearishConfirmationForExit(candle, previousCandle)) {
      return exitAt(candle, trade, 'Strong opposite bearish confirmation candle');
    }
  } else {
    if (candle.high > context.structureReferenceHigh) {
      return exitAt(candle, trade, 'Structure break — Lower High violated');
    }
    if (previousCandle && validateBullishConfirmationForExit(candle, previousCandle)) {
      return exitAt(candle, trade, 'Strong opposite bullish confirmation candle');
    }
  }

  return null;
}

function exitAt(candle: Candle, trade: OpenTrade, reason: string): ExitResult {
  const exitPrice = candle.close;
  const points =
    trade.direction === 'BUY' ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;

  return {
    shouldExit: true,
    exitPrice,
    exitReason: reason,
    outcome: points >= 0 ? 'WIN' : 'LOSS',
  };
}

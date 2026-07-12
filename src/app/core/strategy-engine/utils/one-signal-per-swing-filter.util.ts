import { Candle } from '../../models/candle.model';
import { TradeDirection } from '../../models/historical-test.model';
import { last3HigherHighHigherLow, last3LowerHighLowerLow } from './ohlc-candle.util';
import { isLongSignal, isShortSignal, SignalAction } from '../models/module-result.model';

export interface OneSignalPerSwingState {
  buyBlockedUntilNewSwing: boolean;
  sellBlockedUntilNewSwing: boolean;
}

export interface OneSignalPerSwingFilterResult {
  allowed: boolean;
  buyBlocked: boolean;
  sellBlocked: boolean;
  reason: string;
}

export function createOneSignalPerSwingState(): OneSignalPerSwingState {
  return {
    buyBlockedUntilNewSwing: false,
    sellBlockedUntilNewSwing: false,
  };
}

export function onMomentumTradeClosed(
  state: OneSignalPerSwingState,
  direction: TradeDirection,
): void {
  if (direction === 'BUY') {
    state.buyBlockedUntilNewSwing = true;
  } else {
    state.sellBlockedUntilNewSwing = true;
  }
}

export function updateSwingRelease(state: OneSignalPerSwingState, candles5: Candle[]): void {
  if (state.buyBlockedUntilNewSwing && last3HigherHighHigherLow(candles5)) {
    state.buyBlockedUntilNewSwing = false;
  }
  if (state.sellBlockedUntilNewSwing && last3LowerHighLowerLow(candles5)) {
    state.sellBlockedUntilNewSwing = false;
  }
}

export function evaluateOneSignalPerSwingFilter(
  state: OneSignalPerSwingState,
  signalType: SignalAction,
  candles5: Candle[],
): OneSignalPerSwingFilterResult {
  updateSwingRelease(state, candles5);

  if (isLongSignal(signalType) && state.buyBlockedUntilNewSwing) {
    return {
      allowed: false,
      buyBlocked: true,
      sellBlocked: state.sellBlockedUntilNewSwing,
      reason: 'One signal per swing — waiting for new bullish swing after prior BUY',
    };
  }

  if (isShortSignal(signalType) && state.sellBlockedUntilNewSwing) {
    return {
      allowed: false,
      buyBlocked: state.buyBlockedUntilNewSwing,
      sellBlocked: true,
      reason: 'One signal per swing — waiting for new bearish swing after prior SELL',
    };
  }

  return {
    allowed: true,
    buyBlocked: state.buyBlockedUntilNewSwing,
    sellBlocked: state.sellBlockedUntilNewSwing,
    reason: 'One signal per swing filter clear',
  };
}

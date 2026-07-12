export type StrategyEventType =
  | 'TREND_DETECTED'
  | 'BOS_CONFIRMED'
  | 'PULLBACK_FOUND'
  | 'ENTRY_SIGNAL'
  | 'TRADE_OPENED'
  | 'TARGET_HIT'
  | 'STOP_LOSS_HIT'
  | 'TRADE_CLOSED'
  | 'WAIT_SIGNAL';

export interface StrategyEvent {
  timestamp: string;
  strategyName: string;
  eventType: StrategyEventType;
  message: string;
}

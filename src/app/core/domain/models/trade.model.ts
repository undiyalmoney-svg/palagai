export type TradeDirection = 'BUY' | 'SELL';
export type TradeOutcome = 'WIN' | 'LOSS';
export type TradeStatus = 'open' | 'closed' | 'stopped' | 'target_hit';

/** Standardized closed trade record. */
export interface Trade {
  id: string;
  testId: string;
  strategyId: string;
  strategyName: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  targetPrice: number;
  direction: TradeDirection;
  points: number;
  profitLoss: number;
  confidence: number;
  entryReason: string;
  exitReason: string;
  holdingMinutes: number;
  status: TradeStatus;
  outcome: TradeOutcome;
}

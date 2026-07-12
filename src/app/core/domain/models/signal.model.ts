export type SignalAction = 'BUY' | 'SELL' | 'NO_TRADE';

export interface DebugInformation {
  strategyId: string;
  timestamp: string;
  modules: Record<string, unknown>;
  blockingReasons: string[];
  metadata?: Record<string, unknown>;
}

/** Standardized signal emitted by every strategy plugin. */
export interface Signal {
  action: SignalAction;
  entryPrice: number;
  stopLoss: number;
  target: number;
  confidence: number;
  riskRewardRatio: number;
  reason: string;
  debug: DebugInformation;
}

export function isTradeableSignal(action: SignalAction): boolean {
  return action === 'BUY' || action === 'SELL';
}

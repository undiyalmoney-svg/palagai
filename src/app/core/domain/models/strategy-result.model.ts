import { Signal, SignalAction } from './signal.model';

/** Result returned by strategy evaluation before trade execution. */
export interface StrategyResult {
  action: SignalAction;
  entryPrice: number;
  stopLoss: number;
  target: number;
  confidence: number;
  riskRewardRatio: number;
  reason: string;
  analysis: Record<string, unknown>;
}

export function toStrategyResult(signal: Signal): StrategyResult {
  return {
    action: signal.action,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    target: signal.target,
    confidence: signal.confidence,
    riskRewardRatio: signal.riskRewardRatio,
    reason: signal.reason,
    analysis: signal.debug.metadata ?? {},
  };
}

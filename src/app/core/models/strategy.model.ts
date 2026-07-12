export type StopLossMethod = 'fixed_points' | 'percent' | 'atr';
export type TargetMethod = 'fixed_points' | 'risk_reward' | 'percent';
export type StrategyType = 'ema_crossover' | 'rsi_momentum' | 'breakout_structure';

export interface StrategyRules {
  trend: Record<string, number | string | boolean>;
  pattern: Record<string, number | string | boolean>;
  momentum: Record<string, number | string | boolean>;
  marketStructure: Record<string, number | string | boolean>;
  volume: Record<string, number | string | boolean>;
  entry: Record<string, number | string | boolean>;
  exit: Record<string, number | string | boolean>;
  confidence: Record<string, number | string | boolean>;
}

export interface Strategy {
  id: string;
  version: number;
  name: string;
  description: string;
  enabled: boolean;
  type: StrategyType;
  stopLossMethod: StopLossMethod;
  stopLossValue: number;
  targetMethod: TargetMethod;
  targetValue: number;
  riskRewardRatio: number;
  rules: StrategyRules;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface StrategySnapshot extends Strategy {
  snapshotVersion: number;
  snapshotAt: string;
}

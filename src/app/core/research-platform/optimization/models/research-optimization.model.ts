import { StrategyContext } from '../../../strategy-engine/models/strategy-context.model';
import { ResearchStrategyResult } from '../../interfaces/research-strategy.interface';

export interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  reason: string;
}

export interface RuleGateResult {
  allowed: boolean;
  evaluations: RuleEvaluation[];
  blockingRules: string[];
  blockingReasons: string[];
}

export interface RuleDefinition {
  id: string;
  name: string;
  category: 'Trend' | 'Structure' | 'Entry' | 'Filter' | 'Risk' | 'Time' | 'Exit';
  description: string;
  evaluate: (ctx: RuleContext) => RuleEvaluation;
}

export interface RuleContext {
  strategyContext: StrategyContext;
  rawSignal: ResearchStrategyResult;
  tradedToday: boolean;
}

export interface SignalDecisionRecord {
  timestamp: string;
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  allowed: boolean;
  blockingRules: string[];
  evaluations: RuleEvaluation[];
  reason: string;
}

export interface RuleCombinationStats {
  combinationId: string;
  ruleIds: string[];
  ruleLabels: string[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  profitFactor: number;
  maxDrawdown: number;
  averageWin: number;
  averageLoss: number;
  averageHoldingMinutes: number;
  bestTrade: number;
  worstTrade: number;
  rank: number;
  trades: import('../../../models/historical-test.model').HistoricalTrade[];
  signalDecisions: SignalDecisionRecord[];
  rejectionCounts: Record<string, number>;
}

export interface RuleCombinationAnalysis {
  topCombinations: RuleCombinationStats[];
  winningRuleFrequency: { ruleId: string; ruleName: string; count: number; percentage: number }[];
  losingRuleFrequency: { ruleId: string; ruleName: string; count: number; percentage: number }[];
  recommendations: string[];
}

export interface ResearchOptimizationRun {
  id: string;
  createdAt: string;
  instrumentToken: number;
  instrumentSymbol: string;
  fromDateTime: string;
  toDateTime: string;
  baseStrategyId: string;
  baseStrategyName: string;
  selectedRuleIds: string[];
  combinationsTested: number;
  combinationResults: RuleCombinationStats[];
  analysis: RuleCombinationAnalysis;
  status: 'completed' | 'cancelled' | 'failed';
  durationMs: number;
}

export type ResearchBaseStrategyId =
  | 'pa-research-trendline-breakout'
  | 'pa-research-mtf-pullback'
  | 'pa-research-hour-breakout';

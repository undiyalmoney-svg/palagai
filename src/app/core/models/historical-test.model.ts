import { StrategySnapshot } from './strategy.model';
import { Timeframe } from './candle.model';
import { LossPatternAnalysis } from '../strategy-engine/models/loss-pattern.model';

export type ReplayStatus = 'completed' | 'running' | 'failed' | 'cancelled';
export type TradeDirection = 'BUY' | 'SELL';
export type TradeStatus = 'open' | 'closed' | 'stopped' | 'target_hit';
export type TradeOutcome = 'WIN' | 'LOSS';

export interface HistoricalTrade {
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
  /** Market regime on the entry day when the trade was opened. */
  marketRegime?: string;
}

export interface ModuleCheckStatistics {
  name: string;
  passed: number;
  failed: number;
}

export interface StrategyTestResult {
  strategyId: string;
  strategyName: string;
  strategyVersion: number;
  strategySnapshot: StrategySnapshot;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winPercentage: number;
  netPoints: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  averageProfitPerTrade: number;
  averageLossPerTrade: number;
  averageRiskRewardRatio: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  averageHoldingMinutes: number;
  averagePointsCaptured: number;
  resultLabel: 'Profit' | 'Loss' | 'Neutral';
  rank: number;
  moduleStatistics?: ModuleCheckStatistics[];
}

export interface HistoricalTest {
  id: string;
  replayDate: string;
  instrumentToken: number;
  instrumentSymbol: string;
  fromDateTime: string;
  toDateTime: string;
  timeframesUsed: Timeframe[];
  replaySpeedMs: number;
  replayDurationMs: number;
  startTime: string;
  endTime: string;
  totalCandlesProcessed: number;
  status: ReplayStatus;
  createdAt: string;
  strategyResults: StrategyTestResult[];
  trades: HistoricalTrade[];
  bestStrategyName: string;
  lossPatternAnalysis?: LossPatternAnalysis;
  marketRegimeSummary?: import('../reporting/utils/market-regime-report.util').MarketRegimeSummary;
}

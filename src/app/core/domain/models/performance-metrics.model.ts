import { ModuleCheckStatistics } from '../../models/historical-test.model';

/** Aggregated performance metrics for a strategy run. */
export interface PerformanceMetrics {
  strategyId: string;
  strategyName: string;
  strategyVersion: number;
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
  moduleStatistics?: ModuleCheckStatistics[];
}

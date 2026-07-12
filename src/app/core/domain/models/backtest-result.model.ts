import { Timeframe } from '../../models/candle.model';
import { HistoricalTest, HistoricalTrade, StrategyTestResult } from '../../models/historical-test.model';
import { PerformanceMetrics } from './performance-metrics.model';
import { Trade } from './trade.model';
import { CandleDataset } from '../../strategy-engine/models/candle-dataset.model';

export type BacktestStatus = 'completed' | 'running' | 'failed' | 'cancelled';

export interface BacktestRunConfig {
  instrumentToken: number;
  instrumentSymbol: string;
  fromDateTime: string;
  toDateTime: string;
  lookbackDays?: number;
  strategyIds?: string[];
  instrumentId?: string;
  exchange?: string;
}

export interface BacktestRunResult {
  id: string;
  instrumentToken: number;
  instrumentSymbol: string;
  fromDateTime: string;
  toDateTime: string;
  timeframesUsed: Timeframe[];
  totalCandlesProcessed: number;
  durationMs: number;
  status: BacktestStatus;
  strategyMetrics: PerformanceMetrics[];
  trades: Trade[];
  bestStrategyName: string;
  dataset?: CandleDataset;
  marketRegimeSummary?: import('../../reporting/utils/market-regime-report.util').MarketRegimeSummary;
}

/** Maps domain backtest result to persisted HistoricalTest shape. */
export function toHistoricalTest(
  result: BacktestRunResult,
  extras?: Partial<HistoricalTest>,
): HistoricalTest {
  const strategyResults: StrategyTestResult[] = result.strategyMetrics.map((m) => ({
    strategyId: m.strategyId,
    strategyName: m.strategyName,
    strategyVersion: m.strategyVersion,
    strategySnapshot: {
      id: m.strategyId,
      version: m.strategyVersion,
      name: m.strategyName,
      description: '',
      enabled: true,
      type: 'breakout_structure' as const,
      stopLossMethod: 'fixed_points' as const,
      stopLossValue: 0,
      targetMethod: 'risk_reward' as const,
      targetValue: 0,
      riskRewardRatio: 0,
      rules: {
        trend: {},
        pattern: {},
        momentum: {},
        marketStructure: {},
        volume: {},
        entry: {},
        exit: {},
        confidence: {},
      },
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      snapshotVersion: 1,
      snapshotAt: new Date().toISOString(),
    },
    totalTrades: m.totalTrades,
    winningTrades: m.winningTrades,
    losingTrades: m.losingTrades,
    winPercentage: m.winRate,
    netPoints: m.netProfit,
    grossProfit: m.grossProfit,
    grossLoss: m.grossLoss,
    netProfit: m.netProfit,
    averageProfitPerTrade: m.averageWin,
    averageLossPerTrade: m.averageLoss,
    averageRiskRewardRatio: 0,
    largestWin: m.bestTrade,
    largestLoss: m.worstTrade,
    profitFactor: m.profitFactor,
    maxDrawdown: m.maxDrawdown,
    averageHoldingMinutes: m.averageHoldingMinutes,
    averagePointsCaptured: m.totalTrades ? m.netProfit / m.totalTrades : 0,
    resultLabel: m.netProfit > 0 ? 'Profit' : m.netProfit < 0 ? 'Loss' : 'Neutral',
    rank: m.rank,
    moduleStatistics: m.moduleStatistics,
  }));

  const trades: HistoricalTrade[] = result.trades as HistoricalTrade[];

  return {
    id: result.id,
    replayDate: result.fromDateTime.slice(0, 10),
    instrumentToken: result.instrumentToken,
    instrumentSymbol: result.instrumentSymbol,
    fromDateTime: result.fromDateTime,
    toDateTime: result.toDateTime,
    timeframesUsed: result.timeframesUsed,
    replaySpeedMs: 0,
    replayDurationMs: result.durationMs,
    startTime: extras?.startTime ?? new Date().toISOString(),
    endTime: extras?.endTime ?? new Date().toISOString(),
    totalCandlesProcessed: result.totalCandlesProcessed,
    status: result.status === 'completed' ? 'completed' : result.status,
    createdAt: extras?.createdAt ?? new Date().toISOString(),
    strategyResults,
    trades,
    bestStrategyName: result.bestStrategyName,
    lossPatternAnalysis: extras?.lossPatternAnalysis,
    marketRegimeSummary: result.marketRegimeSummary ?? extras?.marketRegimeSummary,
  };
}

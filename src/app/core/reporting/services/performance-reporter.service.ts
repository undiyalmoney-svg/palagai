import { Injectable } from '@angular/core';
import { StrategyTestResult } from '../../models/historical-test.model';
import { PerformanceMetrics } from '../../domain';
import { TradeEngineService } from '../../trading/services/trade-engine.service';
import { IStrategyPlugin } from '../../strategies/interfaces/strategy-plugin.interface';

/**
 * Reporting Engine — generates performance metrics from trade results.
 * Independent from strategy execution and backtesting loop.
 */
@Injectable({ providedIn: 'root' })
export class PerformanceReporterService {
  buildMetrics(
    plugins: IStrategyPlugin[],
    tradeEngine: TradeEngineService,
  ): PerformanceMetrics[] {
    const metrics = plugins
      .map((plugin) => {
        const stats = tradeEngine.getStatistics(plugin.id, plugin.name);
        if (!stats) {
          return null;
        }
        return this.fromStrategyTestResult(stats, plugin.version);
      })
      .filter((m): m is PerformanceMetrics => m !== null)
      .sort((a, b) => b.netProfit - a.netProfit)
      .map((m, index) => ({ ...m, rank: index + 1 }));

    return metrics;
  }

  fromStrategyTestResult(result: StrategyTestResult, version: number): PerformanceMetrics {
    return {
      strategyId: result.strategyId,
      strategyName: result.strategyName,
      strategyVersion: version,
      totalTrades: result.totalTrades,
      winningTrades: result.winningTrades,
      losingTrades: result.losingTrades,
      winRate: result.winPercentage,
      grossProfit: result.grossProfit,
      grossLoss: result.grossLoss,
      netProfit: result.netProfit,
      profitFactor: result.profitFactor,
      maxDrawdown: result.maxDrawdown,
      averageWin: result.averageProfitPerTrade,
      averageLoss: result.averageLossPerTrade,
      averageHoldingMinutes: result.averageHoldingMinutes,
      bestTrade: result.largestWin,
      worstTrade: result.largestLoss,
      rank: result.rank,
      moduleStatistics: result.moduleStatistics,
    };
  }

  computeExpectancy(metrics: PerformanceMetrics): number {
    if (!metrics.totalTrades) {
      return 0;
    }
    const winRate = metrics.winRate / 100;
    const lossRate = 1 - winRate;
    return winRate * metrics.averageWin + lossRate * metrics.averageLoss;
  }

  computeEquityCurve(trades: { points: number }[]): number[] {
    let equity = 0;
    return trades.map((t) => {
      equity += t.points;
      return equity;
    });
  }
}

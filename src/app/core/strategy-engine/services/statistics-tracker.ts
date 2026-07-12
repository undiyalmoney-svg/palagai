import { HistoricalTrade, ModuleCheckStatistics, StrategyTestResult } from '../../models/historical-test.model';

export class StatisticsTracker {
  private trades: HistoricalTrade[] = [];
  private equityCurve: number[] = [0];
  private readonly checkStats = new Map<string, { passed: number; failed: number }>();

  recordTrade(trade: HistoricalTrade): void {
    this.trades.push(trade);
    const last = this.equityCurve[this.equityCurve.length - 1];
    this.equityCurve.push(last + trade.points);
  }

  recordModuleResult(moduleName: string, passed: boolean, checks: { name: string; passed: boolean }[]): void {
    this.incrementStat(moduleName, passed);
    for (const check of checks) {
      this.incrementStat(check.name, check.passed);
    }
  }

  getTrades(): HistoricalTrade[] {
    return [...this.trades];
  }

  getEquityCurve(): number[] {
    return [...this.equityCurve];
  }

  getModuleStatistics(): ModuleCheckStatistics[] {
    return [...this.checkStats.entries()]
      .map(([name, stats]) => ({ name, passed: stats.passed, failed: stats.failed }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  buildResult(strategyId: string, strategyName: string): StrategyTestResult {
    const wins = this.trades.filter((t) => t.outcome === 'WIN');
    const losses = this.trades.filter((t) => t.outcome === 'LOSS');
    const grossProfit = wins.reduce((sum, t) => sum + t.profitLoss, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.profitLoss, 0));
    const netProfit = grossProfit - grossLoss;
    const netPoints = this.trades.reduce((sum, t) => sum + t.points, 0);

    const avgRr =
      this.trades.length > 0
        ? this.trades.reduce((sum, t) => {
            const risk = Math.abs(t.entryPrice - t.stopLoss);
            const reward = Math.abs(t.targetPrice - t.entryPrice);
            return sum + (risk > 0 ? reward / risk : 0);
          }, 0) / this.trades.length
        : 0;

    return {
      strategyId,
      strategyName,
      strategyVersion: 1,
      strategySnapshot: {
        id: strategyId,
        version: 1,
        name: strategyName,
        description: '',
        enabled: true,
        type: 'ema_crossover',
        stopLossMethod: 'fixed_points',
        stopLossValue: 0,
        targetMethod: 'risk_reward',
        targetValue: 0,
        riskRewardRatio: avgRr,
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
      totalTrades: this.trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winPercentage: this.trades.length ? (wins.length / this.trades.length) * 100 : 0,
      netPoints,
      grossProfit,
      grossLoss,
      netProfit,
      averageProfitPerTrade: wins.length ? grossProfit / wins.length : 0,
      averageLossPerTrade: losses.length ? grossLoss / losses.length : 0,
      averageRiskRewardRatio: avgRr,
      largestWin: wins.length ? Math.max(...wins.map((t) => t.profitLoss)) : 0,
      largestLoss: losses.length ? Math.min(...losses.map((t) => t.profitLoss)) : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0,
      maxDrawdown: this.maxDrawdown(this.equityCurve),
      averageHoldingMinutes: this.trades.length
        ? this.trades.reduce((sum, t) => sum + t.holdingMinutes, 0) / this.trades.length
        : 0,
      averagePointsCaptured: this.trades.length ? netPoints / this.trades.length : 0,
      resultLabel: netProfit > 0 ? 'Profit' : netProfit < 0 ? 'Loss' : 'Neutral',
      rank: 0,
      moduleStatistics: this.getModuleStatistics(),
    };
  }

  reset(): void {
    this.trades = [];
    this.equityCurve = [0];
    this.checkStats.clear();
  }

  private incrementStat(name: string, passed: boolean): void {
    const current = this.checkStats.get(name) ?? { passed: 0, failed: 0 };
    if (passed) {
      current.passed += 1;
    } else {
      current.failed += 1;
    }
    this.checkStats.set(name, current);
  }

  private maxDrawdown(curve: number[]): number {
    let peak = 0;
    let maxDd = 0;
    for (const value of curve) {
      peak = Math.max(peak, value);
      maxDd = Math.max(maxDd, peak - value);
    }
    return maxDd;
  }
}

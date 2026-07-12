import { Injectable } from '@angular/core';
import {
  CandleDebugRecord,
  DailyDebugSummary,
  ImplementationAuditIssue,
  ModuleKey,
  RuleBottleneck,
  RuleFailureCounts,
  RuleStatistics,
  StrategyDebugSummary,
  StrategyResearchDebugRun,
} from '../models/strategy-research-debug.model';
import { HistoricalTrade } from '../../../models/historical-test.model';
import { formatDisplayDate, listDatesInRange } from '../../../utils/trade-date.util';
import { RESEARCH_STRATEGY_IDS } from '../../interfaces/research-strategy.interface';
import { STRATEGY_DEBUG_META } from '../models/strategy-research-debug.model';

const MODULE_LABELS: Record<ModuleKey, string> = {
  trend: 'Trend',
  structure: 'Structure',
  pullback: '15 Minute Pullback',
  breakout: 'Breakout',
  retest: 'Trendline Retest',
  confirmation: 'Confirmation',
  entry: 'Entry',
};

@Injectable({ providedIn: 'root' })
export class StrategyResearchReportService {
  buildRunReport(params: {
    id: string;
    config: {
      instrumentToken: number;
      instrumentSymbol: string;
      fromDateTime: string;
      toDateTime: string;
    };
    durationMs: number;
    candleRecords: CandleDebugRecord[];
    shadowTrades: HistoricalTrade[];
    implementationAudit: ImplementationAuditIssue[];
  }): StrategyResearchDebugRun {
    const fromDate = params.config.fromDateTime.slice(0, 10);
    const toDate = params.config.toDateTime.slice(0, 10);
    const tradingDays = listDatesInRange(fromDate, toDate);

    const dailySummaries = this.buildDailySummaries(params.candleRecords, tradingDays);
    const strategySummaries = (
      [
        RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT,
        RESEARCH_STRATEGY_IDS.MTF_PULLBACK,
        RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT,
      ] as const
    ).map((strategyId) =>
      this.buildStrategySummary(strategyId, params.candleRecords, params.shadowTrades),
    );

    return {
      id: params.id,
      createdAt: new Date().toISOString(),
      instrumentToken: params.config.instrumentToken,
      instrumentSymbol: params.config.instrumentSymbol,
      fromDateTime: params.config.fromDateTime,
      toDateTime: params.config.toDateTime,
      durationMs: params.durationMs,
      candleRecords: params.candleRecords,
      dailySummaries,
      strategySummaries,
      tradingDays,
      implementationAudit: params.implementationAudit,
    };
  }

  private buildDailySummaries(
    records: CandleDebugRecord[],
    tradingDays: string[],
  ): DailyDebugSummary[] {
    const summaries: DailyDebugSummary[] = [];
    const strategyIds = [
      RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT,
      RESEARCH_STRATEGY_IDS.MTF_PULLBACK,
      RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT,
    ];

    for (const date of tradingDays) {
      for (const strategyId of strategyIds) {
        const dayRecords = records.filter(
          (r) => r.tradingDate === date && r.strategyId === strategyId,
        );
        if (!dayRecords.length) {
          summaries.push({
            date,
            displayDate: formatDisplayDate(date),
            strategyId,
            strategyName: STRATEGY_DEBUG_META[strategyId].shortName,
            trend: 'FAIL',
            structure: 'FAIL',
            pullback: 'FAIL',
            breakout: 'FAIL',
            retest: 'FAIL',
            confirmation: 'FAIL',
            entry: 'FAIL',
            finalDecision: 'NO_TRADE',
            reason: 'No candles for this day',
            waitingState: 'None',
            signalsGenerated: 0,
            tradesTaken: 0,
          });
          continue;
        }

        const signalRecords = dayRecords.filter(
          (r) => r.finalDecision === 'BUY' || r.finalDecision === 'SELL',
        );
        const representative = signalRecords[0] ?? dayRecords[dayRecords.length - 1]!;

        summaries.push({
          date,
          displayDate: formatDisplayDate(date),
          strategyId,
          strategyName: STRATEGY_DEBUG_META[strategyId].shortName,
          trend: representative.trend.passed ? 'PASS' : 'FAIL',
          structure: representative.structure.passed ? 'PASS' : 'FAIL',
          pullback: representative.pullback.passed ? 'PASS' : 'FAIL',
          breakout: representative.breakout.passed ? 'PASS' : 'FAIL',
          retest: representative.retest.passed ? 'PASS' : 'FAIL',
          confirmation: representative.confirmation.passed ? 'PASS' : 'FAIL',
          entry: representative.entry.passed ? 'PASS' : 'FAIL',
          finalDecision: representative.finalDecision,
          reason: representative.rejectionReason,
          waitingState: representative.waitingState,
          signalsGenerated: signalRecords.length,
          tradesTaken: dayRecords.filter((r) => r.openTradeActive || r.tradeDetails.entry !== null).length,
        });
      }
    }

    return summaries;
  }

  private buildStrategySummary(
    strategyId: CandleDebugRecord['strategyId'],
    records: CandleDebugRecord[],
    allTrades: HistoricalTrade[],
  ): StrategyDebugSummary {
    const strategyRecords = records.filter((r) => r.strategyId === strategyId);
    const trades = allTrades.filter((t) => t.strategyId === strategyId);
    const failureCounts = this.countFailures(strategyRecords);
    const statistics = this.buildStatistics(strategyRecords);
    const bottlenecks = this.buildBottlenecks(strategyRecords, strategyId);

    return {
      strategyId,
      strategyName: STRATEGY_DEBUG_META[strategyId].name,
      failureCounts,
      statistics,
      bottlenecks,
      trades,
      performance: this.buildPerformance(trades),
    };
  }

  private countFailures(records: CandleDebugRecord[]): RuleFailureCounts {
    const counts: RuleFailureCounts = {
      trendFailed: 0,
      structureFailed: 0,
      pullbackFailed: 0,
      breakoutFailed: 0,
      retestFailed: 0,
      confirmationFailed: 0,
      entryFailed: 0,
    };

    for (const r of records) {
      if (r.finalDecision !== 'NO_TRADE') {
        continue;
      }
      if (!r.trend.passed) {
        counts.trendFailed += 1;
      }
      if (!r.structure.passed) {
        counts.structureFailed += 1;
      }
      if (!r.pullback.passed) {
        counts.pullbackFailed += 1;
      }
      if (!r.breakout.passed) {
        counts.breakoutFailed += 1;
      }
      if (!r.retest.passed) {
        counts.retestFailed += 1;
      }
      if (!r.confirmation.passed) {
        counts.confirmationFailed += 1;
      }
      if (!r.entry.passed) {
        counts.entryFailed += 1;
      }
    }

    return counts;
  }

  private buildStatistics(records: CandleDebugRecord[]): RuleStatistics {
    const stats: RuleStatistics = {
      trendPassed: 0,
      trendFailed: 0,
      structurePassed: 0,
      structureFailed: 0,
      pullbackPassed: 0,
      pullbackFailed: 0,
      breakoutPassed: 0,
      breakoutFailed: 0,
      retestPassed: 0,
      retestFailed: 0,
      confirmationPassed: 0,
      confirmationFailed: 0,
      entryPassed: 0,
      entryFailed: 0,
      totalCandles: records.length,
    };

    for (const r of records) {
      if (r.trend.passed) stats.trendPassed += 1; else stats.trendFailed += 1;
      if (r.structure.passed) stats.structurePassed += 1; else stats.structureFailed += 1;
      if (r.pullback.passed) stats.pullbackPassed += 1; else stats.pullbackFailed += 1;
      if (r.breakout.passed) stats.breakoutPassed += 1; else stats.breakoutFailed += 1;
      if (r.retest.passed) stats.retestPassed += 1; else stats.retestFailed += 1;
      if (r.confirmation.passed) stats.confirmationPassed += 1; else stats.confirmationFailed += 1;
      if (r.entry.passed) stats.entryPassed += 1; else stats.entryFailed += 1;
    }

    return stats;
  }

  private buildBottlenecks(
    records: CandleDebugRecord[],
    strategyId: CandleDebugRecord['strategyId'],
  ): RuleBottleneck[] {
    const noTradeRecords = records.filter((r) => r.finalDecision === 'NO_TRADE');
    const counts = new Map<ModuleKey, number>();

    for (const r of noTradeRecords) {
      const blocker = r.blockingModule ?? this.inferBlocker(r);
      if (blocker) {
        counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
      }
    }

    const total = noTradeRecords.length || 1;
    const sorted = [...counts.entries()]
      .map(([module, rejectionCount]) => ({
        ruleName: this.bottleneckLabel(strategyId, module),
        module,
        rejectionCount,
        rejectionPercent: Math.round((rejectionCount / total) * 1000) / 10,
        rank: 0,
      }))
      .sort((a, b) => b.rejectionCount - a.rejectionCount);

    sorted.forEach((b, i) => {
      b.rank = i + 1;
    });

    return sorted;
  }

  private bottleneckLabel(
    strategyId: CandleDebugRecord['strategyId'],
    module: ModuleKey,
  ): string {
    if (strategyId === RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT && module === 'retest') {
      return 'Trendline Retest';
    }
    if (strategyId === RESEARCH_STRATEGY_IDS.MTF_PULLBACK && module === 'pullback') {
      return '15 Minute Pullback';
    }
    if (strategyId === RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT && module === 'breakout') {
      return '1 Hour Breakout';
    }
    return MODULE_LABELS[module];
  }

  private inferBlocker(r: CandleDebugRecord): ModuleKey | null {
    if (!r.trend.passed) {
      return 'trend';
    }
    if (!r.structure.passed) {
      return 'structure';
    }
    if (!r.pullback.passed) {
      return 'pullback';
    }
    if (!r.breakout.passed) {
      return 'breakout';
    }
    if (!r.retest.passed) {
      return 'retest';
    }
    if (!r.confirmation.passed) {
      return 'confirmation';
    }
    if (!r.entry.passed) {
      return 'entry';
    }
    return null;
  }

  private buildPerformance(trades: HistoricalTrade[]): StrategyDebugSummary['performance'] {
    const wins = trades.filter((t) => t.outcome === 'WIN');
    const losses = trades.filter((t) => t.outcome === 'LOSS');
    const grossProfit = wins.reduce((s, t) => s + t.profitLoss, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profitLoss, 0));
    const netProfit = grossProfit - grossLoss;

    let peak = 0;
    let equity = 0;
    let maxDrawdown = 0;
    for (const t of trades) {
      equity += t.points;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }

    return {
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      grossProfit,
      grossLoss,
      netProfit,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      maxDrawdown,
      averageWin: wins.length ? grossProfit / wins.length : 0,
      averageLoss: losses.length ? -grossLoss / losses.length : 0,
      averageHoldingMinutes: trades.length
        ? trades.reduce((s, t) => s + t.holdingMinutes, 0) / trades.length
        : 0,
    };
  }
}

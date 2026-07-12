import { Injectable, inject, signal } from '@angular/core';
import { HistoricalTest } from '../models/historical-test.model';
import { ReplayDebugSnapshot } from '../models/replay-debug.model';
import { ResultsStoreService } from './results-store.service';
import { TimelinePhase } from '../strategy-engine/models/module-result.model';
import { StrategyEventLogService } from '../strategy-engine/services/strategy-event-log.service';
import {
  LOSS_ANALYZER_STRATEGY_ID,
  LossPatternAnalyzerService,
} from '../strategy-engine/services/loss-pattern-analyzer.service';
import { LossPatternAnalysis } from '../strategy-engine/models/loss-pattern.model';
import { BacktestRunnerService } from '../backtesting/services/backtest-runner.service';
import { toHistoricalTest } from '../domain';
import { AppLoggerService } from '../shared/logging/app-logger.service';

export interface BacktestConfig {
  instrumentToken: number;
  instrumentSymbol: string;
  fromDateTime: string;
  toDateTime: string;
  lookbackDays?: number;
  instrumentId?: string;
  exchange?: string;
}

export type ReplayPhase =
  | 'idle'
  | 'loading_candles'
  | 'calculating'
  | 'completed'
  | 'cancelled';

export interface ReplayStatus {
  phase: ReplayPhase;
  message: string;
  currentCandle: number;
  totalCandles: number;
  loadStep: number;
  loadTotalSteps: number;
}

/**
 * UI orchestration layer for historical backtesting.
 * Delegates execution to BacktestRunnerService; handles live debug snapshots and persistence.
 */
@Injectable({ providedIn: 'root' })
export class ReplayEngineService {
  private readonly backtestRunner = inject(BacktestRunnerService);
  private readonly resultsStore = inject(ResultsStoreService);
  private readonly eventLog = inject(StrategyEventLogService);
  private readonly lossPatternAnalyzer = inject(LossPatternAnalyzerService);
  private readonly logger = inject(AppLoggerService);

  private cancelRequested = false;
  private loadStep = 0;

  readonly isRunning = signal(false);
  readonly progress = signal({ current: 0, total: 0 });
  readonly status = signal<ReplayStatus>({
    phase: 'idle',
    message: '',
    currentCandle: 0,
    totalCandles: 0,
    loadStep: 0,
    loadTotalSteps: 4,
  });
  readonly debugSnapshot = signal<ReplayDebugSnapshot | null>(null);
  readonly lossPatternAnalysis = signal<LossPatternAnalysis | null>(null);

  cancel(): void {
    this.cancelRequested = true;
  }

  async run(config: BacktestConfig): Promise<HistoricalTest> {
    this.cancelRequested = false;
    this.isRunning.set(true);
    this.debugSnapshot.set(null);
    this.lossPatternAnalysis.set(null);
    this.eventLog.reset();
    this.loadStep = 0;

    const runStarted = Date.now();
    const startTime = new Date().toISOString();

    try {
      const result = await this.backtestRunner.run(config, {
        isCancelled: () => this.cancelRequested,
        onProgress: (progress) => {
          if (progress.phase === 'loading') {
            this.loadStep = Math.min(this.loadStep + 1, 4);
            this.setStatus({
              phase: 'loading_candles',
              message: progress.message,
              currentCandle: 0,
              totalCandles: 0,
              loadStep: this.loadStep,
              loadTotalSteps: 4,
            });
          } else if (progress.phase === 'running') {
            this.setStatus({
              phase: 'calculating',
              message: progress.message,
              currentCandle: progress.current,
              totalCandles: progress.total,
              loadStep: 4,
              loadTotalSteps: 4,
            });
            this.progress.set({ current: progress.current, total: progress.total });
          }
        },
        onStep: ({ step, totalCandles, context, snapshots, plugins }) => {
          const dominantPhase =
            snapshots.find((s) => s.tradeOpen)?.signal.timelinePhase ??
            snapshots[0]?.signal.timelinePhase ??
            ('Trend' as TimelinePhase);

          this.publishDebugSnapshot({
            context,
            step,
            totalCandles,
            plugins,
            snapshots,
            dominantPhase,
          });
        },
      });

      let lossPatternAnalysis: LossPatternAnalysis | undefined;
      const momentumTrades = result.trades.filter((t) => t.strategyId === LOSS_ANALYZER_STRATEGY_ID);
      if (momentumTrades.length && result.dataset) {
        lossPatternAnalysis = this.lossPatternAnalyzer.analyzeBacktest({
          testId: result.id,
          strategyId: LOSS_ANALYZER_STRATEGY_ID,
          strategyName: momentumTrades[0]!.strategyName,
          trades: momentumTrades as HistoricalTest['trades'],
          dataset: result.dataset,
        });
        this.lossPatternAnalysis.set(lossPatternAnalysis);
      }

      const test = toHistoricalTest(result, {
        startTime,
        endTime: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lossPatternAnalysis,
      });

      test.replayDurationMs = Date.now() - runStarted;
      test.status = this.cancelRequested ? 'cancelled' : 'completed';

      try {
        this.resultsStore.save(test);
      } catch {
        this.logger.warn('ReplayEngine', 'Failed to persist backtest result');
      }

      this.setStatus({
        phase: this.cancelRequested ? 'cancelled' : 'completed',
        message: 'Backtest completed.',
        currentCandle: result.totalCandlesProcessed,
        totalCandles: result.totalCandlesProcessed,
        loadStep: 4,
        loadTotalSteps: 4,
      });

      return test;
    } finally {
      this.isRunning.set(false);
    }
  }

  private setStatus(status: ReplayStatus): void {
    this.status.set(status);
  }

  private publishDebugSnapshot(params: {
    context: ReturnType<import('../strategy-engine/models/candle-dataset.model').CandleDataset['buildContext']>;
    step: number;
    totalCandles: number;
    plugins: { id: string; name: string }[];
    snapshots: import('../strategy-engine/models/module-result.model').TradeExecutionSnapshot[];
    dominantPhase: TimelinePhase;
  }): void {
    const { context, step, totalCandles, plugins, snapshots, dominantPhase } = params;
    this.debugSnapshot.set({
      replayTime: context.candle5m.date,
      candleNumber: step + 1,
      totalCandles,
      countdownSeconds: 0,
      activeStrategyName: plugins.map((s) => s.name).join(', '),
      marketRegime: context.marketRegime,
      marketRegimeReason: context.marketRegimeReason,
      ohlc: {
        open: context.candle5m.open,
        high: context.candle5m.high,
        low: context.candle5m.low,
        close: context.candle5m.close,
        volume: context.candle5m.volume,
      },
      strategies: snapshots,
      timelinePhase: dominantPhase,
      eventLog: this.eventLog.getRecent(30),
    });
  }
}

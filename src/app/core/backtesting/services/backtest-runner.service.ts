import { Injectable, inject } from '@angular/core';
import { ALL_TIMEFRAMES } from '../../models/candle.model';
import { CandleDataset } from '../../strategy-engine/models/candle-dataset.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { TimelinePhase, TradeExecutionSnapshot } from '../../strategy-engine/models/module-result.model';
import { createId } from '../../utils/id.util';
import { BacktestRunConfig, BacktestRunResult } from '../../domain';
import { BacktestError } from '../../shared/errors/app-error';
import { AppLoggerService } from '../../shared/logging/app-logger.service';
import { OhlcDataService } from '../../data/services/ohlc-data.service';
import { StrategyEngineService } from '../../strategies/registry/strategy-engine.service';
import { ACTIVE_STRATEGY_IDS } from '../../config/strategy-ids.config';
import { TradeEngineService } from '../../trading/services/trade-engine.service';
import { PerformanceReporterService } from '../../reporting/services/performance-reporter.service';
import { IStrategyPlugin } from '../../strategies/interfaces/strategy-plugin.interface';
import { DailyRegimeTracker } from '../../strategy-engine/utils/market-regime.util';
import { extractTradeDate } from '../../utils/trade-date.util';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
import {
  buildMarketRegimeSummary,
  extractTradeDayRegimes,
} from '../../reporting/utils/market-regime-report.util';
import { resolveSessionConfig } from '../../config/session.config';

export interface BacktestProgress {
  current: number;
  total: number;
  phase: 'loading' | 'running' | 'completed' | 'cancelled';
  message: string;
}

export interface BacktestStepCallback {
  onProgress?(progress: BacktestProgress): void;
  onStep?(params: {
    step: number;
    totalCandles: number;
    context: StrategyContext;
    snapshots: TradeExecutionSnapshot[];
    plugins: IStrategyPlugin[];
  }): void;
  isCancelled?(): boolean;
}

/**
 * Backtesting Engine — strategy-agnostic candle-by-candle execution.
 * Receives strategy plugins, OHLC data, and configuration; produces standardized results.
 */
@Injectable({ providedIn: 'root' })
export class BacktestRunnerService {
  private readonly dataLayer = inject(OhlcDataService);
  private readonly strategyEngine = inject(StrategyEngineService);
  private readonly tradeEngine = inject(TradeEngineService);
  private readonly reporter = inject(PerformanceReporterService);
  private readonly logger = inject(AppLoggerService);

  async run(config: BacktestRunConfig, callbacks: BacktestStepCallback = {}): Promise<BacktestRunResult> {
    const started = Date.now();
    const testId = createId('test');

    const plugins = this.resolvePlugins(config.strategyIds);
    if (!plugins.length) {
      throw new BacktestError('No enabled strategies found for backtest');
    }

    this.dataLayer.clear();
    this.strategyEngine.resetAll();
    this.strategyEngine.initializeAll();
    this.tradeEngine.reset(plugins.map((p) => p.id));

    const regimeTracker = new DailyRegimeTracker();

    callbacks.onProgress?.({
      current: 0,
      total: 0,
      phase: 'loading',
      message: 'Loading OHLC data…',
    });

    const session = resolveSessionConfig({
      instrumentId: config.instrumentId,
      exchange: config.exchange,
      instrumentToken: config.instrumentToken,
    });

    const dataset = await this.dataLayer.load(
      {
        instrumentToken: config.instrumentToken,
        fromDateTime: config.fromDateTime,
        toDateTime: config.toDateTime,
        lookbackDays: config.lookbackDays,
        instrumentId: config.instrumentId,
        exchange: config.exchange,
      },
      (loadProgress) => {
        callbacks.onProgress?.({
          current: 0,
          total: 0,
          phase: 'loading',
          message: loadProgress.message,
        });
      },
    );

    const totalCandles = dataset.replayCount;
    if (!totalCandles) {
      throw new BacktestError('No 5-minute candles in the selected date range');
    }

    callbacks.onProgress?.({
      current: 0,
      total: totalCandles,
      phase: 'running',
      message: 'Running backtest…',
    });

    let lastContext = dataset.buildContext(0);
    let lastSnapshots: TradeExecutionSnapshot[] = [];

    for (let step = 0; step < totalCandles; step += 1) {
      if (callbacks.isCancelled?.()) {
        break;
      }

      const context = dataset.buildContext(step);
      const tradingDate = extractTradeDate(context.candle5m.date);
      const time = extractHhMm(context.candle5m.date);
      const all5m = [...context.previous5m, context.candle5m];
      const regimeResult = regimeTracker.resolve(
        tradingDate,
        all5m,
        time,
        session.firstHourReadyTime,
      );

      context.marketRegime = regimeResult.regime;
      context.marketRegimeReason = regimeResult.reason;
      lastContext = context;

      const signals = plugins.map((plugin) => plugin.generateSignal(context));
      lastSnapshots = this.tradeEngine.processCandleSignals({
        plugins,
        signals,
        candle: context.candle5m,
        testId,
        ctx: context,
      });

      callbacks.onProgress?.({
        current: step + 1,
        total: totalCandles,
        phase: 'running',
        message: `Processing candle ${step + 1} / ${totalCandles}`,
      });

      if (step === totalCandles - 1 || step % 5 === 0) {
        callbacks.onStep?.({
          step,
          totalCandles,
          context,
          snapshots: lastSnapshots,
          plugins,
        });
      }
    }

    if (lastSnapshots.length) {
      const finalStep = Math.max(0, totalCandles - 1);
      const finalContext = dataset.buildContext(finalStep);
      this.tradeEngine.forceCloseOpenTrades({
        plugins,
        candle: finalContext.candle5m,
        testId,
        reason: 'End of backtest range',
        session,
      });
    }

    const cancelled = callbacks.isCancelled?.() ?? false;
    const strategyMetrics = this.reporter.buildMetrics(plugins, this.tradeEngine);
    const trades = this.tradeEngine.getAllTrades();
    const marketRegimeSummary = buildMarketRegimeSummary({
      dayRegimes: extractTradeDayRegimes(regimeTracker.getAll()),
      trades: trades as BacktestRunResult['trades'],
    });

    this.logger.info('BacktestRunner', `Completed backtest ${testId}`, {
      trades: trades.length,
      durationMs: Date.now() - started,
      trendingDays: marketRegimeSummary.trendingDays,
      rangingDays: marketRegimeSummary.rangingDays,
    });

    return {
      id: testId,
      instrumentToken: config.instrumentToken,
      instrumentSymbol: config.instrumentSymbol,
      fromDateTime: config.fromDateTime,
      toDateTime: config.toDateTime,
      timeframesUsed: [...ALL_TIMEFRAMES],
      totalCandlesProcessed: totalCandles,
      durationMs: Date.now() - started,
      status: cancelled ? 'cancelled' : 'completed',
      strategyMetrics,
      trades: trades as BacktestRunResult['trades'],
      bestStrategyName: strategyMetrics[0]?.strategyName ?? '',
      dataset,
      marketRegimeSummary,
    };
  }

  private resolvePlugins(strategyIds?: string[]): IStrategyPlugin[] {
    let plugins: IStrategyPlugin[];
    if (strategyIds?.length) {
      plugins = strategyIds
        .map((id) => this.strategyEngine.getById(id))
        .filter((p): p is IStrategyPlugin => p !== undefined && p.enabled);
    } else {
      plugins = this.strategyEngine.getEnabled();
    }

    plugins = plugins.filter((p) => ACTIVE_STRATEGY_IDS.has(p.id));
    if (!plugins.length) {
      return [];
    }

    this.logger.info(
      'BacktestRunner',
      `Running backtest with: ${plugins.map((p) => p.name).join(', ')}`,
    );
    return plugins;
  }
}

import { Injectable, inject, signal } from '@angular/core';
import { CandleLoaderService } from '../../../services/candle-loader.service';
import { createId } from '../../../utils/id.util';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { CandleDataset } from '../../../strategy-engine/models/candle-dataset.model';
import { TradeManagerService } from '../../../strategy-engine/services/trade-manager.service';
import { OpenTrade } from '../../../strategy-engine/models/open-trade.model';
import { HistoricalTrade } from '../../../models/historical-test.model';
import { RESEARCH_STRATEGY_IDS } from '../../interfaces/research-strategy.interface';
import { OneTradePerDayGate } from '../../shared/research-signal.util';
import { runTrendlineBreakoutRetest } from '../../strategies/trendline-breakout-retest/trendline-breakout-retest.evaluator';
import { runMultiTimeframePullback } from '../../strategies/multi-timeframe-pullback/multi-timeframe-pullback.evaluator';
import {
  createHourBreakoutState,
  runHourBreakout,
} from '../../strategies/hour-breakout/hour-breakout.evaluator';
import { analyzeStrategy1Candle } from '../analyzers/strategy1-debug.analyzer';
import { analyzeStrategy2Candle } from '../analyzers/strategy2-debug.analyzer';
import { analyzeStrategy3Candle } from '../analyzers/strategy3-debug.analyzer';
import {
  CandleDebugRecord,
  StrategyResearchDebugConfig,
  StrategyResearchDebugRun,
  STRATEGY_DEBUG_META,
} from '../models/strategy-research-debug.model';
import { StrategyResearchReportService } from './strategy-research-report.service';
import { StrategyResearchDebugStoreService } from './strategy-research-debug-store.service';
import { StrategyImplementationAuditService } from './strategy-implementation-audit.service';

/**
 * Observation-only debug engine. Runs parallel analysis over OHLC data.
 * Does NOT modify strategies, replay engine, or trade execution paths.
 */
@Injectable({ providedIn: 'root' })
export class StrategyResearchDebugEngineService {
  private readonly candleLoader = inject(CandleLoaderService);
  private readonly tradeManager = inject(TradeManagerService);
  private readonly reportService = inject(StrategyResearchReportService);
  private readonly store = inject(StrategyResearchDebugStoreService);
  private readonly auditService = inject(StrategyImplementationAuditService);

  readonly isRunning = signal(false);
  readonly progress = signal({ current: 0, total: 0, message: '' });
  readonly lastRun = signal<StrategyResearchDebugRun | null>(null);

  async runDebugAnalysis(config: StrategyResearchDebugConfig): Promise<StrategyResearchDebugRun> {
    this.isRunning.set(true);
    const started = Date.now();
    const runId = createId('debug');

    this.progress.set({ current: 0, total: 0, message: 'Loading OHLC data…' });

    const dataset = await this.candleLoader.load({
      instrumentToken: config.instrumentToken,
      fromDateTime: config.fromDateTime,
      toDateTime: config.toDateTime,
    });

    const totalCandles = dataset.replayCount;
    const candleRecords: CandleDebugRecord[] = [];
    const shadowTrades: HistoricalTrade[] = [];

    const gates = {
      [RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT]: new OneTradePerDayGate(),
      [RESEARCH_STRATEGY_IDS.MTF_PULLBACK]: new OneTradePerDayGate(),
      [RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT]: new OneTradePerDayGate(),
    };

    const openTrades: Record<string, OpenTrade | null> = {
      [RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT]: null,
      [RESEARCH_STRATEGY_IDS.MTF_PULLBACK]: null,
      [RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT]: null,
    };

    const hourState = createHourBreakoutState();

    for (let step = 0; step < totalCandles; step += 1) {
      const context = dataset.buildContext(step);
      const candle = context.candle5m;
      const tradingDate = extractTradeDate(candle.date);

      this.progress.set({
        current: step + 1,
        total: totalCandles,
        message: `Analyzing candle ${step + 1} / ${totalCandles}`,
      });

      const s1 = this.observeStrategy({
        dataset,
        step,
        strategyId: RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT,
        analyze: () => analyzeStrategy1Candle(context),
        evaluate: () => runTrendlineBreakoutRetest(context),
        gate: gates[RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT],
        openTrade: openTrades[RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT],
        runId,
        tradingDate,
        candle,
        shadowTrades,
      });
      openTrades[RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT] = s1.openTrade;
      candleRecords.push(s1.record);

      const s2Eval = runMultiTimeframePullback(context);
      const s2Base = analyzeStrategy2Candle(context, s2Eval);
      const s2 = this.attachShadowTrade({
        record: s2Base,
        strategyId: RESEARCH_STRATEGY_IDS.MTF_PULLBACK,
        evaluateResult: s2Eval,
        gate: gates[RESEARCH_STRATEGY_IDS.MTF_PULLBACK],
        openTrade: openTrades[RESEARCH_STRATEGY_IDS.MTF_PULLBACK],
        runId,
        tradingDate,
        candle,
        shadowTrades,
      });
      openTrades[RESEARCH_STRATEGY_IDS.MTF_PULLBACK] = s2.openTrade;
      candleRecords.push(s2.record);

      const hourResult = runHourBreakout(context, hourState);
      const s3Base = analyzeStrategy3Candle(context, hourState, hourResult);
      const s3 = this.attachShadowTrade({
        record: s3Base,
        strategyId: RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT,
        evaluateResult: hourResult,
        gate: gates[RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT],
        openTrade: openTrades[RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT],
        runId,
        tradingDate,
        candle,
        shadowTrades,
      });
      openTrades[RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT] = s3.openTrade;
      candleRecords.push(s3.record);
    }

    for (const strategyId of [
      RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT,
      RESEARCH_STRATEGY_IDS.MTF_PULLBACK,
      RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT,
    ] as const) {
      const trade = openTrades[strategyId];
      if (trade) {
        const lastCandle = dataset.buildContext(totalCandles - 1).candle5m;
        const exit = this.tradeManager.checkExit(lastCandle, trade);
        if (exit.shouldExit) {
          shadowTrades.push(
            this.tradeManager.closeTrade({
              trade,
              exit,
              exitTime: lastCandle.date,
              testId: runId,
              strategyId,
              strategyName: STRATEGY_DEBUG_META[strategyId].name,
            }),
          );
        }
      }
    }

    const implementationAudit = this.auditService.audit(candleRecords);

    const run = this.reportService.buildRunReport({
      id: runId,
      config,
      durationMs: Date.now() - started,
      candleRecords,
      shadowTrades,
      implementationAudit,
    });

    this.store.save(run);
    this.lastRun.set(run);
    this.isRunning.set(false);
    return run;
  }

  private observeStrategy(params: {
    dataset: CandleDataset;
    step: number;
    strategyId: string;
    analyze: () => Omit<CandleDebugRecord, 'tradeDetails' | 'openTradeActive'>;
    evaluate: () => ReturnType<typeof runTrendlineBreakoutRetest>;
    gate: OneTradePerDayGate;
    openTrade: OpenTrade | null;
    runId: string;
    tradingDate: string;
    candle: ReturnType<CandleDataset['buildContext']>['candle5m'];
    shadowTrades: HistoricalTrade[];
  }) {
    const base = params.analyze();
    const evalResult = params.evaluate();
    return this.attachShadowTrade({
      record: base,
      strategyId: params.strategyId as CandleDebugRecord['strategyId'],
      evaluateResult: evalResult,
      gate: params.gate,
      openTrade: params.openTrade,
      runId: params.runId,
      tradingDate: params.tradingDate,
      candle: params.candle,
      shadowTrades: params.shadowTrades,
    });
  }

  private attachShadowTrade(params: {
    record: Omit<CandleDebugRecord, 'tradeDetails' | 'openTradeActive'>;
    strategyId: CandleDebugRecord['strategyId'];
    evaluateResult: ReturnType<typeof runTrendlineBreakoutRetest>;
    gate: OneTradePerDayGate;
    openTrade: OpenTrade | null;
    runId: string;
    tradingDate: string;
    candle: ReturnType<CandleDataset['buildContext']>['candle5m'];
    shadowTrades: HistoricalTrade[];
  }): { record: CandleDebugRecord; openTrade: OpenTrade | null } {
    let openTrade = params.openTrade;

    if (openTrade) {
      const exit = this.tradeManager.checkExit(params.candle, openTrade);
      if (exit.shouldExit) {
        params.shadowTrades.push(
          this.tradeManager.closeTrade({
            trade: openTrade,
            exit,
            exitTime: params.candle.date,
            testId: params.runId,
            strategyId: params.strategyId,
            strategyName: STRATEGY_DEBUG_META[params.strategyId].name,
          }),
        );
        openTrade = null;
      }
    }

    if (!openTrade) {
      const tradeable =
        (params.evaluateResult.action === 'BUY' || params.evaluateResult.action === 'SELL') &&
        params.gate.canTrade(params.tradingDate);

      if (tradeable) {
        openTrade = this.tradeManager.createOpenTrade({
          entryTime: params.candle.date,
          entryPrice: params.evaluateResult.entryPrice,
          stopLoss: params.evaluateResult.stopLoss,
          targetPrice: params.evaluateResult.target,
          entryReason: params.evaluateResult.reason,
          confidence: params.evaluateResult.riskRewardRatio * 25,
          riskRewardRatio: params.evaluateResult.riskRewardRatio,
          direction: params.evaluateResult.action as 'BUY' | 'SELL',
        });
        params.gate.markTraded(params.tradingDate);
      }
    }

    const hasTrade = openTrade !== null;
    const runningPnlValue = hasTrade ? this.tradeManager.runningPnl(params.candle, openTrade!) : null;

    const record: CandleDebugRecord = {
      ...params.record,
      openTradeActive: hasTrade,
      tradeDetails: hasTrade
        ? {
            entry: openTrade!.entryPrice,
            stopLoss: openTrade!.stopLoss,
            target: openTrade!.targetPrice,
            riskReward: openTrade!.riskRewardRatio,
            profitLoss: runningPnlValue,
          }
        : {
            entry: null,
            stopLoss: null,
            target: null,
            riskReward: null,
            profitLoss: null,
          },
    };

    return { record, openTrade };
  }
}

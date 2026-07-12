import { Injectable, inject, signal } from '@angular/core';
import { HistoricalTrade } from '../../../models/historical-test.model';
import { CandleLoaderService } from '../../../services/candle-loader.service';
import { createId } from '../../../utils/id.util';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { CandleDataset } from '../../../strategy-engine/models/candle-dataset.model';
import { OpenTrade } from '../../../strategy-engine/models/open-trade.model';
import { TradeManagerService } from '../../../strategy-engine/services/trade-manager.service';
import { RESEARCH_STRATEGY_IDS, ResearchStrategyResult } from '../../interfaces/research-strategy.interface';
import { runTrendlineBreakoutRetest } from '../../strategies/trendline-breakout-retest/trendline-breakout-retest.evaluator';
import { runMultiTimeframePullback } from '../../strategies/multi-timeframe-pullback/multi-timeframe-pullback.evaluator';
import {
  createHourBreakoutState,
  runHourBreakout,
} from '../../strategies/hour-breakout/hour-breakout.evaluator';
import {
  ResearchBaseStrategyId,
  ResearchOptimizationRun,
  RuleCombinationStats,
  SignalDecisionRecord,
} from '../models/research-optimization.model';
import { evaluateAllRules, evaluateRuleSubset } from '../rules/rule-catalog';
import {
  combinationId,
  combinationLabel,
  generateRuleCombinations,
} from '../utils/rule-combination-generator.util';
import { RuleCombinationAnalysisService } from './rule-combination-analysis.service';
import { RuleRegistryService } from './rule-registry.service';
import { ResearchRunStoreService } from './research-run-store.service';

export interface ResearchOptimizationConfig {
  instrumentToken: number;
  instrumentSymbol: string;
  fromDateTime: string;
  toDateTime: string;
  baseStrategyId: ResearchBaseStrategyId;
}

@Injectable({ providedIn: 'root' })
export class ResearchOptimizationEngineService {
  private readonly candleLoader = inject(CandleLoaderService);
  private readonly tradeManager = inject(TradeManagerService);
  private readonly analysisService = inject(RuleCombinationAnalysisService);
  private readonly ruleRegistry = inject(RuleRegistryService);
  private readonly runStore = inject(ResearchRunStoreService);

  readonly isRunning = signal(false);
  readonly progress = signal({ current: 0, total: 0, message: '' });
  readonly lastRun = signal<ResearchOptimizationRun | null>(null);
  readonly lastSignalDebug = signal<SignalDecisionRecord | null>(null);

  async runOptimization(config: ResearchOptimizationConfig): Promise<ResearchOptimizationRun> {
    this.isRunning.set(true);
    const started = Date.now();
    const runId = createId('research');
    const selectedRules = this.ruleRegistry.selectedRuleIds();
    const combinations = generateRuleCombinations(selectedRules);
    const nameMap = new Map(this.ruleRegistry.allRules.map((r) => [r.id, r.name]));

    this.progress.set({ current: 0, total: combinations.length, message: 'Loading OHLC data…' });

    const dataset = await this.candleLoader.load({
      instrumentToken: config.instrumentToken,
      fromDateTime: config.fromDateTime,
      toDateTime: config.toDateTime,
    });

    const combinationResults: RuleCombinationStats[] = [];

    for (let i = 0; i < combinations.length; i += 1) {
      const ruleIds = combinations[i]!;
      this.progress.set({
        current: i + 1,
        total: combinations.length,
        message: `Testing combination ${i + 1}/${combinations.length}`,
      });

      const stats = this.runSingleCombination({
        dataset,
        testId: runId,
        baseStrategyId: config.baseStrategyId,
        ruleIds,
        nameMap,
        strategyName: this.baseStrategyName(config.baseStrategyId),
      });
      combinationResults.push(stats);
    }

    const analysis = this.analysisService.analyze(combinationResults);

    const run: ResearchOptimizationRun = {
      id: runId,
      createdAt: new Date().toISOString(),
      instrumentToken: config.instrumentToken,
      instrumentSymbol: config.instrumentSymbol,
      fromDateTime: config.fromDateTime,
      toDateTime: config.toDateTime,
      baseStrategyId: config.baseStrategyId,
      baseStrategyName: this.baseStrategyName(config.baseStrategyId),
      selectedRuleIds: selectedRules,
      combinationsTested: combinations.length,
      combinationResults,
      analysis,
      status: 'completed',
      durationMs: Date.now() - started,
    };

    this.runStore.save(run);
    this.lastRun.set(run);
    this.isRunning.set(false);
    return run;
  }

  private runSingleCombination(params: {
    dataset: CandleDataset;
    testId: string;
    baseStrategyId: ResearchBaseStrategyId;
    ruleIds: string[];
    nameMap: Map<string, string>;
    strategyName: string;
  }): RuleCombinationStats {
    const comboKey = combinationId(params.ruleIds);
    let openTrade: OpenTrade | null = null;
    const trades: HistoricalTrade[] = [];
    const tradedDates = new Set<string>();
    const signalDecisions: SignalDecisionRecord[] = [];
    const rejectionCounts: Record<string, number> = {};
    const hourState = createHourBreakoutState();
    const totalCandles = params.dataset.replayCount;

    for (let step = 0; step < totalCandles; step += 1) {
      const context = params.dataset.buildContext(step);
      const candle = context.candle5m;
      const tradingDate = extractTradeDate(candle.date);
      const rawSignal = this.evaluateBase(params.baseStrategyId, context, hourState);
      const tradedToday = tradedDates.has(tradingDate);

      const ruleCtx = { strategyContext: context, rawSignal, tradedToday };
      const allEvaluations = evaluateAllRules(ruleCtx);
      const gate = evaluateRuleSubset(ruleCtx, params.ruleIds);

      const tradeable =
        (rawSignal.action === 'BUY' || rawSignal.action === 'SELL') && gate.allowed;

      const decision: SignalDecisionRecord = {
        timestamp: candle.date,
        action: tradeable ? rawSignal.action : 'NO_TRADE',
        allowed: tradeable,
        blockingRules: gate.blockingRules,
        evaluations: allEvaluations,
        reason: tradeable
          ? rawSignal.reason
          : gate.blockingReasons[0] ?? rawSignal.reason ?? 'No signal',
      };

      if (signalDecisions.length < 200) {
        signalDecisions.push(decision);
      }
      if (step === totalCandles - 1) {
        this.lastSignalDebug.set(decision);
      }

      if (!tradeable && rawSignal.action !== 'NO_TRADE') {
        for (const id of gate.blockingRules) {
          rejectionCounts[id] = (rejectionCounts[id] ?? 0) + 1;
        }
      }

      if (openTrade) {
        const exit = this.tradeManager.checkExit(candle, openTrade);
        if (exit.shouldExit) {
          trades.push(
            this.tradeManager.closeTrade({
              trade: openTrade,
              exit,
              exitTime: candle.date,
              testId: params.testId,
              strategyId: comboKey,
              strategyName: `${params.strategyName} [${combinationLabel(params.ruleIds, params.nameMap)}]`,
            }),
          );
          openTrade = null;
        }
      }

      if (!openTrade && tradeable) {
        openTrade = this.tradeManager.createOpenTrade({
          entryTime: candle.date,
          entryPrice: rawSignal.entryPrice,
          stopLoss: rawSignal.stopLoss,
          targetPrice: rawSignal.target,
          entryReason: `${rawSignal.action}: ${rawSignal.reason}`,
          confidence: rawSignal.riskRewardRatio * 25,
          riskRewardRatio: rawSignal.riskRewardRatio,
          direction: rawSignal.action as 'BUY' | 'SELL',
        });
        tradedDates.add(tradingDate);
      }
    }

    return this.buildStats({
      combinationId: comboKey,
      ruleIds: params.ruleIds,
      nameMap: params.nameMap,
      trades,
      signalDecisions,
      rejectionCounts,
    });
  }

  private evaluateBase(
    baseId: ResearchBaseStrategyId,
    context: ReturnType<CandleDataset['buildContext']>,
    hourState: ReturnType<typeof createHourBreakoutState>,
  ): ResearchStrategyResult {
    switch (baseId) {
      case RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT:
        return runTrendlineBreakoutRetest(context);
      case RESEARCH_STRATEGY_IDS.MTF_PULLBACK:
        return runMultiTimeframePullback(context);
      case RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT:
        return runHourBreakout(context, hourState);
      default:
        return runTrendlineBreakoutRetest(context);
    }
  }

  private buildStats(params: {
    combinationId: string;
    ruleIds: string[];
    nameMap: Map<string, string>;
    trades: HistoricalTrade[];
    signalDecisions: SignalDecisionRecord[];
    rejectionCounts: Record<string, number>;
  }): RuleCombinationStats {
    const wins = params.trades.filter((t) => t.outcome === 'WIN');
    const losses = params.trades.filter((t) => t.outcome === 'LOSS');
    const grossProfit = wins.reduce((s, t) => s + t.profitLoss, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profitLoss, 0));
    const netProfit = grossProfit - grossLoss;
    const points = params.trades.map((t) => t.points);

    let peak = 0;
    let equity = 0;
    let maxDrawdown = 0;
    for (const t of params.trades) {
      equity += t.points;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }

    return {
      combinationId: params.combinationId,
      ruleIds: params.ruleIds,
      ruleLabels: params.ruleIds.map((id) => params.nameMap.get(id) ?? id),
      totalTrades: params.trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: params.trades.length ? (wins.length / params.trades.length) * 100 : 0,
      grossProfit,
      grossLoss,
      netProfit,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      maxDrawdown,
      averageWin: wins.length ? grossProfit / wins.length : 0,
      averageLoss: losses.length ? -grossLoss / losses.length : 0,
      averageHoldingMinutes: params.trades.length
        ? params.trades.reduce((s, t) => s + t.holdingMinutes, 0) / params.trades.length
        : 0,
      bestTrade: points.length ? Math.max(...points) : 0,
      worstTrade: points.length ? Math.min(...points) : 0,
      rank: 0,
      trades: params.trades,
      signalDecisions: params.signalDecisions,
      rejectionCounts: params.rejectionCounts,
    };
  }

  private baseStrategyName(id: ResearchBaseStrategyId): string {
    switch (id) {
      case RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT:
        return 'Trendline Breakout + Retest';
      case RESEARCH_STRATEGY_IDS.MTF_PULLBACK:
        return 'Multi Timeframe Pullback';
      case RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT:
        return '1 Hour Breakout';
      default:
        return id;
    }
  }
}

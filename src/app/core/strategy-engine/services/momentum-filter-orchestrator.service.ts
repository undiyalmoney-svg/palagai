import { Injectable, inject } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { HistoricalTrade } from '../../models/historical-test.model';
import { StrategyContext } from '../models/strategy-context.model';
import {
  ExitResult,
  StrategySignal,
  emptyModule,
  isLongSignal,
  isShortSignal,
  isTradeableSignal,
} from '../models/module-result.model';
import { OpenTrade } from '../models/open-trade.model';
import { StrategyThree } from '../strategies/strategy-three.strategy';
import { calculateMomentumScore } from '../utils/momentum-score.util';
import { evaluateSidewaysMarketFilter } from '../utils/sideways-market-filter.util';
import { toOhlcSummary } from '../utils/ohlc-candle.util';
import { detectStructureTrend, detectSwingHighs, detectSwingLows } from '../utils/swing-level.util';
import { evaluateOpeningRangeFilter } from '../utils/opening-range-filter.util';
import {
  ConsecutiveLossFilterState,
  createConsecutiveLossState,
  evaluateConsecutiveLossFilter,
  recordTradeOutcome,
} from '../utils/consecutive-loss-filter.util';
import {
  OneSignalPerSwingState,
  createOneSignalPerSwingState,
  evaluateOneSignalPerSwingFilter,
  onMomentumTradeClosed,
  updateSwingRelease,
} from '../utils/one-signal-per-swing-filter.util';
import {
  EarlyExitTradeContext,
  createEarlyExitContext,
  evaluateEarlyExit,
  toEarlyExitResult,
} from '../utils/early-exit-manager.util';

export const STRATEGY_THREE_ID = 'strategy-three';

export interface MomentumFilterOutput {
  currentOhlc: ReturnType<typeof toOhlcSummary>;
  momentumScore: { bullish: number; bearish: number; winning: number } | null;
  marketState: string;
  sidewaysScore: number;
  priceCompression: boolean;
  structureWeakness: boolean;
  overlapCount: number;
  failedBreakouts: number;
  currentTrend: string;
  consecutiveLosses: number;
  tradingPaused: boolean;
  openingRangeAllowed: boolean;
  buySwingBlocked: boolean;
  sellSwingBlocked: boolean;
  earlyExitStatus: string;
  tradeAllowed: string;
  finalDecision: string;
  reason: string;
  sidewaysFilter: ReturnType<typeof evaluateSidewaysMarketFilter>;
  oneSignalPerSwing?: ReturnType<typeof evaluateOneSignalPerSwingFilter>;
}

@Injectable({ providedIn: 'root' })
export class MomentumFilterOrchestratorService {
  private readonly momentumStrategy = inject(StrategyThree);

  private consecutiveLossState: ConsecutiveLossFilterState = createConsecutiveLossState();
  private swingState: OneSignalPerSwingState = createOneSignalPerSwingState();
  private earlyExitContext: EarlyExitTradeContext | null = null;
  private lastEarlyExitStatus = 'Inactive';

  evaluateEntry(ctx: StrategyContext): StrategySignal {
    const candles5 = [...ctx.previous5m, ctx.candle5m];
    const current = ctx.candle5m;
    const momentum = calculateMomentumScore(candles5);
    const winningScore = momentum?.winningScore ?? 0;

    updateSwingRelease(this.swingState, candles5);

    const sidewaysFilter = evaluateSidewaysMarketFilter(candles5, winningScore);
    const consecutiveLoss = evaluateConsecutiveLossFilter(
      this.consecutiveLossState,
      momentum,
      candles5,
    );
    const openingRange = evaluateOpeningRangeFilter(current);

    const filterOutput = this.buildFilterOutput({
      current,
      candles5,
      momentum,
      sidewaysFilter,
      consecutiveLoss,
      openingRange,
      swingState: this.swingState,
      earlyExitStatus: this.lastEarlyExitStatus,
    });

    if (sidewaysFilter.decision === 'NO_TRADE') {
      return this.buildBlockedSignal(current, filterOutput, sidewaysFilter.reason);
    }

    if (!consecutiveLoss.allowed) {
      return this.buildBlockedSignal(current, filterOutput, consecutiveLoss.reason);
    }

    if (!openingRange.allowed) {
      return this.buildBlockedSignal(current, filterOutput, openingRange.reason);
    }

    const signal = this.momentumStrategy.evaluate(ctx);

    const swingFilter = evaluateOneSignalPerSwingFilter(
      this.swingState,
      signal.signalType,
      candles5,
    );

    filterOutput.oneSignalPerSwing = swingFilter;
    filterOutput.tradeAllowed = swingFilter.allowed ? 'YES' : 'NO';

    if (!swingFilter.allowed && isTradeableSignal(signal.signalType)) {
      return this.buildBlockedSignal(current, filterOutput, swingFilter.reason, signal);
    }

    filterOutput.tradeAllowed = isTradeableSignal(signal.signalType) ? 'YES' : 'NO';
    filterOutput.finalDecision = signal.signalType;
    filterOutput.reason =
      signal.signalType === 'NO_TRADE' ? 'Momentum produced NO_TRADE' : 'All filters passed';

    return {
      ...signal,
      analysis: {
        ...signal.analysis,
        momentumFilters: filterOutput,
      },
    };
  }

  checkEarlyExit(ctx: StrategyContext, trade: OpenTrade): ExitResult | null {
    const candles5 = [...ctx.previous5m, ctx.candle5m];
    const momentum = calculateMomentumScore(candles5);
    if (!momentum) {
      this.lastEarlyExitStatus = 'HOLD — insufficient candles';
      return null;
    }

    if (!this.earlyExitContext) {
      this.earlyExitContext = createEarlyExitContext({ trade, momentum, candles5 });
    }

    const evaluation = evaluateEarlyExit({
      context: this.earlyExitContext,
      momentum,
      candle: ctx.candle5m,
      candles5,
    });

    this.lastEarlyExitStatus = evaluation.status;

    if (!evaluation.shouldExit) {
      return null;
    }

    return toEarlyExitResult(evaluation, ctx.candle5m, trade);
  }

  onTradeOpened(trade: OpenTrade, ctx: StrategyContext): void {
    const candles5 = [...ctx.previous5m, ctx.candle5m];
    const momentum = calculateMomentumScore(candles5);
    if (!momentum) {
      this.earlyExitContext = null;
      return;
    }
    this.earlyExitContext = createEarlyExitContext({ trade, momentum, candles5 });
    this.lastEarlyExitStatus = 'Monitoring';
  }

  onTradeClosed(trade: HistoricalTrade, ctx: StrategyContext): void {
    recordTradeOutcome(this.consecutiveLossState, trade.outcome, trade.exitReason);
    onMomentumTradeClosed(this.swingState, trade.direction);
    this.earlyExitContext = null;
    this.lastEarlyExitStatus = 'Inactive';
    updateSwingRelease(this.swingState, [...ctx.previous5m, ctx.candle5m]);
  }

  reset(): void {
    this.momentumStrategy.reset();
    this.consecutiveLossState = createConsecutiveLossState();
    this.swingState = createOneSignalPerSwingState();
    this.earlyExitContext = null;
    this.lastEarlyExitStatus = 'Inactive';
  }

  private buildBlockedSignal(
    candle: Candle,
    filterOutput: MomentumFilterOutput,
    reason: string,
    momentumSignal?: StrategySignal,
  ): StrategySignal {
    const entryPrice = candle.close;
    filterOutput.tradeAllowed = 'NO';
    filterOutput.finalDecision = 'NO_TRADE';
    filterOutput.reason = reason;

    return {
      strategyId: STRATEGY_THREE_ID,
      strategyName: 'Strategy 3 — Momentum Score',
      signalType: 'NO_TRADE',
      confidence: 0,
      entryPrice,
      stopLoss: entryPrice * 0.995,
      targetPrice: entryPrice * 1.01,
      riskRewardRatio: 2,
      trend: emptyModule('Blocked by momentum filter'),
      structure: emptyModule('Momentum strategy not executed'),
      pullback: emptyModule('N/A'),
      entry: {
        passed: false,
        action: 'NO_TRADE',
        entryPrice,
        confidence: 0,
        reason,
        checks: [{ name: 'Momentum Filter', passed: false, reason }],
      },
      volume: emptyModule('OHLC only'),
      momentum: emptyModule(
        momentumSignal ? 'Momentum evaluated but blocked by filter' : 'Momentum skipped by filter',
      ),
      allConditionsMet: false,
      timelinePhase: 'Trend',
      reasons: [reason],
      analysis: {
        currentOhlc: toOhlcSummary(candle),
        finalDecision: 'NO_TRADE',
        momentumFilters: filterOutput,
        momentumSkipped: !momentumSignal,
        ...(momentumSignal?.analysis ?? {}),
      },
    };
  }

  private buildFilterOutput(params: {
    current: Candle;
    candles5: Candle[];
    momentum: ReturnType<typeof calculateMomentumScore>;
    sidewaysFilter: ReturnType<typeof evaluateSidewaysMarketFilter>;
    consecutiveLoss: ReturnType<typeof evaluateConsecutiveLossFilter>;
    openingRange: ReturnType<typeof evaluateOpeningRangeFilter>;
    swingState: OneSignalPerSwingState;
    earlyExitStatus: string;
  }): MomentumFilterOutput {
    const swingHighs = detectSwingHighs(params.candles5);
    const swingLows = detectSwingLows(params.candles5);
    const currentTrend = detectStructureTrend(swingHighs, swingLows);

    return {
      currentOhlc: toOhlcSummary(params.current),
      momentumScore: params.momentum
        ? {
            bullish: params.momentum.bullishScore,
            bearish: params.momentum.bearishScore,
            winning: params.momentum.winningScore,
          }
        : null,
      marketState: params.sidewaysFilter.marketState,
      sidewaysScore: params.sidewaysFilter.sidewaysScore,
      priceCompression: params.sidewaysFilter.priceCompression,
      structureWeakness: params.sidewaysFilter.structureWeakness,
      overlapCount: params.sidewaysFilter.overlapCount,
      failedBreakouts: params.sidewaysFilter.failedBreakoutCount,
      currentTrend,
      consecutiveLosses: params.consecutiveLoss.consecutiveLosses,
      tradingPaused: params.consecutiveLoss.tradingPaused,
      openingRangeAllowed: params.openingRange.allowed,
      buySwingBlocked: params.swingState.buyBlockedUntilNewSwing,
      sellSwingBlocked: params.swingState.sellBlockedUntilNewSwing,
      earlyExitStatus: params.earlyExitStatus,
      tradeAllowed: 'NO',
      finalDecision: 'NO_TRADE',
      reason: '',
      sidewaysFilter: params.sidewaysFilter,
    };
  }
}

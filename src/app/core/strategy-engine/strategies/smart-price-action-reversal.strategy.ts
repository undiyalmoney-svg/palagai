import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../models/strategy-context.model';
import { ExitResult } from '../models/module-result.model';
import { OpenTrade } from '../models/open-trade.model';
import {
  StrategySignal,
  emptyModule,
  moduleFromCheck,
} from '../models/module-result.model';
import { TradingStrategy } from '../interfaces/trading-strategy.interface';
import { toOhlcSummary } from '../utils/ohlc-candle.util';
import {
  SMART_SPAR_STRATEGY_ID,
  SmartPriceActionReversalEvaluation,
  evaluateSmartPriceActionReversal,
} from '../utils/smart-price-action-reversal.util';
import {
  SparTradeContext,
  createSparTradeContext,
  evaluateSparEarlyExit,
} from '../utils/smart-reversal-exit.util';

export { SMART_SPAR_STRATEGY_ID };

@Injectable({ providedIn: 'root' })
export class SmartPriceActionReversalStrategy implements TradingStrategy {
  readonly id = SMART_SPAR_STRATEGY_ID;
  readonly name = 'Smart Price Action Reversal Engine V1';
  enabled = false;

  private readonly tradedDates = new Set<string>();
  private sparTradeContext: SparTradeContext | null = null;
  private lastEvaluation: SmartPriceActionReversalEvaluation | null = null;

  evaluate(ctx: StrategyContext): StrategySignal {
    const current = ctx.candle5m;
    const evaluation = evaluateSmartPriceActionReversal(ctx);
    this.lastEvaluation = evaluation;

    if (this.tradedDates.has(evaluation.tradingDate)) {
      return this.toSignal(current, evaluation, {
        direction: 'NO_TRADE',
        tradeAllowed: false,
        reason: 'One trade per day limit — already entered today',
      });
    }

    const tradeable =
      evaluation.tradeAllowed &&
      (evaluation.finalDecision === 'BUY' || evaluation.finalDecision === 'SELL');

    if (tradeable) {
      this.tradedDates.add(evaluation.tradingDate);
    }

    return this.toSignal(current, evaluation, {
      direction: evaluation.finalDecision,
      tradeAllowed: tradeable,
      reason: evaluation.reason,
    });
  }

  checkEarlyExit(ctx: StrategyContext, trade: OpenTrade): ExitResult | null {
    if (!this.sparTradeContext) {
      return null;
    }
    const candles5 = [...ctx.previous5m, ctx.candle5m];
    const previous = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
    return evaluateSparEarlyExit({
      context: this.sparTradeContext,
      candle: ctx.candle5m,
      previousCandle: previous,
      trade,
    });
  }

  onTradeOpened(trade: OpenTrade): void {
    const ev = this.lastEvaluation;
    if (!ev) {
      this.sparTradeContext = null;
      return;
    }
    this.sparTradeContext = createSparTradeContext({
      trade,
      structureReferenceLow: ev.structureReferenceLow,
      structureReferenceHigh: ev.structureReferenceHigh,
    });
  }

  onTradeClosed(): void {
    this.sparTradeContext = null;
  }

  reset(): void {
    this.tradedDates.clear();
    this.sparTradeContext = null;
    this.lastEvaluation = null;
  }

  private toSignal(
    candle: Candle,
    evaluation: SmartPriceActionReversalEvaluation,
    override: {
      direction: 'BUY' | 'SELL' | 'NO_TRADE';
      tradeAllowed: boolean;
      reason: string;
    },
  ): StrategySignal {
    const tradeable = override.tradeAllowed;
    const signalType = override.direction;
    const entryPrice = tradeable ? evaluation.entryPrice : candle.close;
    const stopLoss = tradeable ? evaluation.stopLoss : candle.close * 0.995;
    const targetPrice = tradeable ? evaluation.target3 : candle.close * 1.01;

    const analysis = {
      tradingDate: evaluation.tradingDate,
      direction: signalType,
      entryTime: tradeable ? candle.date : null,
      entryPrice: evaluation.entryPrice,
      stopLoss: evaluation.stopLoss,
      target1: evaluation.target1,
      target2: evaluation.target2,
      target3: evaluation.target3,
      risk: evaluation.risk,
      reward: evaluation.reward,
      riskRewardRatio: evaluation.riskRewardRatio,
      trend60m: evaluation.trend60m,
      trend30m: evaluation.trend30m,
      pullbackDetected: evaluation.pullbackDetected ? 'YES' : 'NO',
      breakOfStructure: evaluation.breakOfStructure ? 'YES' : 'NO',
      retest: evaluation.retestHeld ? 'YES' : 'NO',
      confirmationCandle: evaluation.confirmationCandle ? 'YES' : 'NO',
      qualityScore: evaluation.qualityScore,
      finalDecision: signalType,
      tradeTaken: tradeable ? 'YES' : 'NO',
      reason: override.reason,
      qualityBreakdown: evaluation.qualityBreakdown,
      currentOhlc: toOhlcSummary(candle),
    };

    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType,
      confidence: evaluation.qualityScore,
      entryPrice,
      stopLoss,
      targetPrice,
      riskRewardRatio: evaluation.riskRewardRatio,
      trend: moduleFromCheck(
        '60m Trend',
        evaluation.stages.trendAlignment,
        `60m: ${evaluation.trend60m}`,
      ),
      structure: moduleFromCheck(
        'Break of Structure',
        evaluation.breakOfStructure,
        evaluation.breakOfStructure ? 'BOS confirmed' : 'No BOS',
      ),
      pullback: moduleFromCheck(
        'Pullback + Retest',
        evaluation.pullbackDetected && evaluation.retestHeld,
        `Pullback ${evaluation.pullbackDetected ? 'YES' : 'NO'} · Retest ${evaluation.retestHeld ? 'YES' : 'NO'}`,
      ),
      entry: {
        passed: tradeable,
        action: tradeable ? signalType : 'NO_TRADE',
        entryPrice,
        confidence: evaluation.qualityScore,
        reason: override.reason,
        checks: [
          {
            name: 'Trend Alignment',
            passed: evaluation.stages.trendAlignment,
            reason: `${evaluation.trend60m} / ${evaluation.trend30m}`,
          },
          {
            name: 'Pullback',
            passed: evaluation.stages.pullback,
            reason: evaluation.pullbackDetected ? 'Detected' : 'Not detected',
          },
          {
            name: 'Break of Structure',
            passed: evaluation.stages.breakOfStructure,
            reason: evaluation.breakOfStructure ? 'YES' : 'NO',
          },
          {
            name: 'Retest',
            passed: evaluation.stages.retest,
            reason: evaluation.retestHeld ? 'Held' : 'Not held',
          },
          {
            name: 'Confirmation Candle',
            passed: evaluation.stages.confirmation,
            reason: evaluation.confirmationCandle ? 'Valid' : 'Invalid',
          },
          {
            name: 'Quality Score',
            passed: evaluation.qualityScore >= 90,
            reason: `${evaluation.qualityScore}/100`,
          },
        ],
      },
      volume: emptyModule('OHLC only'),
      momentum: emptyModule('OHLC only — no indicators'),
      allConditionsMet: tradeable,
      timelinePhase: tradeable
        ? 'Entry'
        : evaluation.retestHeld
          ? 'Pullback'
          : evaluation.breakOfStructure
            ? 'Structure'
            : 'Trend',
      reasons: [override.reason],
      analysis,
    };
  }
}

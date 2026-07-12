import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../models/strategy-context.model';
import {
  StrategySignal,
  emptyModule,
  moduleFromCheck,
} from '../models/module-result.model';
import { TradingStrategy } from '../interfaces/trading-strategy.interface';
import { toOhlcSummary } from '../utils/ohlc-candle.util';
import { evaluatePriceActionEngine } from '../utils/price-action-engine.util';

@Injectable({ providedIn: 'root' })
export class PriceActionEngineStrategy implements TradingStrategy {
  readonly id = 'price-action-engine';
  readonly name = 'Price Action Engine';
  enabled = false;

  /** Trading days where an entry signal was already issued (max one per day). */
  private readonly tradedDays = new Set<string>();

  evaluate(ctx: StrategyContext): StrategySignal {
    const current = ctx.candle5m;
    const evaluation = evaluatePriceActionEngine(ctx);

    if (this.tradedDays.has(evaluation.tradingDay)) {
      return this.buildSignal(current, evaluation, {
        signalType: 'NO_TRADE',
        tradeTaken: false,
        reason: 'Already traded today — one trade per day limit',
        noTradeReasons: ['Already traded today'],
      });
    }

    const tradeable = evaluation.tradeTaken && evaluation.signalType !== 'NO_TRADE';

    if (tradeable) {
      this.tradedDays.add(evaluation.tradingDay);
    }

    return this.buildSignal(current, evaluation, {
      signalType: evaluation.signalType,
      tradeTaken: tradeable,
      reason: evaluation.reason,
      noTradeReasons: evaluation.noTradeReasons,
    });
  }

  reset(): void {
    this.tradedDays.clear();
  }

  private buildSignal(
    candle: Candle,
    evaluation: ReturnType<typeof evaluatePriceActionEngine>,
    override: {
      signalType: 'BUY' | 'SELL' | 'NO_TRADE';
      tradeTaken: boolean;
      reason: string;
      noTradeReasons: string[];
    },
  ): StrategySignal {
    const tradeable = override.tradeTaken;
    const signalType = override.signalType;
    const entryPrice = tradeable ? evaluation.entryPrice : candle.close;
    const stopLoss = tradeable ? evaluation.stopLoss : entryPrice * 0.995;
    const targetPrice = tradeable ? evaluation.target2 : entryPrice * 1.01;
    const riskRewardRatio = tradeable ? evaluation.riskRewardRatio : 0;

    const analysis = {
      tradingDay: evaluation.tradingDay,
      trend: evaluation.trend,
      trend30m: evaluation.trend30m,
      support: evaluation.levels.majorSupport ?? evaluation.levels.latestSwingLow,
      resistance: evaluation.levels.majorResistance ?? evaluation.levels.latestSwingHigh,
      breakout: evaluation.levels.breakoutLevel,
      retest: evaluation.levels.retestLevel,
      levelType: evaluation.levelType,
      atSupport: evaluation.atSupport,
      atResistance: evaluation.atResistance,
      atBreakout: evaluation.atBreakout,
      atRetest: evaluation.atRetest,
      confirmationCandle: evaluation.confirmationValid ? 'Valid' : 'Invalid',
      confirmationReason: evaluation.confirmationReason,
      qualityScore: evaluation.qualityScore,
      qualityBreakdown: evaluation.qualityBreakdown,
      entry: evaluation.entryPrice,
      stopLoss: evaluation.stopLoss,
      target1: evaluation.target1,
      target2: evaluation.target2,
      target3: evaluation.target3,
      riskReward: evaluation.riskRewardRatio,
      tradeTaken: override.tradeTaken ? 'YES' : 'NO',
      reason: override.reason,
      finalDecision: signalType,
      noTradeReasons: override.noTradeReasons,
      currentOhlc: toOhlcSummary(candle),
      levels: evaluation.levels,
    };

    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType,
      confidence: evaluation.qualityScore,
      entryPrice,
      stopLoss,
      targetPrice,
      riskRewardRatio,
      trend: moduleFromCheck(
        '60m Trend',
        evaluation.trend !== 'Sideways',
        `60m trend: ${evaluation.trend}`,
      ),
      structure: moduleFromCheck(
        'Price Action Levels',
        evaluation.levelType !== 'None',
        `At ${evaluation.levelType}`,
      ),
      pullback: moduleFromCheck(
        '30m Confirmation',
        evaluation.trend30m === evaluation.trend,
        `30m: ${evaluation.trend30m}`,
      ),
      entry: {
        passed: tradeable,
        action: tradeable ? signalType : 'NO_TRADE',
        entryPrice,
        confidence: evaluation.qualityScore,
        reason: override.reason,
        checks: [
          { name: 'Trend', passed: evaluation.qualityBreakdown['trend'] === 20, reason: `${evaluation.trend}` },
          {
            name: 'Level',
            passed: evaluation.qualityBreakdown['level'] === 20,
            reason: evaluation.levelType,
          },
          {
            name: 'Confirmation',
            passed: evaluation.confirmationValid,
            reason: evaluation.confirmationReason,
          },
          {
            name: 'Structure',
            passed: evaluation.structureIntact,
            reason: evaluation.structureIntact ? 'Swing structure intact' : 'Structure broken',
          },
          {
            name: 'Risk Reward',
            passed: evaluation.riskRewardRatio >= 2,
            reason: `RR ${evaluation.riskRewardRatio.toFixed(2)}`,
          },
          {
            name: 'Quality Score',
            passed: evaluation.qualityScore >= 90,
            reason: `${evaluation.qualityScore}/100`,
          },
        ],
      },
      volume: emptyModule('OHLC only — no volume'),
      momentum: emptyModule('OHLC only — no indicators'),
      allConditionsMet: tradeable,
      timelinePhase: tradeable
        ? 'Entry'
        : evaluation.levelType !== 'None'
          ? 'Pullback'
          : evaluation.trend !== 'Sideways'
            ? 'Structure'
            : 'Trend',
      reasons: [override.reason, ...override.noTradeReasons],
      analysis,
    };
  }
}

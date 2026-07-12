import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../models/strategy-context.model';
import {
  StrategySignal,
  emptyModule,
  moduleFromCheck,
} from '../models/module-result.model';
import { TradingStrategy } from '../interfaces/trading-strategy.interface';
import {
  confidenceLabel,
  evaluateReversalSetup,
} from '../utils/reversal-detection.util';
import { toOhlcSummary } from '../utils/ohlc-candle.util';
import { calculateMomentumScore } from '../utils/momentum-score.util';

@Injectable({ providedIn: 'root' })
export class StrategyFive implements TradingStrategy {
  readonly id = 'strategy-five';
  readonly name = 'Strategy 5 — Multi-Stage Reversal';
  enabled = false;

  evaluate(ctx: StrategyContext): StrategySignal {
    const candles5 = [...ctx.previous5m, ctx.candle5m];
    const current = ctx.candle5m;

    if (candles5.length < 12) {
      return this.noTrade(current, 'Need at least 12 completed 5m candles');
    }

    const reversal = evaluateReversalSetup(candles5);
    const momentum = calculateMomentumScore(candles5);
    const tradeable = reversal.signalType === 'BUY' || reversal.signalType === 'SELL';

    const analysis = {
      currentOhlc: toOhlcSummary(current),
      marketTrend: reversal.marketTrend,
      trendWeakeningStatus: reversal.trendWeakeningStatus,
      changeOfCharacterStatus: reversal.chochStatus,
      breakOfStructureStatus: reversal.bosStatus,
      retestStatus: reversal.retestStatus,
      confirmationCandleStatus: reversal.confirmationStatus,
      momentumScore: momentum
        ? { bullish: momentum.bullishScore, bearish: momentum.bearishScore }
        : null,
      entryPrice: reversal.entryPrice,
      stopLoss: reversal.stopLoss,
      target1: reversal.target1,
      target2: reversal.target2,
      target3: reversal.target3,
      structuralTarget: reversal.structuralTarget,
      totalRisk: reversal.totalRisk,
      expectedReward: reversal.expectedReward,
      riskRewardRatio: reversal.riskRewardRatio,
      confidenceScore: reversal.confidenceScore,
      confidenceLabel: confidenceLabel(reversal.confidenceScore),
      stageBreakdown: reversal.stages,
      finalDecision: reversal.signalType,
      reason: reversal.reason,
    };

    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType: reversal.signalType,
      confidence: (reversal.confidenceScore / 6) * 100,
      entryPrice: reversal.entryPrice,
      stopLoss: reversal.stopLoss,
      targetPrice: reversal.target2,
      riskRewardRatio: reversal.riskRewardRatio,
      trend: moduleFromCheck(
        'Existing Trend',
        reversal.stages.trend,
        `Market trend: ${reversal.marketTrend}`,
      ),
      structure: moduleFromCheck(
        'Break of Structure',
        reversal.stages.bos,
        reversal.bosStatus,
      ),
      pullback: moduleFromCheck(
        'Retest',
        reversal.stages.retest,
        reversal.retestStatus,
      ),
      entry: {
        passed: tradeable,
        action: tradeable ? reversal.signalType : 'NO_TRADE',
        entryPrice: reversal.entryPrice,
        confidence: tradeable ? (reversal.confidenceScore / 6) * 100 : 0,
        reason: tradeable
          ? `${confidenceLabel(reversal.confidenceScore)} (${reversal.confidenceScore}/6)`
          : reversal.reason,
        checks: [
          { name: 'Trend', passed: reversal.stages.trend, reason: reversal.marketTrend },
          { name: 'Weakening', passed: reversal.stages.weakening, reason: reversal.trendWeakeningStatus },
          { name: 'CHOCH', passed: reversal.stages.choch, reason: reversal.chochStatus },
          { name: 'BOS', passed: reversal.stages.bos, reason: reversal.bosStatus },
          { name: 'Retest', passed: reversal.stages.retest, reason: reversal.retestStatus },
          { name: 'Confirmation', passed: reversal.stages.confirmation, reason: reversal.confirmationStatus },
        ],
      },
      volume: emptyModule('OHLC only — no volume'),
      momentum: moduleFromCheck(
        'Trend Weakening',
        reversal.stages.weakening,
        reversal.trendWeakeningStatus,
      ),
      allConditionsMet: tradeable,
      timelinePhase: tradeable
        ? 'Entry'
        : reversal.stages.retest
          ? 'Pullback'
          : reversal.stages.bos
            ? 'Structure'
            : reversal.stages.choch
              ? 'Structure'
              : 'Trend',
      reasons: [
        reversal.marketTrend,
        reversal.trendWeakeningStatus,
        reversal.chochStatus,
        reversal.bosStatus,
        reversal.retestStatus,
        reversal.confirmationStatus,
        `Confidence ${reversal.confidenceScore}/6`,
      ],
      analysis,
    };
  }

  reset(): void {}

  private noTrade(candle: Candle, reason: string): StrategySignal {
    const entryPrice = candle.close;
    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType: 'NO_TRADE',
      confidence: 0,
      entryPrice,
      stopLoss: entryPrice * 0.995,
      targetPrice: entryPrice * 1.01,
      riskRewardRatio: 0,
      trend: emptyModule(reason),
      structure: emptyModule(reason),
      pullback: emptyModule('N/A'),
      entry: {
        passed: false,
        action: 'NO_TRADE',
        entryPrice,
        confidence: 0,
        reason,
        checks: [],
      },
      volume: emptyModule('OHLC only'),
      momentum: emptyModule('N/A'),
      allConditionsMet: false,
      timelinePhase: 'Trend',
      reasons: [reason],
      analysis: {
        currentOhlc: toOhlcSummary(candle),
        finalDecision: 'NO_TRADE',
        confidenceScore: 0,
        reason,
      },
    };
  }
}

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
  averageBodySize,
  bodySize,
  calcLongLevels,
  calcShortLevels,
  midpoint,
  toOhlcSummary,
} from '../utils/ohlc-candle.util';
import { calculateMomentumScore } from '../utils/momentum-score.util';

@Injectable({ providedIn: 'root' })
export class StrategyThree implements TradingStrategy {
  readonly id = 'strategy-three';
  readonly name = 'Strategy 3 — Momentum Score';
  enabled = false;

  evaluate(ctx: StrategyContext): StrategySignal {
    const candles5 = [...ctx.previous5m, ctx.candle5m];
    const current = ctx.candle5m;
    const previous = candles5.length >= 2 ? candles5[candles5.length - 2] : null;

    const momentum = calculateMomentumScore(candles5);
    if (!previous || !momentum) {
      return this.noTrade(current, 'Insufficient candle history');
    }

    const { bullishScore, bearishScore, breakdown } = momentum;
    const signalType = this.scoreToSignal(bullishScore, bearishScore);
    const prior5 = candles5.slice(0, -1);
    const avgBody = averageBodySize(prior5, 5);
    const curBody = bodySize(current);
    const mid = midpoint(current);
    const winningScore = Math.max(bullishScore, bearishScore);
    const confidence = (winningScore / 5) * 100;

    const entryPrice = current.close;
    let stopLoss = 0;
    let targetPrice = 0;
    let riskRewardRatio = 0;

    if (this.isLong(signalType)) {
      const levels = calcLongLevels(entryPrice, previous.low, 2);
      stopLoss = levels.stopLoss;
      targetPrice = levels.targetPrice;
      riskRewardRatio = levels.riskRewardRatio;
    } else if (this.isShort(signalType)) {
      const levels = calcShortLevels(entryPrice, previous.high, 2);
      stopLoss = levels.stopLoss;
      targetPrice = levels.targetPrice;
      riskRewardRatio = levels.riskRewardRatio;
    } else {
      stopLoss = entryPrice * 0.995;
      targetPrice = entryPrice * 1.01;
      riskRewardRatio = 2;
    }

    const analysis = {
      currentCandle: toOhlcSummary(current),
      previousCandle: toOhlcSummary(previous),
      currentBodySize: curBody,
      averageBodySize5: avgBody,
      candleMidpoint: mid,
      higherHigh: current.high > previous.high,
      higherLow: current.low > previous.low,
      lowerHigh: current.high < previous.high,
      lowerLow: current.low < previous.low,
      candleDirection: current.close > current.open ? 'Bullish' : current.close < current.open ? 'Bearish' : 'Doji',
      bullishScore,
      bearishScore,
      confidencePct: confidence,
      scoreBreakdown: breakdown,
      finalDecision: signalType,
    };

    const tradeable = this.isLong(signalType) || this.isShort(signalType);

    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType,
      confidence,
      entryPrice,
      stopLoss,
      targetPrice,
      riskRewardRatio,
      trend: moduleFromCheck('HH/LL', current.high > previous.high || current.low < previous.low, breakdown['cond1'] ?? ''),
      structure: moduleFromCheck('HL/LH', current.low > previous.low || current.high < previous.high, breakdown['cond2'] ?? ''),
      pullback: emptyModule('Not used'),
      entry: {
        passed: tradeable,
        action: tradeable ? signalType : 'NO_TRADE',
        entryPrice,
        confidence,
        reason: `Bull ${bullishScore} / Bear ${bearishScore}`,
        checks: [{ name: 'Score', passed: tradeable, reason: `Winning score ${winningScore}/5` }],
      },
      volume: emptyModule('OHLC only'),
      momentum: moduleFromCheck('Momentum Score', tradeable, `Score ${winningScore}/5`),
      allConditionsMet: tradeable,
      timelinePhase: tradeable ? 'Entry' : 'Trend',
      reasons: Object.values(breakdown),
      analysis,
    };
  }

  reset(): void {}

  private scoreToSignal(bull: number, bear: number): StrategySignal['signalType'] {
    if (bull === 5 && bear === 0) {
      return 'STRONG_BUY';
    }
    if (bull === 4 && bear <= 1) {
      return 'BUY';
    }
    if (bull === 3 && bear <= 2) {
      return 'WEAK_BUY';
    }
    if (bear === 5 && bull === 0) {
      return 'STRONG_SELL';
    }
    if (bear === 4 && bull <= 1) {
      return 'SELL';
    }
    if (bear === 3 && bull <= 2) {
      return 'WEAK_SELL';
    }
    return 'NO_TRADE';
  }

  private isLong(type: StrategySignal['signalType']): boolean {
    return type === 'BUY' || type === 'STRONG_BUY' || type === 'WEAK_BUY';
  }

  private isShort(type: StrategySignal['signalType']): boolean {
    return type === 'SELL' || type === 'STRONG_SELL' || type === 'WEAK_SELL';
  }

  private noTrade(candle: Candle, reason: string): StrategySignal {
    const ep = candle.close;
    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType: 'NO_TRADE',
      confidence: 0,
      entryPrice: ep,
      stopLoss: ep * 0.995,
      targetPrice: ep * 1.01,
      riskRewardRatio: 2,
      trend: emptyModule(reason),
      structure: emptyModule(reason),
      pullback: emptyModule('N/A'),
      entry: { passed: false, action: 'NO_TRADE', entryPrice: ep, confidence: 0, reason, checks: [] },
      volume: emptyModule('N/A'),
      momentum: emptyModule('N/A'),
      allConditionsMet: false,
      timelinePhase: 'Trend',
      reasons: [reason],
      analysis: { finalDecision: 'NO_TRADE' },
    };
  }
}

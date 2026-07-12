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
  calculateMomentumScore,
  meetsBuyMomentum,
  meetsSellMomentum,
} from '../utils/momentum-score.util';
import {
  calculateRiskTargets,
  detectStructureTrend,
  detectSwingHighs,
  detectSwingLows,
  latestSwingLevels,
  nearestResistanceAbove,
  nearestSupportBelow,
  rankStoredLevels,
  safetyBuffer,
  scanBuyPullbackSetup,
  scanSellPullbackSetup,
  toMarketBias,
} from '../utils/swing-level.util';
import { toOhlcSummary } from '../utils/ohlc-candle.util';

@Injectable({ providedIn: 'root' })
export class StrategyTwo implements TradingStrategy {
  readonly id = 'strategy-two';
  readonly name = 'Strategy 2 — S/R Pullback + Momentum';
  enabled = false;

  evaluate(ctx: StrategyContext): StrategySignal {
    const candles5 = [...ctx.previous5m, ctx.candle5m];
    const current = ctx.candle5m;

    if (candles5.length < 7) {
      return this.noTrade(current, 'Need at least 7 completed 5m candles for swing detection');
    }

    const swingHighs = detectSwingHighs(candles5);
    const swingLows = detectSwingLows(candles5);
    const stored = latestSwingLevels(swingHighs, swingLows);
    const ranked = rankStoredLevels(current.close, swingHighs, swingLows);
    const trend = detectStructureTrend(swingHighs, swingLows);
    const momentum = calculateMomentumScore(candles5);

    const buySetup = scanBuyPullbackSetup(candles5);
    const sellSetup = scanSellPullbackSetup(candles5);

    let signalType: StrategySignal['signalType'] = 'NO_TRADE';
    let direction: 'BUY' | 'SELL' | null = null;
    let activeSetup = buySetup;
    let stopLoss = 0;
    let entryPrice = current.close;
    let structuralTarget: number | null = null;

    const buyReady =
      trend === 'Bullish' &&
      momentum !== null &&
      meetsBuyMomentum(momentum) &&
      buySetup.detected &&
      buySetup.pullbackValid &&
      buySetup.confirmationValid;

    const sellReady =
      trend === 'Bearish' &&
      momentum !== null &&
      meetsSellMomentum(momentum) &&
      sellSetup.detected &&
      sellSetup.pullbackValid &&
      sellSetup.confirmationValid;

    if (buyReady) {
      signalType = 'BUY';
      direction = 'BUY';
      activeSetup = buySetup;
      stopLoss = buySetup.pullbackLow - safetyBuffer(buySetup.pullbackLow);
      structuralTarget = nearestResistanceAbove(entryPrice, stored.resistances);
    } else if (sellReady) {
      signalType = 'SELL';
      direction = 'SELL';
      activeSetup = sellSetup;
      stopLoss = sellSetup.pullbackHigh + safetyBuffer(sellSetup.pullbackHigh);
      structuralTarget = nearestSupportBelow(entryPrice, stored.supports);
    } else {
      stopLoss = current.close * 0.995;
    }

    const targets =
      direction !== null
        ? calculateRiskTargets({
            direction,
            entryPrice,
            stopLoss,
            structuralTarget,
          })
        : {
            risk: 0,
            target1: current.close,
            target2: current.close,
            target3: current.close,
            structuralTarget,
            recommendedTarget: current.close,
            expectedReward: 0,
            riskRewardRatio: 0,
          };

    const tradeable = signalType === 'BUY' || signalType === 'SELL';
    const breakoutStatus = buySetup.detected
      ? `Resistance broken @ ${buySetup.breakoutLevel.toFixed(2)}`
      : sellSetup.detected
        ? `Support broken @ ${sellSetup.breakoutLevel.toFixed(2)}`
        : ranked.nearestResistance
          ? `Watching resistance @ ${ranked.nearestResistance.toFixed(2)}`
          : ranked.nearestSupport
            ? `Watching support @ ${ranked.nearestSupport.toFixed(2)}`
            : 'No breakout';

    const analysis = {
      currentOhlc: toOhlcSummary(current),
      trend,
      marketBias: toMarketBias(trend),
      supportLevels: ranked.supports,
      resistanceLevels: ranked.resistances,
      storedSupportLevels: stored.supports,
      storedResistanceLevels: stored.resistances,
      nearestSupport: ranked.nearestSupport,
      nearestResistance: ranked.nearestResistance,
      swingHighCount: swingHighs.length,
      swingLowCount: swingLows.length,
      breakoutStatus,
      pullbackStatus: activeSetup.pullbackValid ? 'Valid pullback' : 'No valid pullback',
      confirmationStatus: activeSetup.confirmationValid ? 'Confirmed' : 'Not confirmed',
      momentumScore: momentum
        ? {
            bullish: momentum.bullishScore,
            bearish: momentum.bearishScore,
            breakdown: momentum.breakdown,
          }
        : null,
      buySetup: {
        detected: buySetup.detected,
        breakoutLevel: buySetup.breakoutLevel,
        pullbackValid: buySetup.pullbackValid,
        confirmationValid: buySetup.confirmationValid,
        reason: buySetup.reason,
      },
      sellSetup: {
        detected: sellSetup.detected,
        breakoutLevel: sellSetup.breakoutLevel,
        pullbackValid: sellSetup.pullbackValid,
        confirmationValid: sellSetup.confirmationValid,
        reason: sellSetup.reason,
      },
      entryPrice,
      stopLoss,
      target1: targets.target1,
      target2: targets.target2,
      target3: targets.target3,
      structuralTarget: targets.structuralTarget,
      recommendedTarget: targets.recommendedTarget,
      totalRisk: targets.risk,
      expectedReward: targets.expectedReward,
      riskRewardRatio: targets.riskRewardRatio,
      finalDecision: signalType,
    };

    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType,
      confidence: tradeable ? Math.min(95, targets.riskRewardRatio * 30 + 50) : 0,
      entryPrice,
      stopLoss: tradeable ? stopLoss : current.close * 0.995,
      targetPrice: targets.recommendedTarget,
      riskRewardRatio: targets.riskRewardRatio,
      trend: moduleFromCheck(
        'Structure Trend',
        trend !== 'Sideways',
        trend === 'Bullish'
          ? 'Bullish — higher swing highs & lows'
          : trend === 'Bearish'
            ? 'Bearish — lower swing highs & lows'
            : 'Sideways — no clear structure',
      ),
      structure: moduleFromCheck(
        'Breakout',
        buySetup.detected || sellSetup.detected,
        breakoutStatus,
      ),
      pullback: moduleFromCheck(
        'Pullback',
        activeSetup.pullbackValid,
        activeSetup.pullbackValid ? 'Valid pullback to broken level' : 'Pullback not confirmed',
      ),
      entry: {
        passed: tradeable,
        action: tradeable ? signalType : 'NO_TRADE',
        entryPrice,
        confidence: tradeable ? 85 : 0,
        reason: tradeable
          ? activeSetup.reason
          : this.entryFailureReason(trend, momentum, buySetup, sellSetup),
        checks: [
          { name: 'Trend', passed: trend !== 'Sideways', reason: trend },
          {
            name: 'Momentum',
            passed:
              momentum !== null &&
              (meetsBuyMomentum(momentum) || meetsSellMomentum(momentum)),
            reason: momentum
              ? `Bull ${momentum.bullishScore} / Bear ${momentum.bearishScore}`
              : 'No momentum data',
          },
          { name: 'Breakout', passed: buySetup.detected || sellSetup.detected, reason: breakoutStatus },
          { name: 'Pullback', passed: activeSetup.pullbackValid, reason: analysis.pullbackStatus as string },
          {
            name: 'Confirmation',
            passed: activeSetup.confirmationValid,
            reason: analysis.confirmationStatus as string,
          },
        ],
      },
      volume: emptyModule('OHLC only — no volume'),
      momentum: moduleFromCheck(
        'Momentum Score',
        momentum !== null && (meetsBuyMomentum(momentum) || meetsSellMomentum(momentum)),
        momentum ? `Bull ${momentum.bullishScore}/5, Bear ${momentum.bearishScore}/5` : 'N/A',
      ),
      allConditionsMet: tradeable,
      timelinePhase: tradeable
        ? 'Entry'
        : activeSetup.pullbackValid
          ? 'Pullback'
          : buySetup.detected || sellSetup.detected
            ? 'Structure'
            : 'Trend',
      reasons: [
        `Trend: ${trend}`,
        breakoutStatus,
        analysis.pullbackStatus as string,
        analysis.confirmationStatus as string,
        momentum
          ? `Momentum Bull ${momentum.bullishScore}/5 Bear ${momentum.bearishScore}/5`
          : 'Momentum N/A',
      ],
      analysis,
    };
  }

  reset(): void {}

  private entryFailureReason(
    trend: string,
    momentum: ReturnType<typeof calculateMomentumScore>,
    buySetup: ReturnType<typeof scanBuyPullbackSetup>,
    sellSetup: ReturnType<typeof scanSellPullbackSetup>,
  ): string {
    if (trend === 'Sideways') {
      return 'Market sideways — no trade';
    }
    if (!momentum) {
      return 'Insufficient data for momentum score';
    }
    if (trend === 'Bullish' && !meetsBuyMomentum(momentum)) {
      return `Momentum too weak for BUY (${momentum.bullishScore}/5, need 4+)`;
    }
    if (trend === 'Bearish' && !meetsSellMomentum(momentum)) {
      return `Momentum too weak for SELL (${momentum.bearishScore}/5, need 4+)`;
    }
    if (!buySetup.detected && !sellSetup.detected) {
      return 'No breakout of key S/R level';
    }
    if (!buySetup.pullbackValid && !sellSetup.pullbackValid) {
      return 'Pullback not valid';
    }
    return 'Confirmation candle not met';
  }

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
        trend: 'Sideways',
        finalDecision: 'NO_TRADE',
        reason,
      },
    };
  }
}

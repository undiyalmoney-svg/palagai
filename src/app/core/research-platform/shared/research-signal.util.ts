import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import {
  StrategySignal,
  emptyModule,
  moduleFromCheck,
} from '../../strategy-engine/models/module-result.model';
import { ResearchStrategyResult } from '../interfaces/research-strategy.interface';
import { toOhlcSummary } from '../../strategy-engine/utils/ohlc-candle.util';

export function extractTradingDate(dateTime: string): string {
  return dateTime.includes('T') ? dateTime.split('T')[0]! : dateTime.slice(0, 10);
}

export function toStrategySignal(params: {
  strategyId: string;
  strategyName: string;
  candle: Candle;
  result: ResearchStrategyResult;
}): StrategySignal {
  const { strategyId, strategyName, candle, result } = params;
  const tradeable = result.action === 'BUY' || result.action === 'SELL';

  return {
    strategyId,
    strategyName,
    signalType: result.action,
    confidence: tradeable ? Math.min(result.riskRewardRatio * 25, 100) : 0,
    entryPrice: tradeable ? result.entryPrice : candle.close,
    stopLoss: tradeable ? result.stopLoss : candle.close * 0.995,
    targetPrice: tradeable ? result.target : candle.close * 1.01,
    riskRewardRatio: result.riskRewardRatio,
    trend: moduleFromCheck('Trend', tradeable, String(result.analysis['trend'] ?? 'N/A')),
    structure: moduleFromCheck('Structure', tradeable, String(result.analysis['structure'] ?? 'N/A')),
    pullback: moduleFromCheck('Pullback', tradeable, String(result.analysis['pullback'] ?? 'N/A')),
    entry: {
      passed: tradeable,
      action: result.action,
      entryPrice: tradeable ? result.entryPrice : candle.close,
      confidence: tradeable ? Math.min(result.riskRewardRatio * 25, 100) : 0,
      reason: result.reason,
      checks: [{ name: result.action, passed: tradeable, reason: result.reason }],
    },
    volume: emptyModule('OHLC only'),
    momentum: emptyModule('OHLC only'),
    allConditionsMet: tradeable,
    timelinePhase: tradeable ? 'Entry' : 'Trend',
    reasons: [result.reason],
    analysis: {
      ...result.analysis,
      finalDecision: result.action,
      entryPrice: result.entryPrice,
      stopLoss: result.stopLoss,
      target: result.target,
      reason: result.reason,
      currentOhlc: toOhlcSummary(candle),
    },
  };
}

export function noTradeResult(candle: Candle, reason: string, analysis: Record<string, unknown> = {}): ResearchStrategyResult {
  return {
    action: 'NO_TRADE',
    entryPrice: candle.close,
    stopLoss: candle.close * 0.995,
    target: candle.close * 1.01,
    riskRewardRatio: 0,
    reason,
    analysis: { ...analysis, finalDecision: 'NO_TRADE' },
  };
}

export function calcTargets(params: {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  structuralTarget: number | null;
  minRr?: number;
}): { target: number; riskRewardRatio: number } {
  const minRr = params.minRr ?? 2;
  const risk =
    params.direction === 'BUY'
      ? params.entryPrice - params.stopLoss
      : params.stopLoss - params.entryPrice;

  if (risk <= 0) {
    return { target: params.entryPrice, riskRewardRatio: 0 };
  }

  const rrTarget =
    params.direction === 'BUY'
      ? params.entryPrice + risk * minRr
      : params.entryPrice - risk * minRr;

  let target = rrTarget;
  if (params.structuralTarget !== null) {
    if (params.direction === 'BUY') {
      const structural =
        params.structuralTarget > params.entryPrice && params.structuralTarget < rrTarget
          ? params.structuralTarget
          : rrTarget;
      target = structural;
    } else {
      const structural =
        params.structuralTarget < params.entryPrice && params.structuralTarget > rrTarget
          ? params.structuralTarget
          : rrTarget;
      target = structural;
    }
  }

  const reward =
    params.direction === 'BUY' ? target - params.entryPrice : params.entryPrice - target;

  return { target, riskRewardRatio: reward / risk };
}

export class OneTradePerDayGate {
  private readonly tradedDates = new Set<string>();

  reset(): void {
    this.tradedDates.clear();
  }

  canTrade(tradingDate: string): boolean {
    return !this.tradedDates.has(tradingDate);
  }

  markTraded(tradingDate: string): void {
    this.tradedDates.add(tradingDate);
  }
}

export function previousCompletedHourBar(ctx: StrategyContext): Candle | null {
  const candles60 = [...ctx.previous60m, ctx.candle60m];
  if (candles60.length < 2) {
    return null;
  }
  return candles60[candles60.length - 2]!;
}

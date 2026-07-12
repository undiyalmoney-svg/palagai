import { Injectable } from '@angular/core';
import { StrategyContext } from '../../models/strategy-context.model';
import { StrategySignal, emptyModule, moduleFromCheck } from '../../models/module-result.model';
import { TradingStrategy } from '../../interfaces/trading-strategy.interface';
import { STRATEGY_IDS } from '../../../config/strategy-ids.config';
import {
  createFirstHourBreakoutState,
  runFirstHourBreakout,
} from './first-hour-breakout.evaluator';

@Injectable({ providedIn: 'root' })
export class FirstHourBreakoutStrategy implements TradingStrategy {
  readonly id = STRATEGY_IDS.FIRST_HOUR_BREAKOUT;
  readonly name = 'First Hour Breakout';
  enabled = true;

  private readonly state = createFirstHourBreakoutState();

  evaluate(ctx: StrategyContext): StrategySignal {
    const regime = ctx.marketRegime ?? 'UNKNOWN';
    const result = runFirstHourBreakout(ctx, this.state, regime);
    const tradeable = result.action === 'BUY' || result.action === 'SELL';

    const debug = result.analysis['debug'] as Record<string, unknown> | undefined;

    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType: result.action,
      confidence: tradeable ? Number((result.analysis['entryQuality'] as { total?: number })?.total ?? 80) : 0,
      entryPrice: tradeable ? result.entryPrice : ctx.candle5m.close,
      stopLoss: tradeable ? result.stopLoss : ctx.candle5m.close,
      targetPrice: tradeable ? result.target : ctx.candle5m.close,
      riskRewardRatio: result.riskRewardRatio,
      trend: moduleFromCheck('Market Regime', regime === 'TRENDING', String(regime)),
      structure: moduleFromCheck('Breakout', result.analysis['currentStep'] === 'Breakout' || tradeable, result.reason),
      pullback: emptyModule('N/A'),
      entry: {
        passed: tradeable,
        action: tradeable ? result.action : result.action,
        entryPrice: tradeable ? result.entryPrice : ctx.candle5m.close,
        confidence: tradeable ? 80 : 0,
        reason: result.reason,
        checks: [
          {
            name: String(debug?.['currentStep'] ?? result.action),
            passed: tradeable,
            reason: result.reason,
            value: String(debug?.['actualValue'] ?? result.action),
          },
        ],
      },
      volume: emptyModule('OHLC only'),
      momentum: emptyModule('OHLC only'),
      allConditionsMet: tradeable,
      timelinePhase: tradeable ? 'Entry' : 'Trend',
      reasons: [result.reason],
      analysis: result.analysis,
    };
  }

  reset(): void {
    Object.assign(this.state, createFirstHourBreakoutState());
  }
}

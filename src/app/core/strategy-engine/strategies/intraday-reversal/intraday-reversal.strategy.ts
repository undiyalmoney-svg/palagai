import { Injectable } from '@angular/core';
import { StrategyContext } from '../../models/strategy-context.model';
import { StrategySignal, emptyModule, moduleFromCheck } from '../../models/module-result.model';
import { TradingStrategy } from '../../interfaces/trading-strategy.interface';
import { STRATEGY_IDS } from '../../../config/strategy-ids.config';
import {
  createIntradayReversalState,
  runIntradayReversal,
} from './intraday-reversal.evaluator';

@Injectable({ providedIn: 'root' })
export class IntradayReversalStrategy implements TradingStrategy {
  readonly id = STRATEGY_IDS.INTRADAY_REVERSAL;
  readonly name = 'Intraday Reversal';
  enabled = true;

  private readonly state = createIntradayReversalState();

  evaluate(ctx: StrategyContext): StrategySignal {
    const regime = ctx.marketRegime ?? 'UNKNOWN';
    const result = runIntradayReversal(ctx, this.state, regime);
    const tradeable = result.action === 'BUY' || result.action === 'SELL';
    const debug = result.analysis['debug'] as Record<string, unknown> | undefined;

    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType: result.action,
      confidence: tradeable
        ? Number((result.analysis['entryQuality'] as { total?: number })?.total ?? 80)
        : 0,
      entryPrice: tradeable ? result.entryPrice : ctx.candle5m.close,
      stopLoss: tradeable ? result.stopLoss : ctx.candle5m.close,
      targetPrice: tradeable ? result.target : ctx.candle5m.close,
      riskRewardRatio: result.riskRewardRatio,
      trend: moduleFromCheck(
        'Trend Exhaustion',
        !!(result.analysis['stages'] as { weakening?: boolean } | undefined)?.weakening,
        String(result.analysis['marketTrend'] ?? 'N/A'),
      ),
      structure: moduleFromCheck('CHoCH/BOS', tradeable, String(result.analysis['choch'] ?? '')),
      pullback: moduleFromCheck('Retest', tradeable, String(result.analysis['retest'] ?? '')),
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
      momentum: moduleFromCheck('Confirmation', tradeable, String(result.analysis['confirmation'] ?? '')),
      allConditionsMet: tradeable,
      timelinePhase: tradeable ? 'Entry' : 'Structure',
      reasons: [result.reason],
      analysis: result.analysis,
    };
  }

  reset(): void {
    Object.assign(this.state, createIntradayReversalState());
  }
}

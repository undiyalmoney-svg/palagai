import { TradingStrategy } from '../../strategy-engine/interfaces/trading-strategy.interface';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import {
  ExitResult,
  StrategySignal,
  emptyModule,
  moduleFromCheck,
} from '../../strategy-engine/models/module-result.model';
import { OpenTrade } from '../../strategy-engine/models/open-trade.model';
import { IManagedStrategy } from '../models/strategy-module.interface';
import { HistoricalTrade } from '../../models/historical-test.model';

/**
 * Adapts an IManagedStrategy module into the legacy TradingStrategy /
 * backtest plugin path — same DNA, no duplicated logic.
 */
export class ManagedStrategyTradingAdapter implements TradingStrategy {
  enabled = false;

  constructor(private readonly module: IManagedStrategy) {}

  get id(): string {
    return this.module.id;
  }

  get name(): string {
    return this.module.name;
  }

  evaluate(ctx: StrategyContext): StrategySignal {
    const result = this.module.generateSignal(ctx);
    const tradeable = result.action === 'BUY' || result.action === 'SELL';
    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType: result.action,
      confidence: tradeable ? 80 : 0,
      entryPrice: tradeable ? result.entryPrice : ctx.candle5m.close,
      stopLoss: tradeable ? result.stopLoss : ctx.candle5m.close,
      targetPrice: tradeable ? result.target : ctx.candle5m.close,
      riskRewardRatio: result.riskRewardRatio,
      trend: moduleFromCheck('Managed', true, this.module.description),
      structure: emptyModule('N/A'),
      pullback: emptyModule('N/A'),
      entry: {
        passed: tradeable,
        action: result.action,
        entryPrice: tradeable ? result.entryPrice : ctx.candle5m.close,
        confidence: tradeable ? 80 : 0,
        reason: result.reason,
        checks: [
          {
            name: this.name,
            passed: tradeable,
            reason: result.reason,
          },
        ],
      },
      volume: emptyModule('OHLC'),
      momentum: emptyModule(this.module.id),
      allConditionsMet: tradeable,
      timelinePhase: tradeable ? 'Entry' : 'Trend',
      reasons: [result.reason],
      analysis: result.analysis,
    };
  }

  checkEarlyExit(ctx: StrategyContext, trade: OpenTrade): ExitResult | null {
    const closes = [...ctx.previous5m, ctx.candle5m].map((c) => c.close);
    const decision = this.module.exitLogic(
      ctx.candle5m,
      {
        direction: trade.direction,
        entry: trade.entryPrice,
        stop: trade.stopLoss,
        target: trade.targetPrice,
        entryTime: trade.entryTime,
      },
      closes,
      ctx,
    );
    if (!decision) {
      return null;
    }
    // Only treat non-SL/TP as "early" exits for TradeEngine; SL/TP handled elsewhere.
    if (decision.reason === 'Stop loss hit' || decision.reason === 'Target hit') {
      return null;
    }
    const points =
      trade.direction === 'BUY'
        ? decision.exitPrice - trade.entryPrice
        : trade.entryPrice - decision.exitPrice;
    return {
      shouldExit: true,
      exitPrice: decision.exitPrice,
      exitReason: decision.reason,
      outcome: points >= 0 ? 'WIN' : 'LOSS',
    };
  }

  onTradeClosed(trade: HistoricalTrade): void {
    this.module.onTradeClosed?.(trade.points, trade.entryTime?.slice(0, 10) ?? '');
  }

  reset(): void {
    this.module.reset();
  }
}

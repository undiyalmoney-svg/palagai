import { TradingStrategy } from '../../strategy-engine/interfaces/trading-strategy.interface';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import {
  ExitResult,
  StrategySignal,
} from '../../strategy-engine/models/module-result.model';
import { OpenTrade } from '../../strategy-engine/models/open-trade.model';
import { Signal, StrategyResult } from '../../domain';
import { ExitPolicy } from '../../trading/models/exit-policy.model';
import { IStrategyPlugin } from '../interfaces/strategy-plugin.interface';

type StrategyWithHooks = TradingStrategy & {
  checkEarlyExit?(ctx: StrategyContext, trade: OpenTrade): ExitResult | null;
  onTradeOpened?(trade: OpenTrade, ctx: StrategyContext): void;
  onTradeClosed?(trade: import('../../models/historical-test.model').HistoricalTrade, ctx: StrategyContext): void;
};

/** Wraps any TradingStrategy as a standardized plugin. */
export class TradingStrategyPlugin implements IStrategyPlugin {
  readonly exitPolicy: ExitPolicy;

  constructor(
    private readonly strategy: StrategyWithHooks,
    exitPolicy: ExitPolicy,
  ) {
    this.exitPolicy = exitPolicy;
  }

  get id(): string {
    return this.strategy.id;
  }

  get name(): string {
    return this.strategy.name;
  }

  get version(): number {
    return 1;
  }

  get enabled(): boolean {
    return this.strategy.enabled;
  }

  set enabled(value: boolean) {
    this.strategy.enabled = value;
  }

  initialize(): void {
    this.strategy.reset();
  }

  evaluate(ctx: StrategyContext): StrategyResult {
    const signal = this.strategy.evaluate(ctx);
    const tradeable = signal.signalType === 'BUY' || signal.signalType === 'SELL';
    const action = (tradeable ? signal.signalType : 'NO_TRADE') as StrategyResult['action'];
    return {
      action,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      target: signal.targetPrice,
      confidence: signal.confidence,
      riskRewardRatio: signal.riskRewardRatio,
      reason: signal.reasons[0] ?? '',
      analysis: signal.analysis,
    };
  }

  generateSignal(ctx: StrategyContext): StrategySignal {
    return this.strategy.evaluate(ctx);
  }

  calculateStopLoss(ctx: StrategyContext, entryPrice: number, direction: 'BUY' | 'SELL'): number {
    const signal = this.strategy.evaluate(ctx);
    if (signal.signalType === 'BUY' || signal.signalType === 'SELL') {
      return signal.stopLoss;
    }
    return direction === 'BUY' ? entryPrice * 0.99 : entryPrice * 1.01;
  }

  calculateTarget(
    ctx: StrategyContext,
    entryPrice: number,
    stopLoss: number,
    direction: 'BUY' | 'SELL',
  ): { target: number; riskRewardRatio: number } {
    const signal = this.strategy.evaluate(ctx);
    if (signal.signalType === 'BUY' || signal.signalType === 'SELL') {
      return { target: signal.targetPrice, riskRewardRatio: signal.riskRewardRatio };
    }
    const risk = Math.abs(entryPrice - stopLoss);
    const target = direction === 'BUY' ? entryPrice + risk * 10 : entryPrice - risk * 10;
    return { target, riskRewardRatio: 10 };
  }

  reset(): void {
    this.strategy.reset();
  }

  checkEarlyExit(ctx: StrategyContext, trade: OpenTrade): ExitResult | null {
    return this.strategy.checkEarlyExit?.(ctx, trade) ?? null;
  }

  onTradeOpened(trade: OpenTrade, ctx: StrategyContext): void {
    this.strategy.onTradeOpened?.(trade, ctx);
  }

  onTradeClosed(
    trade: import('../../models/historical-test.model').HistoricalTrade,
    ctx: StrategyContext,
  ): void {
    this.strategy.onTradeClosed?.(trade, ctx);
  }

  toDomainSignal(result: StrategyResult, ctx: StrategyContext): Signal {
    return {
      action: result.action,
      entryPrice: result.entryPrice,
      stopLoss: result.stopLoss,
      target: result.target,
      confidence: result.confidence,
      riskRewardRatio: result.riskRewardRatio,
      reason: result.reason,
      debug: {
        strategyId: this.id,
        timestamp: ctx.candle5m.date,
        modules: {},
        blockingReasons: result.action === 'NO_TRADE' ? [result.reason] : [],
        metadata: result.analysis,
      },
    };
  }
}

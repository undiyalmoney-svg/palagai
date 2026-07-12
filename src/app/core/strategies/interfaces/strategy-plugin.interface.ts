import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { ExitResult, StrategySignal } from '../../strategy-engine/models/module-result.model';
import { OpenTrade } from '../../strategy-engine/models/open-trade.model';
import { HistoricalTrade } from '../../models/historical-test.model';
import { Signal, StrategyResult } from '../../domain';
import { ExitPolicy } from '../../trading/models/exit-policy.model';

/** Lifecycle hooks — optional per-strategy trade management extensions. */
export interface StrategyLifecycleHooks {
  onTradeOpened?(trade: OpenTrade, ctx: StrategyContext): void;
  onTradeClosed?(trade: HistoricalTrade, ctx: StrategyContext): void;
  checkEarlyExit?(ctx: StrategyContext, trade: OpenTrade): ExitResult | null;
}

/**
 * Standard strategy plugin contract.
 * Every strategy must implement this interface to participate in backtesting.
 */
export interface IStrategyPlugin extends StrategyLifecycleHooks {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  enabled: boolean;
  readonly exitPolicy: ExitPolicy;

  initialize(): void;
  evaluate(ctx: StrategyContext): StrategyResult;
  generateSignal(ctx: StrategyContext): StrategySignal;
  calculateStopLoss(ctx: StrategyContext, entryPrice: number, direction: 'BUY' | 'SELL'): number;
  calculateTarget(
    ctx: StrategyContext,
    entryPrice: number,
    stopLoss: number,
    direction: 'BUY' | 'SELL',
  ): { target: number; riskRewardRatio: number };
  reset(): void;

  /** Convert internal result to standardized domain signal. */
  toDomainSignal(result: StrategyResult, ctx: StrategyContext): Signal;
}

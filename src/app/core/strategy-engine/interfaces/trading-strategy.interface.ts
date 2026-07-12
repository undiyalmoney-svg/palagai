import { StrategyContext } from '../models/strategy-context.model';
import { StrategySignal } from '../models/module-result.model';

export interface TradingStrategy {
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  evaluate(ctx: StrategyContext): StrategySignal;
  reset(): void;
}

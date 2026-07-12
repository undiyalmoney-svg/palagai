import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { TradingStrategy } from '../../strategy-engine/interfaces/trading-strategy.interface';
import {
  RESEARCH_STRATEGY_IDS,
  PAUSED_STRATEGY_IDS,
} from '../../config/strategy-ids.config';

export interface ResearchStrategyResult {
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  entryPrice: number;
  stopLoss: number;
  target: number;
  riskRewardRatio: number;
  reason: string;
  analysis: Record<string, unknown>;
}

export interface ResearchStrategy extends TradingStrategy {
  readonly version: number;
  runStrategy(ctx: StrategyContext): ResearchStrategyResult;
}

export { RESEARCH_STRATEGY_IDS, PAUSED_STRATEGY_IDS };

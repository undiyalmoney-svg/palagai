import { ResearchStrategy } from '../../research-platform/interfaces/research-strategy.interface';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { StrategySignal } from '../../strategy-engine/models/module-result.model';
import { Signal, StrategyResult } from '../../domain';
import { STRATEGY_IDS } from '../../config/strategy-ids.config';
import { SESSION_CLOSE_EXIT_POLICY, DEFAULT_EXIT_POLICY, ExitPolicyConfig } from '../../trading/models/exit-policy.model';
import { IStrategyPlugin } from '../interfaces/strategy-plugin.interface';

/** Wraps a ResearchStrategy as a standardized plugin without modifying evaluator logic. */
export class ResearchStrategyPlugin implements IStrategyPlugin {
  readonly exitPolicy: ExitPolicyConfig['policy'];

  constructor(private readonly strategy: ResearchStrategy) {
    this.exitPolicy =
      strategy.id === STRATEGY_IDS.HOUR_BREAKOUT
        ? SESSION_CLOSE_EXIT_POLICY.policy
        : DEFAULT_EXIT_POLICY.policy;
  }

  get id(): string {
    return this.strategy.id;
  }

  get name(): string {
    return this.strategy.name;
  }

  get version(): number {
    return this.strategy.version;
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
    const result = this.strategy.runStrategy(ctx);
    return {
      action: result.action,
      entryPrice: result.entryPrice,
      stopLoss: result.stopLoss,
      target: result.target,
      confidence: result.riskRewardRatio * 25,
      riskRewardRatio: result.riskRewardRatio,
      reason: result.reason,
      analysis: result.analysis,
    };
  }

  generateSignal(ctx: StrategyContext): StrategySignal {
    return this.strategy.evaluate(ctx);
  }

  calculateStopLoss(ctx: StrategyContext, entryPrice: number, direction: 'BUY' | 'SELL'): number {
    const result = this.strategy.runStrategy(ctx);
    if (result.action === 'NO_TRADE') {
      return direction === 'BUY' ? entryPrice * 0.99 : entryPrice * 1.01;
    }
    return result.stopLoss;
  }

  calculateTarget(
    ctx: StrategyContext,
    entryPrice: number,
    stopLoss: number,
    direction: 'BUY' | 'SELL',
  ): { target: number; riskRewardRatio: number } {
    const result = this.strategy.runStrategy(ctx);
    if (result.action !== 'NO_TRADE') {
      return { target: result.target, riskRewardRatio: result.riskRewardRatio };
    }
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = risk * 2;
    const target = direction === 'BUY' ? entryPrice + reward : entryPrice - reward;
    return { target, riskRewardRatio: 2 };
  }

  reset(): void {
    this.strategy.reset();
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

import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import {
  IManagedStrategy,
  ManagedExitDecision,
  ManagedOpenPosition,
  ManagedStrategySignal,
} from '../models/strategy-module.interface';
import { DeskChannel } from '../models/desk-channel.model';
import {
  StrategySettings,
  defaultStrategySettings,
} from '../models/strategy-settings.model';
import {
  IndexRuleSpec,
  RuleDayState,
  createRuleDayState,
  indexRuleExitLogic,
  mergeSettings,
  recordRuleTradeClosed,
  runIndexRuleStrategy,
} from '../engines/index-rule.engine';
import { seriesAt } from '../indicators/desk-indicators';

/** Shared base for rule-based index strategies. */
export abstract class BaseIndexRuleStrategy implements IManagedStrategy {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly description: string;
  abstract readonly supports: readonly DeskChannel[];
  abstract readonly defaultSettings: StrategySettings;
  protected abstract readonly spec: IndexRuleSpec;

  protected settings: StrategySettings = defaultStrategySettings();
  protected state: RuleDayState = createRuleDayState();

  initialize(settings?: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.defaultSettings, settings);
    this.reset();
  }

  reset(): void {
    this.state = createRuleDayState();
  }

  analyze(ctx: StrategyContext): Record<string, unknown> {
    const signal = this.generateSignal(ctx);
    return { lastReason: signal.reason, ...signal.analysis };
  }

  generateSignal(ctx: StrategyContext): ManagedStrategySignal {
    return runIndexRuleStrategy(ctx, this.state, this.settings, this.spec);
  }

  calculateStopLoss(
    ctx: StrategyContext,
    entryPrice: number,
    direction: 'BUY' | 'SELL',
  ): number {
    const signal = this.generateSignal(ctx);
    if (signal.action === 'BUY' || signal.action === 'SELL') {
      return signal.stopLoss;
    }
    return direction === 'BUY'
      ? entryPrice - this.settings.stopLossPts
      : entryPrice + this.settings.stopLossPts;
  }

  calculateTarget(
    ctx: StrategyContext,
    entryPrice: number,
    stopLoss: number,
    direction: 'BUY' | 'SELL',
  ): { target: number; riskRewardRatio: number } {
    const signal = this.generateSignal(ctx);
    if (signal.action === 'BUY' || signal.action === 'SELL') {
      return { target: signal.target, riskRewardRatio: signal.riskRewardRatio };
    }
    const risk = Math.abs(entryPrice - stopLoss);
    const mult = this.settings.targetRMultiple > 0 ? this.settings.targetRMultiple : 10;
    return {
      target: direction === 'BUY' ? entryPrice + risk * mult : entryPrice - risk * mult,
      riskRewardRatio: mult,
    };
  }

  exitLogic(
    candle: Candle,
    open: ManagedOpenPosition,
    closes: number[],
    ctx: StrategyContext,
  ): ManagedExitDecision | null {
    return indexRuleExitLogic(
      candle,
      open,
      closes,
      this.settings,
      this.spec,
      seriesAt(ctx),
    );
  }

  onTradeClosed(points: number): void {
    recordRuleTradeClosed(
      this.state,
      points,
      this.settings.dayStopPts,
      this.settings.dayProfitLockPts ?? 0,
    );
  }

  getSettings(): StrategySettings {
    return { ...this.settings, extras: { ...this.settings.extras } };
  }

  updateSettings(partial: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.settings, partial);
  }
}

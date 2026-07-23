import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { seriesAt } from '../indicators/desk-indicators';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { DeskChannel } from '../models/desk-channel.model';
import {
  IManagedStrategy,
  ManagedExitDecision,
  ManagedOpenPosition,
  ManagedStrategySignal,
} from '../models/strategy-module.interface';
import {
  StrategySettings,
  defaultStrategySettings,
} from '../models/strategy-settings.model';
import { mergeSettings } from '../engines/index-rule.engine';
import {
  DEFAULT_SMART_PB_EXTRAS,
  SmartPbDayState,
  createSmartPbDayState,
  recordSmartPbTradeClosed,
  runSmartPullbackPro,
  smartPbExitLogic,
} from '../engines/smart-pullback-pro.engine';

/**
 * Smart Pullback PRO — Pine DNA port (EMA50 pullback family).
 *
 * Research (Yahoo 5m ~60d, 1 lot Nifty ₹65 + 1 lot Bank ₹30):
 *   pullback · 1.5R · 09:45–15:10 · 2t/day · gap30 · sideways skip
 *   → ~61% days ≥ ₹500 · ~63% green · avg ~₹1140 (not a guarantee).
 *
 * Selectable in Strategy Manager — does NOT replace Donch Retest defaults.
 */
@Injectable({ providedIn: 'root' })
export class SmartPullbackProManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.SMART_PULLBACK_PRO;
  readonly name = 'Smart PB PRO · EMA pullback · 1.5R';
  readonly version = '1.0.0';
  readonly description =
    'Pine Smart Pullback PRO port: EMA50 pullback entries · skip sideways · 1.5R · 2t/day · gap30. Index paper first — research sample is Yahoo 5m ~60d.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 45,
    emaLength: 50,
    maxTradesPerDay: 2,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 1.5,
    profitProtectEnabled: false,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
    extras: {
      ...DEFAULT_SMART_PB_EXTRAS,
      signalMode: 'pullback',
      minBarsBetweenSignals: 30,
      skipSideways: true,
      retestTolerancePts: 10,
      strongBodyMult: 0.6,
      emaFlatPts: 10,
      atrSidewaysMult: 0.7,
    },
  });

  private settings: StrategySettings = defaultStrategySettings();
  private state: SmartPbDayState = createSmartPbDayState();

  initialize(settings?: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.defaultSettings, settings);
    this.reset();
  }

  reset(): void {
    this.state = createSmartPbDayState();
  }

  analyze(ctx: StrategyContext): Record<string, unknown> {
    const signal = this.generateSignal(ctx);
    return { lastReason: signal.reason, ...signal.analysis };
  }

  generateSignal(ctx: StrategyContext): ManagedStrategySignal {
    return runSmartPullbackPro(ctx, this.state, this.settings);
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
    const mult = this.settings.targetRMultiple > 0 ? this.settings.targetRMultiple : 1.5;
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
    return smartPbExitLogic(candle, open, closes, this.settings, seriesAt(ctx));
  }

  onTradeClosed(points: number): void {
    recordSmartPbTradeClosed(this.state, points, this.settings.dayStopPts);
  }

  getSettings(): StrategySettings {
    return { ...this.settings, extras: { ...this.settings.extras } };
  }

  updateSettings(partial: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.settings, partial);
  }
}

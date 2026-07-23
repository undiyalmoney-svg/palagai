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
 * Smart Pullback PRO — Pine DNA port (breakout+strong family).
 *
 * Kite 5m OOS 2024+ (1 lot Nifty ₹65 + 1 lot Bank ₹30):
 *   breakout · 2R · 10:15–14:30 · 1t/day · gap30
 *   → ~49% days ≥ ₹500 · ~52% green · avg ~₹138 (not ₹500/day at 1 lot).
 *   ~3.5–4 lots ≈ ₹500 avg path. Yahoo pullback winner did not transfer.
 *
 * Selectable in Strategy Manager — does NOT replace Donch Retest defaults.
 */
@Injectable({ providedIn: 'root' })
export class SmartPullbackProManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.SMART_PULLBACK_PRO;
  readonly name = 'Smart PB PRO · breakout · 2R';
  readonly version = '1.1.0';
  readonly description =
    'Pine Smart Pullback PRO port (Kite-validated): EMA-filtered breakout+strong · 2R · 10:15–14:30 · 1t · gap30. Paper first — ~₹138/day avg @ 1+1 lot OOS.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '10:15',
    entryTimeEnd: '14:30',
    exitTime: '15:15',
    orEnd: '10:15',
    stopLossPts: 30,
    bankStopLossPts: 45,
    emaLength: 50,
    maxTradesPerDay: 1,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 2,
    profitProtectEnabled: false,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
    extras: {
      ...DEFAULT_SMART_PB_EXTRAS,
      signalMode: 'breakout',
      minBarsBetweenSignals: 30,
      skipSideways: false,
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

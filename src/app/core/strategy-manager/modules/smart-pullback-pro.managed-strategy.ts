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
  channelProfileExtras,
  createSmartPbDayState,
  recordSmartPbTradeClosed,
  runSmartPullbackPro,
  smartPbExitLogic,
} from '../engines/smart-pullback-pro.engine';

/**
 * Smart Pullback PRO — 1+1 lot ₹500 book + GENIE v3 day router (Kite OOS 2024+).
 *
 * Nifty primary: Pine breakout+strong+close-third · OR-mid · **3R** · 2t · gap15
 * Bank overlay: Donch armed-retest · OR-mid · **1.5R** · 1t · gap30
 * GENIE v3: Tue SKIP · Fri COMBO · Mon/Wed drive gates · Thu align → COMBO or ALONE
 * Bank bias-sync via extras.genieNiftyBias when set.
 *
 * OOS GENIE: ~₹507/day · ~34% red (vs ~49% always-combo) · cov ~71%.
 * Selectable — does NOT replace Donch Retest defaults.
 */
@Injectable({ providedIn: 'root' })
export class SmartPullbackProManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.SMART_PULLBACK_PRO;
  readonly name = 'Pullback';
  readonly version = '2.1.0';
  readonly description =
    'Smart pullback entries (Nifty 3R · Bank 1.5R). Prefer Genie for the day router.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '10:15',
    entryTimeEnd: '14:30',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 45,
    emaLength: 50,
    maxTradesPerDay: 0,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 3,
    profitProtectEnabled: false,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
    extras: {
      ...DEFAULT_SMART_PB_EXTRAS,
      profitLockArmRs: 600,
      profitLockLockRs: 300,
      profitLockGivebackRs: 300,
      slConfirmCutoffEnabled: true,
      slConfirmCutoffFracR: 0.55,
      slConfirmCutoffMaxMfeR: 0.75,
      slConfirmSoftRs: 700,
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
    const profile = channelProfileExtras(ctx.instrumentId);
    const effective = mergeSettings(this.settings, {
      targetRMultiple: profile.targetRMultiple,
      maxTradesPerDay: profile.maxTradesPerDay,
      extras: {
        ...this.settings.extras,
        ...profile.extras,
        minBarsBetweenSignals: profile.minBarsBetweenSignals,
        emaFlatPts: profile.emaFlatPts,
      },
    });
    return runSmartPullbackPro(ctx, this.state, effective);
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
    const bank = /bank/i.test(ctx.instrumentId ?? '');
    const cap = bank ? this.settings.bankStopLossPts : this.settings.stopLossPts;
    return direction === 'BUY' ? entryPrice - cap : entryPrice + cap;
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
    const profile = channelProfileExtras(ctx.instrumentId);
    const risk = Math.abs(entryPrice - stopLoss);
    const mult = profile.targetRMultiple;
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
    const profile = channelProfileExtras(ctx.instrumentId);
    const effective = mergeSettings(this.settings, {
      targetRMultiple: profile.targetRMultiple,
    });
    return smartPbExitLogic(candle, open, closes, effective, seriesAt(ctx), ctx.instrumentId ?? '');
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

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
 * Align Combo GENIE — the “both indices together or one alone” book.
 *
 * Screenshot playbook (Nifty+Bank both dumping → short PE / sell side):
 *   BOTH  = indices aligned same bias → trade combo in that direction
 *   ALONE = only one leg clear → trade the strong index only
 *   SKIP  = chop / Tue / weak OR-drive → sit out
 *
 * Legs (Kite OOS-proven DNA):
 *   Nifty: Pine breakout · OR-mid · 3R · SL beyond bar/swing
 *   Bank:  armed Donch retest · OR-mid · 1.5R · bias-sync to Nifty
 *
 * Selectable on Nifty, Bank, and Stocks — prior default; Donch Retest is now default for indices.
 */
@Injectable({ providedIn: 'root' })
export class AlignComboGenieManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE;
  readonly name = 'Genie';
  readonly version = '1.1.0';
  readonly description =
    'Steady book — unlimited trades · BOTH/ALONE/SKIP · skip Tue / weak drive.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank', 'stocks'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '10:15',
    entryTimeEnd: '14:30',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 45,
    emaLength: 50,
    /** Nifty cap; Bank profile overrides to 1 via channelProfileExtras. */
    maxTradesPerDay: 0,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 3,
    profitProtectEnabled: false,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
    extras: {
      ...DEFAULT_SMART_PB_EXTRAS,
      genieRouterEnabled: true,
      /** Same researched peak-trail + soft cutoff as Trap (doc 42). */
      profitLockArmRs: 400,
      profitLockLockRs: 200,
      profitLockGivebackRs: 200,
      slConfirmCutoffEnabled: true,
      slConfirmCutoffFracR: 0.45,
      slConfirmCutoffMaxMfeR: 0.6,
      slConfirmSoftRs: 500,
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
        genieRouterEnabled: true,
        minBarsBetweenSignals: profile.minBarsBetweenSignals,
        emaFlatPts: profile.emaFlatPts,
      },
    });
    const signal = runSmartPullbackPro(ctx, this.state, effective);
    if (signal.action === 'BUY' || signal.action === 'SELL') {
      return {
        ...signal,
        reason: `align-combo ${signal.reason}`,
        analysis: {
          ...signal.analysis,
          strategy: 'align-combo-genie',
          playbook: 'BOTH when aligned · ALONE when one clear · SKIP chop',
        },
      };
    }
    return {
      ...signal,
      analysis: {
        ...signal.analysis,
        strategy: 'align-combo-genie',
      },
    };
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

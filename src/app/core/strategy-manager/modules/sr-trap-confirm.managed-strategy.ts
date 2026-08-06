import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
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
  SrTrapDayState,
  createSrTrapDayState,
  recordSrTrapTradeClosed,
  runSrTrapConfirm,
  srTrapExitLogic,
} from '../engines/sr-trap-confirm.engine';

/**
 * S/R Trap + Confirm — default Nifty/Bank Paper+Live.
 * Monster 5-day-green DNA: pierce15 · Bank30 · bounce OR · peak₹150 · ≤2/day · 2R.
 */
@Injectable({ providedIn: 'root' })
export class SrTrapConfirmManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM;
  readonly name = 'Trap';
  readonly version = '1.1.0';
  readonly description =
    'Default · Trap confirm · pierce15 · Bank pierce30 · OR bounce · 2R · peak₹150 · ≤2/day · soft OFF.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '14:45',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 50,
    emaLength: 50,
    maxTradesPerDay: 2,
    instrumentType: 'futures',
    dayStopPts: 40,
    dayProfitLockPts: 0,
    targetRMultiple: 2,
    profitProtectEnabled: true,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
    extras: {
      trapMode: 'both',
      swingLb: 5,
      piercePts: 15,
      bankPiercePts: 30,
      minRiskPts: 4,
      maxRiskPts: 28,
      slPadPts: 2,
      minConfirmBody: 0,
      /**
       * Monster 5-day-green (doc 47): pierce15 · Bank30 · bounce OR
       * · peak₹150 · ≤2/day · soft OFF — max rolling-5 all-green rate.
       */
      profitLockArmRs: 150,
      profitLockLockRs: 75,
      profitLockGivebackRs: 75,
      slConfirmCutoffEnabled: false,
      slConfirmCutoffFracR: 0,
      slConfirmCutoffMaxMfeR: 0,
      slConfirmSoftRs: 0,
      bounceOrPierceMult: 0.25,
      bounceOrPierceCap: 40,
    },
  });

  private settings: StrategySettings = defaultStrategySettings();
  private state: SrTrapDayState = createSrTrapDayState();

  initialize(settings?: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.defaultSettings, settings);
    this.reset();
  }

  reset(): void {
    this.state = createSrTrapDayState();
  }

  analyze(ctx: StrategyContext): Record<string, unknown> {
    const signal = this.generateSignal(ctx);
    return { lastReason: signal.reason, ...signal.analysis };
  }

  generateSignal(ctx: StrategyContext): ManagedStrategySignal {
    const bank = /bank/i.test(ctx.instrumentId ?? '');
    const effective = mergeSettings(this.settings, {
      extras: {
        ...this.settings.extras,
        maxRiskPts: bank ? 50 : 28,
        minRiskPts: bank ? 8 : 4,
      },
    });
    return runSrTrapConfirm(ctx, this.state, effective);
  }

  calculateStopLoss(
    _ctx: StrategyContext,
    entryPrice: number,
    direction: 'BUY' | 'SELL',
  ): number {
    const bank = /bank/i.test(_ctx.instrumentId ?? '');
    const cap = bank ? this.settings.bankStopLossPts : this.settings.stopLossPts;
    return direction === 'BUY' ? entryPrice - cap : entryPrice + cap;
  }

  calculateTarget(
    _ctx: StrategyContext,
    entryPrice: number,
    stopLoss: number,
    direction: 'BUY' | 'SELL',
  ): { target: number; riskRewardRatio: number } {
    const risk = Math.abs(entryPrice - stopLoss);
    const mult = this.settings.targetRMultiple > 0 ? this.settings.targetRMultiple : 3.5;
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
    return srTrapExitLogic(candle, open, closes, this.settings, ctx);
  }

  onTradeClosed(points: number): void {
    recordSrTrapTradeClosed(
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

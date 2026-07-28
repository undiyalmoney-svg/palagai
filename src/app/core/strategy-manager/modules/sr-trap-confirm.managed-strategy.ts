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
 * S/R Trap + Confirm — research max-earn book (doc 31/33). Default Nifty/Bank Paper+Live.
 * Profit protect 1R→BE (doc 33 giveback fix). OOS ~₹1,049–1,464/day index proxy.
 */
@Injectable({ providedIn: 'root' })
export class SrTrapConfirmManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM;
  readonly name = 'Trap';
  readonly version = '1.0.0';
  readonly description =
    'Default · liquidity trap + next-bar confirm · 3.5R · peak-trail ₹500 giveback · ≤3 trades/day.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '14:45',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 50,
    emaLength: 50,
    maxTradesPerDay: 3,
    instrumentType: 'futures',
    dayStopPts: 80,
    dayProfitLockPts: 0,
    targetRMultiple: 3.5,
    profitProtectEnabled: true,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
    extras: {
      trapMode: 'both',
      swingLb: 5,
      piercePts: 3,
      minRiskPts: 4,
      maxRiskPts: 28,
      slPadPts: 2,
      minConfirmBody: 0,
      /**
       * After peak MFE ≥ ₹1000, trail from peak (allow ≤ ₹500 giveback).
       * Floor never below ₹500. Peak ₹1400 → lock ~₹900 — do not wait until ₹0.
       */
      profitLockArmRs: 1000,
      profitLockLockRs: 500,
      profitLockGivebackRs: 500,
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

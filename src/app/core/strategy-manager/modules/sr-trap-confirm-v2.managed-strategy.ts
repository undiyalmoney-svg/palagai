import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import { dnaCapsForStrategy, TRAP_V2_ENTRY_DNA_EXTRAS } from '../config/strategy-dna-caps';
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

const caps = dnaCapsForStrategy(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2, 'nifty');

/**
 * S/R Trap + Confirm v2 — default Nifty/Bank Paper+Live.
 * Same sweep+confirm entry mechanics as SrTrapConfirmManagedStrategy (the
 * audit found no fatal flaw in the signal logic itself), rebuilt with a
 * single-source DNA (TRAP_V2_ENTRY_DNA_EXTRAS, shared with the Order-API
 * live bundle via scripts/server-live/bundle-entry.ts) and a real ₹/lot
 * loss cap enforced at the broker-side protective SL order.
 */
@Injectable({ providedIn: 'root' })
export class SrTrapConfirmV2ManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2;
  readonly name = 'Trap V2';
  readonly version = '2.0.0';
  readonly description =
    'Default · Trap confirm v2 · pierce20 · Bank pierce40 · peak₹100 · max3 · 3.5R · hard ₹300/lot cap.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '14:45',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 50,
    emaLength: 50,
    maxTradesPerDay: caps.maxTradesPerDay,
    instrumentType: 'futures',
    dayStopPts: 60,
    dayProfitLockPts: 0,
    targetRMultiple: caps.targetRMultiple ?? 3.5,
    profitProtectEnabled: true,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
    extras: { ...TRAP_V2_ENTRY_DNA_EXTRAS },
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

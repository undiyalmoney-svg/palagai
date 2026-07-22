import { Injectable, inject } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import {
  isBankPdhlInstrument,
  rupeesPerPointForInstrument,
} from '../../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { LotsPreferenceService } from '../../services/lots-preference.service';
import { extractTradeDate } from '../../utils/trade-date.util';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import {
  IndexRuleSpec,
  RuleDayState,
  createRuleDayState,
  indexRuleExitLogic,
  mergeSettings,
  recordRuleTradeClosed,
  runIndexRuleStrategy,
} from '../engines/index-rule.engine';
import {
  RulerArm,
  pickRulerArm,
  computeRulerMorningFeatures,
  rulerDayCapInr,
} from '../engines/ruler-morning.util';
import { seriesAt } from '../indicators/desk-indicators';
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
import { RulerMonthStateService } from '../runtime/ruler-month-state.service';

const ARM_DNA: Record<
  Exclude<RulerArm, 'STAND'>,
  { spec: IndexRuleSpec; targetR: number; profitProtect: boolean }
> = {
  DONCH_TRAIL: {
    spec: { entry: 'donch_retest', bias: 'or_break', exit: 'swing_trail' },
    targetR: 0,
    profitProtect: false,
  },
  DONCH_2R: {
    spec: { entry: 'donch_retest', bias: 'or_mid', exit: 'eod' },
    targetR: 2,
    profitProtect: true,
  },
  DONCH_15R: {
    spec: { entry: 'donch_retest', bias: 'or_mid', exit: 'eod' },
    targetR: 1.5,
    profitProtect: true,
  },
  SWING_2R: {
    spec: { entry: 'swing_retest', bias: 'ema', exit: 'eod' },
    targetR: 2,
    profitProtect: true,
  },
};

/**
 * Boosted Ruler flow (research):
 * 1. While month MTD < ₹3,000 → beast witch
 * 2. Else → Donch trail on non-choppy mornings (STAND if choppy)
 * 3. Day loss cap ₹1,500 (dyn: min(cap, MTD) when month green)
 *
 * Lots come from the Trade Desk Lots field (LotsPreferenceService) — not hardcoded.
 * Opt-in only via Strategy Manager Ruler toggle (defaults stay Donch Retest).
 */
@Injectable({ providedIn: 'root' })
export class RulerManagedStrategy implements IManagedStrategy {
  private readonly lotsPreference = inject(LotsPreferenceService);
  private readonly monthState = inject(RulerMonthStateService);

  readonly id = MANAGED_STRATEGY_IDS.RULER;
  readonly name = 'Ruler flow';
  readonly version = '1.0.0';
  readonly description =
    'Boosted ruler: beast rampage until MTD ₹3k → Donch trail · ₹1,500 day cap (dyn when month green) · STAND on choppy. Lots from Trade Desk field.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:45',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '09:45',
    stopLossPts: 30,
    bankStopLossPts: 45,
    donchianLength: 20,
    emaLength: 50,
    swingLookback: 5,
    maxTradesPerDay: 3,
    instrumentType: 'futures',
    dayStopPts: 23,
    targetRMultiple: 0,
    profitProtectEnabled: false,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
  });

  private settings: StrategySettings = { ...this.defaultSettings };
  private state: RuleDayState = createRuleDayState();
  /** Arm used for the active open (exit mode). */
  private activeArm: Exclude<RulerArm, 'STAND'> | null = null;
  private lastEntryTime: string | null = null;
  private lastChannel: 'nifty' | 'bank' = 'nifty';
  private lastInstrumentId: string | null = null;

  initialize(settings?: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.defaultSettings, settings);
    this.reset();
  }

  reset(): void {
    this.state = createRuleDayState();
    this.activeArm = null;
    this.lastEntryTime = null;
  }

  analyze(ctx: StrategyContext): Record<string, unknown> {
    const signal = this.generateSignal(ctx);
    return { lastReason: signal.reason, ...signal.analysis };
  }

  generateSignal(ctx: StrategyContext): ManagedStrategySignal {
    const series = seriesAt(ctx);
    const day = extractTradeDate(ctx.candle5m.date);
    const isBank = isBankPdhlInstrument(ctx.instrumentId);
    this.lastChannel = isBank ? 'bank' : 'nifty';
    this.lastInstrumentId = ctx.instrumentId ?? null;

    const features = computeRulerMorningFeatures(series, day, isBank, this.settings.orEnd);
    const mtd = this.monthState.combinedMtdInr();
    const arm = pickRulerArm(features, mtd);

    if (arm === 'STAND') {
      return {
        action: 'SKIPPED',
        entryPrice: ctx.candle5m.close,
        stopLoss: ctx.candle5m.close,
        target: ctx.candle5m.close,
        riskRewardRatio: 0,
        reason: features?.choppy
          ? 'Ruler STAND · choppy morning'
          : `Ruler STAND · mtd ₹${mtd.toFixed(0)} · ${mtd < 3000 ? 'beast' : 'trail'}`,
        analysis: {
          ruler: true,
          arm,
          mtd,
          features,
          witch: mtd < 3000 ? 'beast' : 'trail',
        },
      };
    }

    const dna = ARM_DNA[arm];
    const lots = Math.max(1, this.lotsPreference.get());
    const rs = rupeesPerPointForInstrument(ctx.instrumentId);
    const dayCapInr = rulerDayCapInr(mtd);
    const dayStopPts = Math.max(1, Math.floor(dayCapInr / (rs * lots)));

    const runSettings = mergeSettings(this.settings, {
      targetRMultiple: dna.targetR,
      profitProtectEnabled: dna.profitProtect,
      profitProtectArmR: 1,
      profitProtectLockR: 0,
      dayStopPts,
      positionSizeLots: lots,
      emaLength: arm === 'SWING_2R' ? 50 : this.settings.emaLength,
    });

    const signal = runIndexRuleStrategy(ctx, this.state, runSettings, dna.spec);
    if (signal.action === 'BUY' || signal.action === 'SELL') {
      this.activeArm = arm;
      this.lastEntryTime = ctx.candle5m.date;
      return {
        ...signal,
        reason: `Ruler ${arm} · ${signal.reason}`,
        analysis: {
          ...signal.analysis,
          ruler: true,
          arm,
          mtd,
          dayCapInr,
          dayStopPts,
          lots,
          features,
          witch: mtd < 3000 ? 'beast' : 'trail',
        },
      };
    }
    return {
      ...signal,
      reason: `Ruler ${arm} · ${signal.reason}`,
      analysis: {
        ...signal.analysis,
        ruler: true,
        arm,
        mtd,
        dayCapInr,
        dayStopPts,
        lots,
        features,
        witch: mtd < 3000 ? 'beast' : 'trail',
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
    return {
      target: direction === 'BUY' ? entryPrice + risk * 2 : entryPrice - risk * 2,
      riskRewardRatio: 2,
    };
  }

  exitLogic(
    candle: Candle,
    open: ManagedOpenPosition,
    closes: number[],
    ctx: StrategyContext,
  ): ManagedExitDecision | null {
    const arm = this.activeArm ?? 'DONCH_TRAIL';
    const dna = ARM_DNA[arm];
    const lots = Math.max(1, this.lotsPreference.get());
    const rs = rupeesPerPointForInstrument(ctx.instrumentId ?? this.lastInstrumentId);
    const mtd = this.monthState.combinedMtdInr();
    const dayCapInr = rulerDayCapInr(mtd);
    const dayStopPts = Math.max(1, Math.floor(dayCapInr / (rs * lots)));
    const runSettings = mergeSettings(this.settings, {
      targetRMultiple: dna.targetR,
      profitProtectEnabled: dna.profitProtect,
      dayStopPts,
    });
    return indexRuleExitLogic(
      candle,
      open,
      closes,
      runSettings,
      dna.spec,
      seriesAt(ctx),
    );
  }

  onTradeClosed(points: number, tradingDate: string): void {
    const lots = Math.max(1, this.lotsPreference.get());
    const rs = rupeesPerPointForInstrument(this.lastInstrumentId);
    const inr = points * rs * lots;
    const mtdBefore = this.monthState.combinedMtdInr();
    const dayCapInr = rulerDayCapInr(mtdBefore);
    const dayStopPts = Math.max(1, Math.floor(dayCapInr / (rs * lots)));
    const entryTime = this.lastEntryTime ?? `${tradingDate}Tclosed`;
    this.monthState.recordTrade({
      channel: this.lastChannel,
      date: tradingDate,
      entryTime,
      inr,
    });
    recordRuleTradeClosed(this.state, points, dayStopPts);
    this.activeArm = null;
    this.lastEntryTime = null;
  }

  getSettings(): StrategySettings {
    return { ...this.settings, extras: { ...this.settings.extras } };
  }

  updateSettings(partial: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.settings, partial);
  }
}

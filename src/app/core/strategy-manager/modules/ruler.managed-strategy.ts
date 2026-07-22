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
import { RulerDayPlanService } from '../runtime/ruler-day-plan.service';
import { RulerMonthStateService } from '../runtime/ruler-month-state.service';

/**
 * Research ARM books (ruler-profit-boost.build):
 * - DONCH_2R / DONCH_15R / SWING_2R: RR exits, one_trade, NO break-even profit-protect
 * - DONCH_TRAIL: swing_trail, multi-trade, NO BE
 * Earlier Angular BE@1R flattened 03-11 winners to ₹0 (research +₹6,600).
 */
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
    profitProtect: false,
  },
  DONCH_15R: {
    spec: { entry: 'donch_retest', bias: 'or_mid', exit: 'eod' },
    targetR: 1.5,
    profitProtect: false,
  },
  SWING_2R: {
    spec: { entry: 'swing_retest', bias: 'ema', exit: 'eod' },
    targetR: 2,
    profitProtect: false,
  },
};

/**
 * Boosted Ruler flow (zero-red profit-boost):
 * 1. While 0 ≤ MTD < ₹3,000 → beast witch (entry gates)
 * 2. While MTD < 0 → hunter recover (never beast when month already red)
 * 3. Else → Donch trail on wide mornings (else 2R/swing)
 * 4. After 2 clipped red days anytime → edge witch for rest of month
 * 5. One shared arm per day for Nifty + Bank (research comb)
 * 6. Research score clips day ₹ to −₹500 (dyn when month green)
 *
 * Live vs Testing:
 * - Testing: both indices may take their 1 trade (research books); score is clipped in totals
 * - Live: block new entries after combined day ₹ hits cap; flatten open if breach
 *
 * Lots come from the Trade Desk Lots field (LotsPreferenceService).
 */
@Injectable({ providedIn: 'root' })
export class RulerManagedStrategy implements IManagedStrategy {
  private readonly lotsPreference = inject(LotsPreferenceService);
  private readonly monthState = inject(RulerMonthStateService);
  private readonly dayPlan = inject(RulerDayPlanService);

  readonly id = MANAGED_STRATEGY_IDS.RULER;
  readonly name = 'Ruler flow';
  readonly version = '1.9.0';
  readonly description =
    'Boosted ruler v1.9: zero-red profit-boost (hunter when red · wide trail · 2-loss anytime→edge · day-cap ₹500). Lots from Trade Desk.';
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
    /** Research: non-trail arms are 1t; DONCH_TRAIL overrides to unlimited in generateSignal. */
    maxTradesPerDay: 1,
    instrumentType: 'futures',
    dayStopPts: 60,
    targetRMultiple: 0,
    profitProtectEnabled: false,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
    regimeFilterEnabled: false,
    positionSizeLots: 1,
  });

  private settings: StrategySettings = { ...this.defaultSettings };
  private state: RuleDayState = createRuleDayState();
  private activeArm: Exclude<RulerArm, 'STAND'> | null = null;
  private lastEntryTime: string | null = null;
  private lastChannel: 'nifty' | 'bank' = 'nifty';
  private lastInstrumentId: string | null = null;
  private dayNetInr = 0;
  private dayNetDate: string | null = null;
  private dayCapHit = false;

  initialize(settings?: Partial<StrategySettings>): void {
    // Strip research locks from Strat/localStorage so older builds (maxTrades=3)
    // cannot revive multi-trade Ruler and recreate −₹12k uncapped months.
    const cleaned = settings ? { ...settings } : undefined;
    if (cleaned) {
      delete cleaned.maxTradesPerDay;
      delete cleaned.dayStopPts;
    }
    this.settings = mergeSettings(this.defaultSettings, cleaned);
    this.settings.maxTradesPerDay = 1;
    this.settings.dayStopPts = 60;
    this.reset();
  }

  reset(): void {
    this.state = createRuleDayState();
    this.activeArm = null;
    this.lastEntryTime = null;
    this.dayNetInr = 0;
    this.dayNetDate = null;
    this.dayCapHit = false;
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

    if (this.dayNetDate !== day) {
      this.dayNetDate = day;
      this.dayCapHit = false;
    }
    this.dayNetInr = this.monthState.dayInr(day);

    const features = computeRulerMorningFeatures(series, day, isBank, this.settings.orEnd);
    const mtd = this.monthState.combinedMtdInr(day);
    // Shared arm for both indices — lock only after morning features exist (OR ready).
    const { arm, locked, breakerActive, witch } = this.dayPlan.getOrLockArm(
      day,
      features,
      mtd,
    );
    const lots = Math.max(1, this.lotsPreference.get());
    const rs = rupeesPerPointForInstrument(ctx.instrumentId);
    const dayCapInr = rulerDayCapInr(mtd);
    const liveProtect = this.monthState.getScope() === 'live';

    // Live only: stop new entries after combined day ₹ hits cap.
    // Testing lets both indices take their research 1t; display/MTD use day-clip.
    if (liveProtect && (this.dayCapHit || this.dayNetInr <= -dayCapInr)) {
      this.dayCapHit = true;
      return {
        action: 'SKIPPED',
        entryPrice: ctx.candle5m.close,
        stopLoss: ctx.candle5m.close,
        target: ctx.candle5m.close,
        riskRewardRatio: 0,
        reason: `Ruler day cap ₹${dayCapInr.toFixed(0)} hit (day ₹${this.dayNetInr.toFixed(0)})`,
        analysis: {
          ruler: true,
          arm: 'STAND',
          mtd,
          dayCapInr,
          dayNetInr: this.dayNetInr,
          features,
          sharedArm: arm,
          armLocked: locked,
          witch: witch ?? (mtd < 0 ? 'hunter_uw' : mtd < 3000 ? 'beast' : 'trail_wide'),
          scope: this.monthState.getScope(),
        },
      };
    }

    if (!locked || arm === 'STAND') {
      return {
        action: 'SKIPPED',
        entryPrice: ctx.candle5m.close,
        stopLoss: ctx.candle5m.close,
        target: ctx.candle5m.close,
        riskRewardRatio: 0,
        reason: !locked
          ? 'Ruler waiting · morning OR/features not ready'
          : features?.choppy
            ? 'Ruler STAND · choppy morning'
            : `Ruler STAND · mtd ₹${mtd.toFixed(0)} · ${witch ?? (mtd < 0 ? 'hunter_uw' : mtd < 3000 ? 'beast' : 'trail_wide')}`,
        analysis: {
          ruler: true,
          arm,
          mtd,
          dayCapInr,
          dayNetInr: this.dayNetInr,
          features,
          sharedArm: arm,
          armLocked: locked,
          witch: witch ?? (mtd < 0 ? 'hunter_uw' : mtd < 3000 ? 'beast' : 'trail_wide'),
          scope: this.monthState.getScope(),
        },
      };
    }

    const dna = ARM_DNA[arm];
    // Research: DONCH_TRAIL books are one_trade=False; other arms are 1t.
    const maxTrades = arm === 'DONCH_TRAIL' ? 0 : 1;
    const runSettings = mergeSettings(this.settings, {
      targetRMultiple: dna.targetR,
      profitProtectEnabled: dna.profitProtect,
      profitProtectArmR: 1,
      profitProtectLockR: 0,
      dayStopPts: 60,
      maxTradesPerDay: maxTrades,
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
          dayNetInr: this.dayNetInr,
          lots,
          rs,
          features,
          sharedArm: arm,
          armLocked: locked,
          witch: witch ?? (mtd < 0 ? 'hunter_uw' : mtd < 3000 ? 'beast' : 'trail_wide'),
          scope: this.monthState.getScope(),
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
        dayNetInr: this.dayNetInr,
        lots,
        rs,
        features,
        sharedArm: arm,
        armLocked: locked,
        witch: witch ?? (mtd < 0 ? 'hunter_uw' : mtd < 3000 ? 'beast' : 'trail_wide'),
        scope: this.monthState.getScope(),
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
    // Live safety: flatten if combined day ₹ + this open's mark already breaches cap.
    if (this.monthState.getScope() === 'live') {
      const day = extractTradeDate(candle.date);
      const mtd = this.monthState.combinedMtdInr(day);
      const dayCapInr = rulerDayCapInr(mtd);
      const dayNet = this.monthState.dayInr(day);
      const lots = Math.max(1, this.lotsPreference.get());
      const rs = rupeesPerPointForInstrument(ctx.instrumentId ?? this.lastInstrumentId);
      const openPts =
        open.direction === 'BUY' ? candle.close - open.entry : open.entry - candle.close;
      const openInr = openPts * rs * lots;
      if (dayNet + openInr <= -dayCapInr) {
        this.dayCapHit = true;
        return {
          exitPrice: candle.close,
          reason: `Ruler day cap flatten ₹${dayCapInr.toFixed(0)}`,
        };
      }
    }

    const day = extractTradeDate(candle.date);
    const pick = this.dayPlan.getOrLockArm(
      day,
      computeRulerMorningFeatures(
        seriesAt(ctx),
        day,
        isBankPdhlInstrument(ctx.instrumentId),
        this.settings.orEnd,
      ),
      this.monthState.combinedMtdInr(day),
    );
    const arm = this.activeArm ?? (pick.locked && pick.arm !== 'STAND' ? pick.arm : null);
    const useArm: Exclude<RulerArm, 'STAND'> = arm ?? 'DONCH_TRAIL';
    const dna = ARM_DNA[useArm];
    const runSettings = mergeSettings(this.settings, {
      targetRMultiple: dna.targetR,
      profitProtectEnabled: dna.profitProtect,
      dayStopPts: 60,
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
    if (this.dayNetDate !== tradingDate) {
      this.dayNetDate = tradingDate;
      this.dayCapHit = false;
    }
    const entryTime = this.lastEntryTime ?? `${tradingDate}Tclosed`;
    this.monthState.recordTrade({
      channel: this.lastChannel,
      date: tradingDate,
      entryTime,
      inr,
    });
    this.dayNetInr = this.monthState.dayInr(tradingDate);
    const mtdBefore = this.monthState.combinedMtdInr(tradingDate);
    const dayCapInr = rulerDayCapInr(mtdBefore);
    if (this.monthState.getScope() === 'live' && this.dayNetInr <= -dayCapInr) {
      this.dayCapHit = true;
    }
    recordRuleTradeClosed(this.state, points, 60);
    this.activeArm = null;
    this.lastEntryTime = null;
  }

  getSettings(): StrategySettings {
    return { ...this.settings, extras: { ...this.settings.extras } };
  }

  updateSettings(partial: Partial<StrategySettings>): void {
    const cleaned = { ...partial };
    delete cleaned.maxTradesPerDay;
    delete cleaned.dayStopPts;
    this.settings = mergeSettings(this.settings, cleaned);
    this.settings.maxTradesPerDay = 1;
    this.settings.dayStopPts = 60;
  }
}

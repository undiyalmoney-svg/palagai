import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
import {
  createPdhlOrState,
  emaLast,
  mergePdhlOrParams,
  PDHL_EMA_EXIT_PERIOD,
  PdhlOrParams,
  PdhlOrState,
  recordPdhlTradeClosed,
  runPdhlOpeningRange,
} from '../../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
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

/**
 * Champion PDHL wrapper — does NOT modify evaluator DNA.
 * Delegates entry to runPdhlOpeningRange and exit to SL/TP/EMA-20/session.
 */
@Injectable({ providedIn: 'root' })
export class ChampionPdhlManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.CHAMPION_PDHL;
  readonly name = 'Champion PDHL (OR Swing Breakout)';
  readonly version = '1.0.0';
  readonly description =
    'Production champion: OR mid bias + swing breakout · SL caps · 1R · EMA-20 · day −60. DNA unchanged.';
  readonly supports: readonly DeskChannel[] = ['nifty', 'bank'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:20',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '10:15',
    stopLossPts: 30,
    minStopPts: 8,
    emaLength: 20,
    donchianLength: 0,
    swingLookback: 3,
    maxTradesPerDay: 0,
    instrumentType: 'options',
    dayStopPts: 60,
    targetRMultiple: 1,
  });

  private settings: StrategySettings = { ...this.defaultSettings, extras: {} };
  private state: PdhlOrState = createPdhlOrState();
  /** Desk risk overrides (strict day stop / profit lock) — additive only. */
  private pdhlOverrides: Partial<PdhlOrParams> | null = null;
  private lastInstrumentId: string | null = null;

  initialize(settings?: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.defaultSettings, settings);
    this.reset();
  }

  /** Called by desk when Trade Desk checkboxes change — does not alter DNA tables. */
  setPdhlDeskOverrides(overrides: Partial<PdhlOrParams> | null): void {
    this.pdhlOverrides = overrides;
  }

  reset(): void {
    this.state = createPdhlOrState();
  }

  analyze(ctx: StrategyContext): Record<string, unknown> {
    const signal = this.generateSignal(ctx);
    return { lastReason: signal.reason, ...signal.analysis };
  }

  generateSignal(ctx: StrategyContext): ManagedStrategySignal {
    this.lastInstrumentId = ctx.instrumentId ?? null;
    const params = mergePdhlOrParams(ctx.instrumentId, this.pdhlOverrides);
    const result = runPdhlOpeningRange(ctx, this.state, params);
    return {
      action: result.action,
      entryPrice: result.entryPrice,
      stopLoss: result.stopLoss,
      target: result.target,
      riskRewardRatio: result.riskRewardRatio,
      reason: result.reason,
      analysis: result.analysis,
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
      target: direction === 'BUY' ? entryPrice + risk : entryPrice - risk,
      riskRewardRatio: 1,
    };
  }

  exitLogic(
    candle: Candle,
    open: ManagedOpenPosition,
    closes: number[],
  ): ManagedExitDecision | null {
    const time = extractHhMm(candle.date);

    if (open.direction === 'BUY') {
      if (candle.low <= open.stop) {
        return { exitPrice: open.stop, reason: 'Stop loss hit' };
      }
      if (candle.high >= open.target) {
        return { exitPrice: open.target, reason: 'Target hit' };
      }
    } else {
      if (candle.high >= open.stop) {
        return { exitPrice: open.stop, reason: 'Stop loss hit' };
      }
      if (candle.low <= open.target) {
        return { exitPrice: open.target, reason: 'Target hit' };
      }
    }

    const ema20 = emaLast(closes, PDHL_EMA_EXIT_PERIOD);
    if (ema20 != null) {
      if (open.direction === 'BUY' && candle.close < ema20) {
        return { exitPrice: candle.close, reason: 'EMA-20 exit' };
      }
      if (open.direction === 'SELL' && candle.close > ema20) {
        return { exitPrice: candle.close, reason: 'EMA-20 exit' };
      }
    }

    // Mirror paper-desk checkIndexExit session close
    if (time >= '15:15') {
      return { exitPrice: candle.close, reason: 'Session close' };
    }
    return null;
  }

  onTradeClosed(points: number): void {
    const params = mergePdhlOrParams(this.lastInstrumentId, this.pdhlOverrides);
    recordPdhlTradeClosed(this.state, points, params);
  }

  getSettings(): StrategySettings {
    return { ...this.settings, extras: { ...this.settings.extras } };
  }

  updateSettings(partial: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.settings, partial);
  }
}

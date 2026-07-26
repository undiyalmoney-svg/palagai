import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
import { extractTradeDate } from '../../utils/trade-date.util';
import {
  GAP_FADE_500_GAP_PCT,
  GAP_FADE_500_STOP_PCT,
} from '../../strategy-engine/strategies/stocks-equity/stocks-equity.evaluator';
import { previousDayBars, seriesAt } from '../indicators/desk-indicators';
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
 * Stocks Desk champion DNA — gap-up fade ≥0.3%, stop 1.5%, EOD.
 * Strategy Manager default for the stocks channel (use Stocks Desk to trade).
 */
@Injectable({ providedIn: 'root' })
export class GapFade500ManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.GAP_FADE_500;
  readonly name = 'Gap Fade';
  readonly version = '1.0.0';
  readonly description =
    'Stocks default — fade gap-up ≥0.3% · stop 1.5% · ₹500 book.';
  readonly supports: readonly DeskChannel[] = ['stocks'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '09:15',
    entryTimeEnd: '09:30',
    exitTime: '15:15',
    orEnd: '09:15',
    stopLossPts: 0,
    maxTradesPerDay: 1,
    instrumentType: 'equity',
    dayStopPts: 0,
    targetRMultiple: 0,
    regimeFilterEnabled: false,
  });

  private settings: StrategySettings = defaultStrategySettings();

  initialize(settings?: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.defaultSettings, settings);
    this.reset();
  }

  reset(): void {
    /* stateless day signals */
  }

  analyze(ctx: StrategyContext): Record<string, unknown> {
    const signal = this.generateSignal(ctx);
    return { lastReason: signal.reason, ...signal.analysis };
  }

  generateSignal(ctx: StrategyContext): ManagedStrategySignal {
    const candle = ctx.candle5m;
    const day = extractTradeDate(candle.date);
    const time = extractHhMm(candle.date);
    const wait = (reason: string): ManagedStrategySignal => ({
      action: 'WAITING',
      entryPrice: candle.close,
      stopLoss: candle.close,
      target: candle.close,
      riskRewardRatio: 0,
      reason,
      analysis: { strategy: this.id },
    });
    const skip = (reason: string): ManagedStrategySignal => ({
      action: 'SKIPPED',
      entryPrice: candle.close,
      stopLoss: candle.close,
      target: candle.close,
      riskRewardRatio: 0,
      reason,
      analysis: { strategy: this.id },
    });

    if (time > this.settings.entryTimeEnd) {
      return skip(`After entry window ${this.settings.entryTimeEnd}`);
    }

    const series = seriesAt(ctx);
    const prev = previousDayBars(series, day);
    if (!prev.length) {
      return wait('Previous day not available');
    }
    const prevClose = prev[prev.length - 1]!.close;
    // Prefer open of first bar of day; fall back to current open
    const dayOpen = candle.open;
    const gap = (dayOpen - prevClose) / prevClose;
    if (gap < GAP_FADE_500_GAP_PCT) {
      return wait(`Gap ${(gap * 100).toFixed(2)}% < ${(GAP_FADE_500_GAP_PCT * 100).toFixed(1)}%`);
    }

    const entry = dayOpen;
    const stop = entry * (1 + GAP_FADE_500_STOP_PCT);
    return {
      action: 'SELL',
      entryPrice: entry,
      stopLoss: stop,
      target: entry, // EOD / no fixed TP
      riskRewardRatio: 0,
      reason: `GAP_FADE_500 SELL · gap ${(gap * 100).toFixed(2)}% · stop ${GAP_FADE_500_STOP_PCT * 100}%`,
      analysis: {
        strategy: this.id,
        gap,
        prevClose,
        dayOpen,
        stopPct: GAP_FADE_500_STOP_PCT,
      },
    };
  }

  calculateStopLoss(
    _ctx: StrategyContext,
    entryPrice: number,
    direction: 'BUY' | 'SELL',
  ): number {
    return direction === 'SELL'
      ? entryPrice * (1 + GAP_FADE_500_STOP_PCT)
      : entryPrice * (1 - GAP_FADE_500_STOP_PCT);
  }

  calculateTarget(
    _ctx: StrategyContext,
    entryPrice: number,
    _stopLoss: number,
    direction: 'BUY' | 'SELL',
  ): { target: number; riskRewardRatio: number } {
    // No fixed target — EOD
    return {
      target: direction === 'SELL' ? entryPrice * 0.99 : entryPrice * 1.01,
      riskRewardRatio: 0,
    };
  }

  exitLogic(
    candle: Candle,
    open: ManagedOpenPosition,
    _closes: number[],
    _ctx: StrategyContext,
  ): ManagedExitDecision | null {
    const time = extractHhMm(candle.date);
    if (open.direction === 'SELL' && candle.high >= open.stop) {
      return { exitPrice: open.stop, reason: 'Stop loss hit' };
    }
    if (open.direction === 'BUY' && candle.low <= open.stop) {
      return { exitPrice: open.stop, reason: 'Stop loss hit' };
    }
    if (time >= this.settings.exitTime) {
      return { exitPrice: candle.close, reason: 'EOD / session exit' };
    }
    return null;
  }

  getSettings(): StrategySettings {
    return { ...this.settings, extras: { ...this.settings.extras } };
  }

  updateSettings(partial: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.settings, partial);
  }
}

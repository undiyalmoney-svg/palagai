import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
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

/**
 * EXHAUSTION FADE v1 — stocks channel.
 *
 * Fades an intraday climax: a sharp run that exhausts on a volume blow-off and
 * stalls. "When buyers are done and the crowd exits, sell; when sellers are
 * done, buy." Research: scripts/p23..p38 + research/strategy/exhaustion-fade-v1.js.
 *
 * PAPER-FIRST. Selectable on the stocks channel; runs per-symbol like Gap Fade.
 * The Stocks Desk's position cap handles cross-sectional selection when several
 * names exhaust the same day.
 *
 * Measured (2018-2026, 55 mid-caps, honest 1x, 0.05%/side, real charges):
 *   pooled t = 2.89 · TEST out-of-sample positive · ~1 trade/week · worst day
 *   capped by the 2xATR stop. Found by search — PAPER-PROVE before live money.
 */
const RUN_BARS = 6;
const RUN_PCT = 2.5;       // % move over RUN_BARS to call a run
const VOL_MULT = 3.0;      // climax: bar volume >= VOL_MULT x 20-bar avg
const STALL_THIRD = 0.34;  // close in the far third against the run
const BLOWOFF_ATR = 2.3;   // climax bar range >= BLOWOFF_ATR x ATR(14)
const STOP_ATR = 2.0;      // hard stop distance

function atr14(series: Candle[], i: number): number {
  let tr = 0, n = 0;
  for (let j = Math.max(1, i - 13); j <= i; j++) {
    tr += Math.max(
      series[j]!.high - series[j]!.low,
      Math.abs(series[j]!.high - series[j - 1]!.close),
      Math.abs(series[j]!.low - series[j - 1]!.close),
    );
    n++;
  }
  return n ? tr / n : 0;
}
function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

/** Detect a fade signal on the LAST bar of the series. Returns direction or null. */
function detect(series: Candle[]): { dir: 'BUY' | 'SELL'; atr: number; run: number } | null {
  const i = series.length - 1;
  if (i < 25) return null;
  const run = (series[i]!.close - series[i - RUN_BARS]!.close) / series[i - RUN_BARS]!.close * 100;
  const avgVol = avg(series.slice(i - 20, i).map((c) => c.volume));
  if (avgVol <= 0) return null;
  const rng = series[i]!.high - series[i]!.low;
  if (rng <= 0) return null;
  const atr = atr14(series, i);
  if (atr <= 0 || rng / atr < BLOWOFF_ATR || series[i]!.volume / avgVol < VOL_MULT) return null;
  const closeLow = (series[i]!.close - series[i]!.low) / rng <= STALL_THIRD;
  const closeHigh = (series[i]!.high - series[i]!.close) / rng <= STALL_THIRD;
  if (run >= RUN_PCT && closeLow) return { dir: 'SELL', atr, run: Math.abs(run) };
  if (run <= -RUN_PCT && closeHigh) return { dir: 'BUY', atr, run: Math.abs(run) };
  return null;
}

@Injectable({ providedIn: 'root' })
export class ExhaustionFadeManagedStrategy implements IManagedStrategy {
  readonly id = MANAGED_STRATEGY_IDS.EXHAUSTION_FADE;
  readonly name = 'Exhaustion Fade';
  readonly version = '1.0.0';
  readonly description =
    'Stocks — fade a volume-climax blow-off (run≥2.5% · vol≥3× · blow-off≥2.3×ATR) · 2×ATR stop · EOD. Paper-first.';
  readonly supports: readonly DeskChannel[] = ['stocks'];

  readonly defaultSettings = defaultStrategySettings({
    entryTimeStart: '10:15',
    entryTimeEnd: '14:30',
    exitTime: '15:15',
    orEnd: '10:15',
    stopLossPts: 0,
    maxTradesPerDay: 0,
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
    /* stateless per-bar signals */
  }

  analyze(ctx: StrategyContext): Record<string, unknown> {
    const signal = this.generateSignal(ctx);
    return { lastReason: signal.reason, ...signal.analysis };
  }

  generateSignal(ctx: StrategyContext): ManagedStrategySignal {
    const candle = ctx.candle5m;
    const time = extractHhMm(candle.date);
    const wait = (reason: string): ManagedStrategySignal => ({
      action: 'WAITING', entryPrice: candle.close, stopLoss: candle.close,
      target: candle.close, riskRewardRatio: 0, reason, analysis: { strategy: this.id },
    });
    const skip = (reason: string): ManagedStrategySignal => ({
      action: 'SKIPPED', entryPrice: candle.close, stopLoss: candle.close,
      target: candle.close, riskRewardRatio: 0, reason, analysis: { strategy: this.id },
    });

    if (time < this.settings.entryTimeStart) return wait(`Before entry window ${this.settings.entryTimeStart}`);
    if (time > this.settings.entryTimeEnd) return skip(`After entry window ${this.settings.entryTimeEnd}`);

    const series = seriesAt(ctx);
    const sig = detect(series);
    if (!sig) return wait('No exhaustion climax');

    const entry = candle.close;
    const stop = sig.dir === 'SELL' ? entry + STOP_ATR * sig.atr : entry - STOP_ATR * sig.atr;
    return {
      action: sig.dir,
      entryPrice: entry,
      stopLoss: stop,
      target: entry, // EOD / no fixed TP — the fade holds to close
      riskRewardRatio: 0,
      reason: `EXHAUSTION_FADE ${sig.dir} · run ${sig.run.toFixed(1)}% · stop 2×ATR(${sig.atr.toFixed(2)})`,
      analysis: { strategy: this.id, run: sig.run, atr: sig.atr, stopAtr: STOP_ATR },
    };
  }

  calculateStopLoss(ctx: StrategyContext, entryPrice: number, direction: 'BUY' | 'SELL'): number {
    const atr = atr14(seriesAt(ctx), seriesAt(ctx).length - 1);
    return direction === 'SELL' ? entryPrice + STOP_ATR * atr : entryPrice - STOP_ATR * atr;
  }

  calculateTarget(
    _ctx: StrategyContext, entryPrice: number, _stopLoss: number, direction: 'BUY' | 'SELL',
  ): { target: number; riskRewardRatio: number } {
    return { target: direction === 'SELL' ? entryPrice * 0.99 : entryPrice * 1.01, riskRewardRatio: 0 };
  }

  exitLogic(
    candle: Candle, open: ManagedOpenPosition, _closes: number[], _ctx: StrategyContext,
  ): ManagedExitDecision | null {
    const time = extractHhMm(candle.date);
    if (open.direction === 'SELL' && candle.high >= open.stop) return { exitPrice: open.stop, reason: 'Stop loss hit' };
    if (open.direction === 'BUY' && candle.low <= open.stop) return { exitPrice: open.stop, reason: 'Stop loss hit' };
    if (time >= this.settings.exitTime) return { exitPrice: candle.close, reason: 'EOD / session exit' };
    return null;
  }

  getSettings(): StrategySettings {
    return { ...this.settings, extras: { ...this.settings.extras } };
  }

  updateSettings(partial: Partial<StrategySettings>): void {
    this.settings = mergeSettings(this.settings, partial);
  }
}

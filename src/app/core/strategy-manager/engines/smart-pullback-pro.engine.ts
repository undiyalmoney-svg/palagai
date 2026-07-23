import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
import { extractTradeDate } from '../../utils/trade-date.util';
import { atrAt, barsOnDay, emaLast, openingRange, seriesAt } from '../indicators/desk-indicators';
import {
  ManagedExitDecision,
  ManagedOpenPosition,
  ManagedStrategySignal,
} from '../models/strategy-module.interface';
import { StrategySettings } from '../models/strategy-settings.model';
import {
  applyIndexRuleProfitProtect,
  indexRuleExitLogic,
  IndexRuleSpec,
  RuleDayState,
  createRuleDayState,
  recordRuleTradeClosed,
} from './index-rule.engine';

/** Pine "Smart Pull back PRO" signal family. */
export type SmartPbSignalMode = 'breakout' | 'pullback' | 'both';

export interface SmartPbProExtras {
  /** Prior-bar retest tolerance in pts (Pine: 10). */
  retestTolerancePts: number;
  /** Min bars between same-side signals (Pine: 15). */
  minBarsBetweenSignals: number;
  /** SMA length for average body (Pine: 10). */
  avgBodyLen: number;
  /** Strong candle: body > mult × avgBody (Pine: 0.6). */
  strongBodyMult: number;
  /** ATR compression vs SMA(ATR,20) (Pine: 0.7). */
  atrSidewaysMult: number;
  /** |EMA − EMA[5]| flat threshold in pts (Pine: 10). */
  emaFlatPts: number;
  /** Skip entries when sideways warning fires. */
  skipSideways: boolean;
  /** Which Pine signal family to trade. */
  signalMode: SmartPbSignalMode;
}

/** Research defaults (Yahoo 5m ~60d): EMA pullback · gap30 · sideways skip. */
export const DEFAULT_SMART_PB_EXTRAS: SmartPbProExtras = {
  retestTolerancePts: 10,
  minBarsBetweenSignals: 30,
  avgBodyLen: 10,
  strongBodyMult: 0.6,
  atrSidewaysMult: 0.7,
  emaFlatPts: 10,
  skipSideways: true,
  signalMode: 'pullback',
};

export interface SmartPbDayState extends RuleDayState {
  lastBuyBar: number | null;
  lastSellBar: number | null;
  /** Global bar counter within the series evaluation (for min-gap). */
  barSeq: number;
}

export function createSmartPbDayState(): SmartPbDayState {
  return {
    ...createRuleDayState(),
    lastBuyBar: null,
    lastSellBar: null,
    barSeq: 0,
  };
}

function readExtras(settings: StrategySettings): SmartPbProExtras {
  const x = settings.extras ?? {};
  const mode = x['signalMode'];
  const signalMode: SmartPbSignalMode =
    mode === 'breakout' || mode === 'pullback' || mode === 'both'
      ? mode
      : DEFAULT_SMART_PB_EXTRAS.signalMode;
  return {
    retestTolerancePts: num(x['retestTolerancePts'], DEFAULT_SMART_PB_EXTRAS.retestTolerancePts),
    minBarsBetweenSignals: num(
      x['minBarsBetweenSignals'],
      DEFAULT_SMART_PB_EXTRAS.minBarsBetweenSignals,
    ),
    avgBodyLen: num(x['avgBodyLen'], DEFAULT_SMART_PB_EXTRAS.avgBodyLen),
    strongBodyMult: num(x['strongBodyMult'], DEFAULT_SMART_PB_EXTRAS.strongBodyMult),
    atrSidewaysMult: num(x['atrSidewaysMult'], DEFAULT_SMART_PB_EXTRAS.atrSidewaysMult),
    emaFlatPts: num(x['emaFlatPts'], DEFAULT_SMART_PB_EXTRAS.emaFlatPts),
    skipSideways:
      typeof x['skipSideways'] === 'boolean'
        ? x['skipSideways']
        : DEFAULT_SMART_PB_EXTRAS.skipSideways,
    signalMode,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sma(values: number[], len: number): number | null {
  if (values.length < len || len <= 0) {
    return null;
  }
  let sum = 0;
  for (let i = values.length - len; i < values.length; i += 1) {
    sum += values[i]!;
  }
  return sum / len;
}

/** Pine body strength: body > avgBody × mult (not % of range). */
function strongByAvgBody(
  candle: Candle,
  series: Candle[],
  avgBodyLen: number,
  strongBodyMult: number,
): { strongBull: boolean; strongBear: boolean; bodySize: number; avgBody: number | null } {
  const body = Math.abs(candle.close - candle.open);
  if (series.length < avgBodyLen + 1) {
    return { strongBull: false, strongBear: false, bodySize: body, avgBody: null };
  }
  const bodies: number[] = [];
  // Include current bar in SMA window (matches ta.sma(bodySize, 10) on the bar).
  for (let i = series.length - avgBodyLen; i < series.length; i += 1) {
    const c = series[i]!;
    bodies.push(Math.abs(c.close - c.open));
  }
  const avg = bodies.reduce((a, b) => a + b, 0) / avgBodyLen;
  const strong = body > avg * strongBodyMult;
  return {
    strongBull: candle.close > candle.open && strong,
    strongBear: candle.close < candle.open && strong,
    bodySize: body,
    avgBody: avg,
  };
}

/**
 * Pine sideways warning:
 *   atr < sma(atr, 20) * 0.7 AND abs(ema - ema[5]) < 10
 */
export function isSidewaysSmartPb(
  series: Candle[],
  emaLen: number,
  atrSidewaysMult: number,
  emaFlatPts: number,
): { sideways: boolean; atr: number | null; atrSma: number | null; emaDrift: number | null } {
  const atr = atrAt(series, 14);
  // Need ~14 TR bars + 20 ATR samples.
  if (atr == null || series.length < 35) {
    return { sideways: false, atr, atrSma: null, emaDrift: null };
  }

  // Build TR series once, then rolling ATR(14) SMA(20) — O(n).
  const trs: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const c = series[i]!;
    const p = series[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atrSeries: number[] = [];
  let window = 0;
  for (let i = 0; i < trs.length; i += 1) {
    window += trs[i]!;
    if (i >= 14) {
      window -= trs[i - 14]!;
    }
    if (i >= 13) {
      atrSeries.push(window / 14);
    }
  }
  const atrSma = sma(atrSeries, 20);
  const closes = series.map((c) => c.close);
  const emaNow = emaLast(closes, emaLen);
  const emaPrev = emaLast(closes.slice(0, -5), emaLen);
  if (atrSma == null || emaNow == null || emaPrev == null) {
    return { sideways: false, atr, atrSma, emaDrift: null };
  }
  const emaDrift = Math.abs(emaNow - emaPrev);
  const sideways = atr < atrSma * atrSidewaysMult && emaDrift < emaFlatPts;
  return { sideways, atr, atrSma, emaDrift };
}

/**
 * Port of TradingView "Smart Pull back PRO" entry DNA into desk signals.
 * Visual-only Pine pieces (zones/trendlines/labels) are omitted; entries map to BUY/SELL.
 */
export function runSmartPullbackPro(
  ctx: StrategyContext,
  state: SmartPbDayState,
  settings: StrategySettings,
): ManagedStrategySignal {
  const candle = ctx.candle5m;
  const day = extractTradeDate(candle.date);
  const time = extractHhMm(candle.date);
  const series = seriesAt(ctx);
  const extras = readExtras(settings);
  state.barSeq = series.length;

  if (state.tradingDate !== day) {
    state.tradingDate = day;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.dayStopped = false;
    // Keep lastBuyBar/lastSellBar across days — Pine var persists on the chart.
  }

  const wait = (reason: string, analysis: Record<string, unknown> = {}): ManagedStrategySignal => ({
    action: 'WAITING',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: 'smart-pullback-pro', ...analysis },
  });

  const skip = (reason: string, analysis: Record<string, unknown> = {}): ManagedStrategySignal => ({
    action: 'SKIPPED',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: 'smart-pullback-pro', ...analysis },
  });

  if (state.dayStopped) {
    return skip(`Day stopped (net ${state.dayNetPts.toFixed(1)})`);
  }
  if (settings.maxTradesPerDay > 0 && state.tradesToday >= settings.maxTradesPerDay) {
    return skip(
      `Max trades per day reached (${state.tradesToday}/${settings.maxTradesPerDay})`,
    );
  }
  if (time < settings.entryTimeStart) {
    return wait(`Before entry window ${settings.entryTimeStart}`);
  }
  if (time > settings.entryTimeEnd) {
    return skip(`After entry window ${settings.entryTimeEnd}`);
  }

  const dayBars = barsOnDay(series, day);
  const or = openingRange(dayBars, '09:15', settings.orEnd);
  if (!or) {
    return wait('Opening range not ready');
  }

  if (series.length < 2) {
    return wait('Need prior bar');
  }

  const closes = series.map((c) => c.close);
  const ema = emaLast(closes, settings.emaLength);
  if (ema == null) {
    return wait(`EMA-${settings.emaLength} warming up`);
  }

  const prev = series[series.length - 2]!;
  const { strongBull, strongBear, bodySize, avgBody } = strongByAvgBody(
    candle,
    series,
    extras.avgBodyLen,
    extras.strongBodyMult,
  );

  // Pine breakout + same-bar "retest" + strong body
  const bullBreakout = candle.close > prev.high && candle.close > ema;
  const bearBreakout = candle.close < prev.low && candle.close < ema;
  const bullRetest = candle.low <= prev.low + extras.retestTolerancePts;
  const bearRetest = candle.high >= prev.high - extras.retestTolerancePts;
  const breakoutBuy = bullBreakout && bullRetest && strongBull;
  const breakoutSell = bearBreakout && bearRetest && strongBear;

  // Pine EMA pullback
  const pullbackBuy = candle.close > ema && candle.close > candle.open && candle.low <= ema;
  const pullbackSell = candle.close < ema && candle.close < candle.open && candle.high >= ema;

  let buySignal = false;
  let sellSignal = false;
  let setup: string | null = null;
  if (extras.signalMode === 'breakout' || extras.signalMode === 'both') {
    if (breakoutBuy) {
      buySignal = true;
      setup = 'breakout';
    }
    if (breakoutSell) {
      sellSignal = true;
      setup = setup ?? 'breakout';
    }
  }
  if (extras.signalMode === 'pullback' || extras.signalMode === 'both') {
    // Prefer breakout label when both fire on the same bar.
    if (pullbackBuy && !buySignal) {
      buySignal = true;
      setup = 'pullback';
    }
    if (pullbackSell && !sellSignal) {
      sellSignal = true;
      setup = setup === 'breakout' ? 'breakout' : 'pullback';
    }
  }

  const side = isSidewaysSmartPb(
    series,
    settings.emaLength,
    extras.atrSidewaysMult,
    extras.emaFlatPts,
  );

  const analysisBase = {
    ema,
    setup,
    breakoutBuy,
    breakoutSell,
    pullbackBuy,
    pullbackSell,
    strongBull,
    strongBear,
    bodySize,
    avgBody,
    sideways: side.sideways,
    atr: side.atr,
    atrSma: side.atrSma,
    emaDrift: side.emaDrift,
    orHigh: or.high,
    orLow: or.low,
    dayNetPts: state.dayNetPts,
    tradesToday: state.tradesToday,
    extras,
  };

  if (!buySignal && !sellSignal) {
    return wait('No Smart PB setup', analysisBase);
  }

  if (extras.skipSideways && side.sideways) {
    return skip('Sideways market (ATR compressed + flat EMA)', analysisBase);
  }

  // If both sides fire (rare), prefer breakout direction aligned with EMA.
  let direction: 'BUY' | 'SELL' | null = null;
  if (buySignal && !sellSignal) {
    direction = 'BUY';
  } else if (sellSignal && !buySignal) {
    direction = 'SELL';
  } else if (buySignal && sellSignal) {
    direction = candle.close >= ema ? 'BUY' : 'SELL';
  }

  if (!direction) {
    return wait('No Smart PB setup', analysisBase);
  }

  const lastBar = direction === 'BUY' ? state.lastBuyBar : state.lastSellBar;
  // Idempotent on the same bar (desks may re-call generateSignal for SL/target).
  // Pine: bar_index - lastBuyBar > 15
  if (
    lastBar != null &&
    state.barSeq !== lastBar &&
    state.barSeq - lastBar <= extras.minBarsBetweenSignals
  ) {
    return skip(
      `Duplicate filter: ${direction} within ${extras.minBarsBetweenSignals} bars`,
      { ...analysisBase, lastSignalBar: lastBar, barSeq: state.barSeq },
    );
  }

  const close = candle.close;
  let stop = direction === 'BUY' ? candle.low : candle.high;
  // Pullback setups: stop beyond EMA by a small buffer.
  if (setup === 'pullback') {
    stop = direction === 'BUY' ? Math.min(stop, ema - 1) : Math.max(stop, ema + 1);
  }
  let risk = Math.abs(close - stop);
  if (risk < settings.minStopPts) {
    return skip(`Risk ${risk.toFixed(1)} < min ${settings.minStopPts}`, analysisBase);
  }
  const bankLike = /bank/i.test(ctx.instrumentId ?? '');
  const stopCap = bankLike ? settings.bankStopLossPts : settings.stopLossPts;
  if (risk > stopCap) {
    stop = direction === 'BUY' ? close - stopCap : close + stopCap;
    risk = stopCap;
  }
  if (settings.dayStopPts > 0 && state.dayNetPts - risk < -settings.dayStopPts) {
    return skip('Day stop would be breached by this risk', analysisBase);
  }

  let target = close;
  let rr = 0;
  if (settings.targetRMultiple > 0) {
    target =
      direction === 'BUY'
        ? close + risk * settings.targetRMultiple
        : close - risk * settings.targetRMultiple;
    rr = settings.targetRMultiple;
  } else {
    target = direction === 'BUY' ? close + risk * 10 : close - risk * 10;
    rr = 10;
  }

  if (direction === 'BUY') {
    state.lastBuyBar = state.barSeq;
  } else {
    state.lastSellBar = state.barSeq;
  }

  return {
    action: direction,
    entryPrice: close,
    stopLoss: stop,
    target,
    riskRewardRatio: rr,
    reason: `smart-pb ${setup} ${direction} · EMA${settings.emaLength} · risk ${risk.toFixed(1)}`,
    analysis: {
      ...analysisBase,
      direction,
      risk,
      stop,
      target,
    },
  };
}

/** Reuse index-rule exit path (targets / profit-protect / EOD). */
export function smartPbExitLogic(
  candle: Candle,
  open: ManagedOpenPosition,
  closes: number[],
  settings: StrategySettings,
  series?: Candle[],
): ManagedExitDecision | null {
  const spec: IndexRuleSpec = { entry: 'swing_retest', bias: 'ema', exit: 'eod' };
  applyIndexRuleProfitProtect(candle, open, settings);
  return indexRuleExitLogic(candle, open, closes, settings, spec, series);
}

export function recordSmartPbTradeClosed(
  state: SmartPbDayState,
  points: number,
  dayStopPts: number,
): void {
  recordRuleTradeClosed(state, points, dayStopPts);
}

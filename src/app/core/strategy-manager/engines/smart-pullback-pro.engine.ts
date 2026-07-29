import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
import { extractTradeDate } from '../../utils/trade-date.util';
import {
  atrAt,
  barsOnDay,
  donchian,
  emaLast,
  openingRange,
  previousDayBars,
  seriesAt,
} from '../indicators/desk-indicators';
import {
  ManagedExitDecision,
  ManagedOpenPosition,
  ManagedStrategySignal,
} from '../models/strategy-module.interface';
import { StrategySettings } from '../models/strategy-settings.model';
import {
  applyIndexRuleProfitProtect,
  applySlConfirmCutoff,
  armPeakTrailFloor,
  indexRuleExitLogic,
  IndexRuleSpec,
  RuleDayState,
  createRuleDayState,
  recordRuleTradeClosed,
} from './index-rule.engine';

/** Pine / pro-trader Smart PB signal family. */
export type SmartPbSignalMode = 'breakout' | 'pullback' | 'both' | 'armed_retest';

/** Day book mode: combo, one leg alone, or sit out. */
export type SmartPbRouteMode = 'BOTH' | 'NIFTY' | 'BANK' | 'SKIP';

export interface SmartPbGenieFeat {
  /** 0=Mon … 4=Fri */
  wd: number;
  nDrive: number;
  bDrive: number;
  nGap: number;
  bGap: number;
  aligned: boolean;
}

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
  /** Which signal family to trade. */
  signalMode: SmartPbSignalMode;
  /** Require close on OR-mid side (pro confluence). */
  requireOrMid: boolean;
  /** Require close in top/bottom third of bar (quality). */
  requireCloseThird: boolean;
  /** Donchian lookback for armed_retest. */
  donchianLength: number;
  /**
   * GENIE v3 day router (COMBO / ALONE / SKIP by weekday + morning drive).
   * Default on for the 1+1 ₹500 book.
   */
  genieRouterEnabled: boolean;
  /** Optional peer OR-drive (other index). Enables full combo-vs-alone. */
  geniePeerDrive: number | null;
  /** Optional peer gap pts (other index open − prior close). */
  geniePeerGap: number | null;
  /** Optional peer EMA bias at ~10:15. */
  geniePeerBias: 'BUY' | 'SELL' | 'FLAT' | null;
  /**
   * Nifty EMA50 bias at ~10:15 — Bank overlay only takes matching direction.
   * When null, Bank trades without bias sync.
   */
  genieNiftyBias: 'BUY' | 'SELL' | 'FLAT' | null;
}

/**
 * Kite pro-loop defaults for **Nifty primary** (doc 27):
 * Pine breakout+strong+close-third · OR-mid · 3R · gap15 · sideways · 2t.
 * Bank overlay uses armed_retest · 1.5R via channel profile.
 */
export const DEFAULT_SMART_PB_EXTRAS: SmartPbProExtras = {
  retestTolerancePts: 10,
  minBarsBetweenSignals: 15,
  avgBodyLen: 10,
  strongBodyMult: 0.6,
  atrSidewaysMult: 0.7,
  emaFlatPts: 10,
  skipSideways: true,
  signalMode: 'breakout',
  requireOrMid: true,
  requireCloseThird: true,
  donchianLength: 20,
  genieRouterEnabled: true,
  geniePeerDrive: null,
  geniePeerGap: null,
  geniePeerBias: null,
  genieNiftyBias: null,
};

/** Bank overlay DNA (1-lot book with Nifty primary). */
export const BANK_OVERLAY_SMART_PB_EXTRAS: SmartPbProExtras = {
  ...DEFAULT_SMART_PB_EXTRAS,
  signalMode: 'armed_retest',
  strongBodyMult: 0.8,
  retestTolerancePts: 12,
  minBarsBetweenSignals: 30,
  requireCloseThird: false,
  requireOrMid: true,
  skipSideways: true,
  donchianLength: 20,
};

/** Mon=0 … Sun=6 from YYYY-MM-DD (local calendar). */
export function weekdayMon0(date: string): number {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  const sun0 = parsed.getDay();
  return sun0 === 0 ? 6 : sun0 - 1;
}

export function orDrive(or: { firstOpen: number; lastClose: number; high: number; low: number }): number {
  const width = Math.max(or.high - or.low, 1e-9);
  return Math.abs(or.lastClose - or.firstOpen) / width;
}

function aloneByDrive(f: SmartPbGenieFeat): SmartPbRouteMode {
  return f.nDrive >= f.bDrive ? 'NIFTY' : 'BANK';
}

function drvSkip(f: SmartPbGenieFeat, minDrive: number): SmartPbRouteMode {
  if (Math.max(f.nDrive, f.bDrive) < minDrive) {
    return 'SKIP';
  }
  return f.aligned ? 'BOTH' : aloneByDrive(f);
}

/**
 * GENIE v3 — causal COMBO / ALONE / SKIP (Kite OOS 2024+):
 *   Tue → SKIP
 *   Fri → BOTH (combo)
 *   Mon → drive≥0.35 then BOTH if aligned else stronger alone
 *   Wed → drive≥0.25 then BOTH if aligned else stronger alone
 *   Thu → BOTH if aligned else stronger alone
 *
 * OOS: ~₹507/day · red ~34% (vs ~49% always-combo) · cov ~71% · all years green.
 */
export function resolveGenieV3Route(f: SmartPbGenieFeat): SmartPbRouteMode {
  if (f.wd < 0 || f.wd > 4) {
    return 'SKIP';
  }
  if (f.wd === 1) {
    return 'SKIP';
  }
  if (f.wd === 4) {
    return 'BOTH';
  }
  if (f.wd === 0) {
    return drvSkip(f, 0.35);
  }
  if (f.wd === 2) {
    return drvSkip(f, 0.25);
  }
  return f.aligned ? 'BOTH' : aloneByDrive(f);
}

/** Local-only fallback when peer OR features are not wired yet. */
export function resolveGenieV3LocalRoute(wd: number, localDrive: number): SmartPbRouteMode {
  if (wd < 0 || wd > 4) {
    return 'SKIP';
  }
  if (wd === 1) {
    return 'SKIP';
  }
  if (wd === 0 && localDrive < 0.35) {
    return 'SKIP';
  }
  if (wd === 2 && localDrive < 0.25) {
    return 'SKIP';
  }
  return 'BOTH';
}

export function instrumentAllowedByGenieRoute(
  route: SmartPbRouteMode,
  instrumentId: string | undefined,
): boolean {
  if (route === 'SKIP') {
    return false;
  }
  const bank = /bank/i.test(instrumentId ?? '');
  if (route === 'BOTH') {
    return true;
  }
  if (route === 'NIFTY') {
    return !bank;
  }
  if (route === 'BANK') {
    return bank;
  }
  return false;
}

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

/** Channel profiles for the 1+1 lot ₹500 book (Kite OOS). */
export function channelProfileExtras(instrumentId: string | undefined): {
  extras: Partial<SmartPbProExtras>;
  targetRMultiple: number;
  maxTradesPerDay: number;
  minBarsBetweenSignals: number;
  emaFlatPts: number;
} {
  const bank = /bank/i.test(instrumentId ?? '');
  if (bank) {
    return {
      extras: { ...BANK_OVERLAY_SMART_PB_EXTRAS },
      targetRMultiple: 1.5,
      maxTradesPerDay: 0,
      minBarsBetweenSignals: 30,
      emaFlatPts: 25,
    };
  }
  return {
    extras: { ...DEFAULT_SMART_PB_EXTRAS },
    targetRMultiple: 3,
    maxTradesPerDay: 0,
    minBarsBetweenSignals: 15,
    emaFlatPts: 10,
  };
}

function readExtras(settings: StrategySettings): SmartPbProExtras {
  const x = settings.extras ?? {};
  const mode = x['signalMode'];
  const signalMode: SmartPbSignalMode =
    mode === 'breakout' ||
    mode === 'pullback' ||
    mode === 'both' ||
    mode === 'armed_retest'
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
    requireOrMid:
      typeof x['requireOrMid'] === 'boolean'
        ? x['requireOrMid']
        : DEFAULT_SMART_PB_EXTRAS.requireOrMid,
    requireCloseThird:
      typeof x['requireCloseThird'] === 'boolean'
        ? x['requireCloseThird']
        : DEFAULT_SMART_PB_EXTRAS.requireCloseThird,
    donchianLength: num(x['donchianLength'], DEFAULT_SMART_PB_EXTRAS.donchianLength),
    genieRouterEnabled:
      typeof x['genieRouterEnabled'] === 'boolean'
        ? x['genieRouterEnabled']
        : DEFAULT_SMART_PB_EXTRAS.genieRouterEnabled,
    geniePeerDrive:
      typeof x['geniePeerDrive'] === 'number' && Number.isFinite(x['geniePeerDrive'])
        ? x['geniePeerDrive']
        : null,
    geniePeerGap:
      typeof x['geniePeerGap'] === 'number' && Number.isFinite(x['geniePeerGap'])
        ? x['geniePeerGap']
        : null,
    geniePeerBias:
      x['geniePeerBias'] === 'BUY' ||
      x['geniePeerBias'] === 'SELL' ||
      x['geniePeerBias'] === 'FLAT'
        ? x['geniePeerBias']
        : null,
    genieNiftyBias:
      x['genieNiftyBias'] === 'BUY' ||
      x['genieNiftyBias'] === 'SELL' ||
      x['genieNiftyBias'] === 'FLAT'
        ? x['genieNiftyBias']
        : null,
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
    state.brokeRes = false;
    state.brokeSup = false;
    state.brokeLevelRes = null;
    state.brokeLevelSup = null;
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

  const bankLike = /bank/i.test(ctx.instrumentId ?? '');
  const localDrive = orDrive(or);
  const prevBars = previousDayBars(series, day);
  const prevClose = prevBars.length ? prevBars[prevBars.length - 1]!.close : dayBars[0]!.open;
  const localGap = dayBars[0]!.open - prevClose;
  const wd = weekdayMon0(day);
  const peerReady =
    extras.geniePeerDrive != null && Number.isFinite(extras.geniePeerDrive);
  let genieRoute: SmartPbRouteMode = 'BOTH';
  if (extras.genieRouterEnabled) {
    if (peerReady) {
      const nDrive = bankLike ? extras.geniePeerDrive! : localDrive;
      const bDrive = bankLike ? localDrive : extras.geniePeerDrive!;
      const nGap = bankLike
        ? extras.geniePeerGap ?? 0
        : localGap;
      const bGap = bankLike ? localGap : extras.geniePeerGap ?? 0;
      const localBias: 'BUY' | 'SELL' =
        candle.close >= ema ? 'BUY' : 'SELL';
      const peerBias = extras.geniePeerBias;
      const niftyBias = bankLike
        ? extras.genieNiftyBias ?? peerBias
        : localBias;
      const bankBias = bankLike
        ? localBias
        : peerBias ?? localBias;
      const aligned =
        niftyBias != null &&
        bankBias != null &&
        niftyBias !== 'FLAT' &&
        niftyBias === bankBias;
      genieRoute = resolveGenieV3Route({
        wd,
        nDrive,
        bDrive,
        nGap,
        bGap,
        aligned,
      });
    } else {
      genieRoute = resolveGenieV3LocalRoute(wd, localDrive);
    }
    if (!instrumentAllowedByGenieRoute(genieRoute, ctx.instrumentId)) {
      return skip(`GENIE ${genieRoute}: sit out this leg`, {
        genieRoute,
        wd,
        localDrive,
        localGap,
        peerReady,
      });
    }
  }

  const prev = series[series.length - 2]!;
  const { strongBull, strongBear, bodySize, avgBody } = strongByAvgBody(
    candle,
    series,
    extras.avgBodyLen,
    extras.strongBodyMult,
  );
  const range = candle.high - candle.low;
  const closeThirdBull = range > 0 && (candle.close - candle.low) / range >= 0.66;
  const closeThirdBear = range > 0 && (candle.high - candle.close) / range >= 0.66;

  // Pine breakout + same-bar "retest" + strong body (+ optional close-third)
  const bullBreakout = candle.close > prev.high && candle.close > ema;
  const bearBreakout = candle.close < prev.low && candle.close < ema;
  const bullRetest = candle.low <= prev.low + extras.retestTolerancePts;
  const bearRetest = candle.high >= prev.high - extras.retestTolerancePts;
  const breakoutBuy =
    bullBreakout &&
    bullRetest &&
    strongBull &&
    (!extras.requireCloseThird || closeThirdBull);
  const breakoutSell =
    bearBreakout &&
    bearRetest &&
    strongBear &&
    (!extras.requireCloseThird || closeThirdBear);

  // Pine EMA pullback
  const pullbackBuy = candle.close > ema && candle.close > candle.open && candle.low <= ema;
  const pullbackSell = candle.close < ema && candle.close < candle.open && candle.high >= ema;

  // Armed Donchian break → later retest (Bank overlay DNA)
  const ch = donchian(series, extras.donchianLength, true);
  if (ch) {
    if (candle.close > ch.high) {
      state.brokeRes = true;
      state.brokeLevelRes = ch.high;
    }
    if (candle.close < ch.low) {
      state.brokeSup = true;
      state.brokeLevelSup = ch.low;
    }
  }
  const armedBuy =
    state.brokeRes &&
    state.brokeLevelRes != null &&
    candle.low <= state.brokeLevelRes &&
    candle.close >= state.brokeLevelRes &&
    candle.close > ema &&
    strongBull;
  const armedSell =
    state.brokeSup &&
    state.brokeLevelSup != null &&
    candle.high >= state.brokeLevelSup &&
    candle.close <= state.brokeLevelSup &&
    candle.close < ema &&
    strongBear;

  let buySignal = false;
  let sellSignal = false;
  let setup: string | null = null;
  let level: number | null = null;
  if (extras.signalMode === 'breakout' || extras.signalMode === 'both') {
    if (breakoutBuy) {
      buySignal = true;
      setup = 'breakout';
      level = prev.high;
    }
    if (breakoutSell) {
      sellSignal = true;
      setup = setup ?? 'breakout';
      level = prev.low;
    }
  }
  if (extras.signalMode === 'pullback' || extras.signalMode === 'both') {
    if (pullbackBuy && !buySignal) {
      buySignal = true;
      setup = 'pullback';
      level = ema;
    }
    if (pullbackSell && !sellSignal) {
      sellSignal = true;
      setup = setup === 'breakout' ? 'breakout' : 'pullback';
      level = ema;
    }
  }
  if (extras.signalMode === 'armed_retest') {
    if (armedBuy) {
      buySignal = true;
      setup = 'armed_retest';
      level = state.brokeLevelRes;
    } else if (armedSell) {
      sellSignal = true;
      setup = 'armed_retest';
      level = state.brokeLevelSup;
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
    armedBuy,
    armedSell,
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
    orMid: or.mid,
    dayNetPts: state.dayNetPts,
    tradesToday: state.tradesToday,
    genieRoute,
    wd,
    localDrive,
    localGap,
    extras,
  };

  if (!buySignal && !sellSignal) {
    return wait('No Smart PB setup', analysisBase);
  }

  if (extras.skipSideways && side.sideways) {
    return skip('Sideways market (ATR compressed + flat EMA)', analysisBase);
  }

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

  // Bank bias-sync: only when Nifty bias is provided and matches.
  if (
    bankLike &&
    extras.genieNiftyBias != null &&
    extras.genieNiftyBias !== 'FLAT' &&
    direction !== extras.genieNiftyBias
  ) {
    return skip(
      `Bank bias-sync: signal ${direction} ≠ Nifty bias ${extras.genieNiftyBias}`,
      { ...analysisBase, genieRoute, genieNiftyBias: extras.genieNiftyBias },
    );
  }

  if (extras.requireOrMid) {
    if (direction === 'BUY' && candle.close < or.mid) {
      return skip('OR-mid confluence failed (BUY below mid)', analysisBase);
    }
    if (direction === 'SELL' && candle.close > or.mid) {
      return skip('OR-mid confluence failed (SELL above mid)', analysisBase);
    }
  }

  const lastBar = direction === 'BUY' ? state.lastBuyBar : state.lastSellBar;
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
  if (setup === 'pullback' || setup === 'armed_retest') {
    stop = direction === 'BUY' ? Math.min(stop, ema - 1) : Math.max(stop, ema + 1);
  }
  if (level != null && Number.isFinite(level)) {
    stop =
      direction === 'BUY' ? Math.min(stop, level - 1) : Math.max(stop, level + 1);
  }
  let risk = Math.abs(close - stop);
  if (risk < settings.minStopPts) {
    return skip(`Risk ${risk.toFixed(1)} < min ${settings.minStopPts}`, analysisBase);
  }
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
    if (setup === 'armed_retest') {
      state.brokeRes = false;
      state.brokeLevelRes = null;
    }
  } else {
    state.lastSellBar = state.barSeq;
    if (setup === 'armed_retest') {
      state.brokeSup = false;
      state.brokeLevelSup = null;
    }
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
      level,
    },
  };
}

/** Reuse index-rule exit path (peak-trail / SL confirm / targets / EOD). */
export function smartPbExitLogic(
  candle: Candle,
  open: ManagedOpenPosition,
  closes: number[],
  settings: StrategySettings,
  series?: Candle[],
  instrumentId = '',
): ManagedExitDecision | null {
  const spec: IndexRuleSpec = { entry: 'swing_retest', bias: 'ema', exit: 'eod' };
  applyIndexRuleProfitProtect(candle, open, settings);
  // Same researched peak-trail + soft cutoff as Trap (Paper+Live shared).
  const armed = armPeakTrailFloor(candle, open, settings, instrumentId);
  const cutoff = applySlConfirmCutoff(candle, open, settings, instrumentId);
  if (cutoff) {
    return cutoff;
  }
  const exit = indexRuleExitLogic(candle, open, closes, settings, spec, series);
  if (exit) {
    if (armed && exit.reason === 'Stop loss hit') {
      return { ...exit, reason: 'Profit drained — cut & rehunt' };
    }
    return exit;
  }
  if (!armed) {
    return null;
  }
  const closePts =
    open.direction === 'BUY' ? candle.close - open.entry : open.entry - candle.close;
  const stopPts = Math.abs(open.stop - open.entry);
  if (closePts <= stopPts) {
    return {
      exitPrice: open.stop,
      reason: 'Profit drained — cut & rehunt',
    };
  }
  return null;
}

export function recordSmartPbTradeClosed(
  state: SmartPbDayState,
  points: number,
  dayStopPts: number,
): void {
  recordRuleTradeClosed(state, points, dayStopPts);
}

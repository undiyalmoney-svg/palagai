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
  researchSwingAt,
  seriesAt,
  swingLevels,
  toMin,
} from '../indicators/desk-indicators';
import {
  computeMorningRegimeFeatures,
  passesMorningRegimeFilter,
} from './morning-regime.util';
import {
  ManagedExitDecision,
  ManagedOpenPosition,
  ManagedStrategySignal,
} from '../models/strategy-module.interface';
import {
  StrategySettings,
  defaultStrategySettings,
} from '../models/strategy-settings.model';

export type RuleEntryMode =
  | 'vol_expand'
  | 'donch'
  | 'swing'
  | 'inside_break'
  | 'donch_retest'
  | 'swing_retest';
export type RuleBiasMode = 'ema' | 'prev_day' | 'none' | 'or_mid' | 'or_break';
export type RuleExitMode = 'eod' | 'ema' | 'swing_trail';

export interface IndexRuleSpec {
  entry: RuleEntryMode;
  bias: RuleBiasMode;
  exit: RuleExitMode;
}

export interface RuleDayState {
  tradingDate: string | null;
  dayNetPts: number;
  tradesToday: number;
  dayStopped: boolean;
  /** Most recent inside-bar high/low for inside_break entries. */
  insideHigh: number | null;
  insideLow: number | null;
  /** Break-then-retest state (Donchian / swing / PDHL-style). */
  brokeRes: boolean;
  brokeSup: boolean;
  brokeLevelRes: number | null;
  brokeLevelSup: number | null;
}

export function createRuleDayState(): RuleDayState {
  return {
    tradingDate: null,
    dayNetPts: 0,
    tradesToday: 0,
    dayStopped: false,
    insideHigh: null,
    insideLow: null,
    brokeRes: false,
    brokeSup: false,
    brokeLevelRes: null,
    brokeLevelSup: null,
  };
}

/**
 * Shared index/5m rule engine used by VolExpand, Swing5, Donchian-20/55 modules.
 * Desks call this only through IManagedStrategy wrappers.
 */
export function runIndexRuleStrategy(
  ctx: StrategyContext,
  state: RuleDayState,
  settings: StrategySettings,
  spec: IndexRuleSpec,
): ManagedStrategySignal {
  const candle = ctx.candle5m;
  const day = extractTradeDate(candle.date);
  const time = extractHhMm(candle.date);
  const series = seriesAt(ctx);

  if (state.tradingDate !== day) {
    state.tradingDate = day;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.dayStopped = false;
    state.insideHigh = null;
    state.insideLow = null;
    state.brokeRes = false;
    state.brokeSup = false;
    state.brokeLevelRes = null;
    state.brokeLevelSup = null;
  }

  const wait = (reason: string, analysis: Record<string, unknown> = {}): ManagedStrategySignal => ({
    action: 'WAITING',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategySpec: spec, ...analysis },
  });

  const skip = (reason: string, analysis: Record<string, unknown> = {}): ManagedStrategySignal => ({
    action: 'SKIPPED',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategySpec: spec, ...analysis },
  });

  if (state.dayStopped) {
    return skip(`Day stopped (net ${state.dayNetPts.toFixed(1)})`);
  }
  if (settings.maxTradesPerDay > 0 && state.tradesToday >= settings.maxTradesPerDay) {
    return skip(
      `Max trades per day reached (${state.tradesToday}/${settings.maxTradesPerDay})`,
    );
  }

  const earliest = settings.entryTimeStart;
  const latest = settings.entryTimeEnd;
  if (time < earliest) {
    return wait(`Before entry window ${earliest}`);
  }
  if (time > latest) {
    return skip(`After entry window ${latest}`);
  }

  const dayBars = barsOnDay(series, day);
  const or = openingRange(dayBars, '09:15', settings.orEnd);
  if (!or) {
    return wait('Opening range not ready');
  }

  if (settings.regimeFilterEnabled) {
    const features = computeMorningRegimeFeatures(series, day, settings.orEnd);
    if (!features) {
      return wait('Regime filter: morning features not ready');
    }
    if (
      !passesMorningRegimeFilter(
        features,
        settings.regimeMinOrDriveFrac,
        settings.regimeMaxGapAtr,
      )
    ) {
      return skip(
        `Regime stand-down · drive ${features.orDriveFrac.toFixed(2)} / gapATR ${features.gapAtr.toFixed(2)}`,
        {
          regime: features,
          minDrive: settings.regimeMinOrDriveFrac,
          maxGapAtr: settings.regimeMaxGapAtr,
        },
      );
    }
  }

  // Bias
  let bias: 'BUY' | 'SELL' | 'FLAT' = 'FLAT';
  if (spec.bias === 'ema') {
    const closes = series.map((c) => c.close);
    const ema = emaLast(closes, settings.emaLength);
    if (ema == null) {
      return wait(`EMA-${settings.emaLength} warming up`);
    }
    bias = candle.close > ema ? 'BUY' : 'SELL';
  } else if (spec.bias === 'prev_day') {
    const prev = previousDayBars(series, day);
    if (!prev.length) {
      return wait('Previous day not available');
    }
    const prevOpen = prev[0]!.open;
    const prevClose = prev[prev.length - 1]!.close;
    bias = prevClose >= prevOpen ? 'BUY' : 'SELL';
  } else if (spec.bias === 'or_mid') {
    bias = candle.close >= or.mid ? 'BUY' : 'SELL';
  } else if (spec.bias === 'or_break') {
    // Do not early-return while inside OR — retest break state must still update.
    if (candle.close > or.high) {
      bias = 'BUY';
    } else if (candle.close < or.low) {
      bias = 'SELL';
    } else {
      bias = 'FLAT';
    }
  }

  const close = candle.close;
  let direction: 'BUY' | 'SELL' | null = null;
  let levelHigh = NaN;
  let levelLow = NaN;

  if (spec.entry === 'donch' || spec.entry === 'vol_expand') {
    const ch = donchian(series, settings.donchianLength, true);
    if (!ch) {
      return wait(`Donchian-${settings.donchianLength} warming up`);
    }
    levelHigh = ch.high;
    levelLow = ch.low;
    if (spec.entry === 'vol_expand') {
      const atr = atrAt(series, 14);
      if (atr == null || candle.high - candle.low < settings.volExpandAtrMult * atr) {
        return wait('Vol expand filter: range < ATR threshold');
      }
    }
    if (close > levelHigh) {
      direction = 'BUY';
    } else if (close < levelLow) {
      direction = 'SELL';
    }
  } else if (spec.entry === 'swing') {
    const sw = swingLevels(series, settings.swingLookback);
    if (!sw) {
      return wait(`Swing-${settings.swingLookback} not confirmed`);
    }
    levelHigh = sw.high;
    levelLow = sw.low;
    if (close > levelHigh) {
      direction = 'BUY';
    } else if (close < levelLow) {
      direction = 'SELL';
    }
  } else if (spec.entry === 'inside_break') {
    // Detect prior inside bar (bar[i-1] inside bar[i-2]); break of its range.
    if (dayBars.length >= 3) {
      const mother = dayBars[dayBars.length - 3]!;
      const inside = dayBars[dayBars.length - 2]!;
      if (inside.high < mother.high && inside.low > mother.low) {
        state.insideHigh = inside.high;
        state.insideLow = inside.low;
      }
    }
    if (state.insideHigh == null || state.insideLow == null) {
      return wait('No inside bar yet');
    }
    levelHigh = state.insideHigh;
    levelLow = state.insideLow;
    if (close > levelHigh) {
      direction = 'BUY';
      state.insideHigh = null;
      state.insideLow = null;
    } else if (close < levelLow) {
      direction = 'SELL';
      state.insideHigh = null;
      state.insideLow = null;
    }
  } else if (spec.entry === 'donch_retest' || spec.entry === 'swing_retest') {
    if (spec.entry === 'donch_retest') {
      const ch = donchian(series, settings.donchianLength, true);
      if (!ch) {
        return wait(`Donchian-${settings.donchianLength} warming up`);
      }
      levelHigh = ch.high;
      levelLow = ch.low;
    } else {
      const sw = swingLevels(series, settings.swingLookback);
      if (!sw) {
        return wait(`Swing-${settings.swingLookback} not confirmed`);
      }
      levelHigh = sw.high;
      levelLow = sw.low;
    }
    if (close > levelHigh) {
      state.brokeRes = true;
      state.brokeLevelRes = levelHigh;
    }
    if (close < levelLow) {
      state.brokeSup = true;
      state.brokeLevelSup = levelLow;
    }
    if (
      state.brokeRes &&
      state.brokeLevelRes != null &&
      candle.low <= state.brokeLevelRes &&
      close >= state.brokeLevelRes
    ) {
      direction = 'BUY';
      levelHigh = state.brokeLevelRes;
      levelLow = state.brokeLevelRes;
      state.brokeRes = false;
      state.brokeLevelRes = null;
    } else if (
      state.brokeSup &&
      state.brokeLevelSup != null &&
      candle.high >= state.brokeLevelSup &&
      close <= state.brokeLevelSup
    ) {
      direction = 'SELL';
      levelHigh = state.brokeLevelSup;
      levelLow = state.brokeLevelSup;
      state.brokeSup = false;
      state.brokeLevelSup = null;
    }
  }

  if (!direction) {
    return wait(
      spec.entry.includes('retest') ? 'Waiting for S/R retest' : 'No breakout',
      { levelHigh, levelLow, bias, brokeRes: state.brokeRes, brokeSup: state.brokeSup },
    );
  }
  if (spec.bias === 'or_break' && bias === 'FLAT') {
    return wait('Waiting for OR break bias', {
      levelHigh,
      levelLow,
      orHigh: or.high,
      orLow: or.low,
      brokeRes: state.brokeRes,
      brokeSup: state.brokeSup,
    });
  }
  if (bias === 'BUY' || bias === 'SELL') {
    if (direction !== bias) {
      return skip(`Signal ${direction} against bias ${bias}`, { levelHigh, levelLow, bias });
    }
  }

  // Research retest stop: beyond S/R by 1pt, then min-risk / max-stop caps.
  let stop =
    direction === 'BUY' ? Math.min(candle.low, levelLow) : Math.max(candle.high, levelHigh);
  if (spec.entry === 'donch_retest' || spec.entry === 'swing_retest') {
    if (direction === 'BUY') {
      stop = Math.min(stop, levelLow - 1);
    } else {
      stop = Math.max(stop, levelHigh + 1);
    }
  }
  let risk = Math.abs(close - stop);
  if (risk < settings.minStopPts) {
    return skip(`Risk ${risk.toFixed(1)} < min ${settings.minStopPts}`);
  }
  const bankLike = /bank/i.test(ctx.instrumentId ?? '');
  const stopCap = bankLike ? settings.bankStopLossPts : settings.stopLossPts;
  if (risk > stopCap) {
    stop = direction === 'BUY' ? close - stopCap : close + stopCap;
    risk = stopCap;
  }
  if (settings.dayStopPts > 0 && state.dayNetPts - risk < -settings.dayStopPts) {
    return skip('Day stop would be breached by this risk');
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
    // EOD strategies: no fixed target (desk exitLogic handles EOD)
    target = direction === 'BUY' ? close + risk * 10 : close - risk * 10;
    rr = 10;
  }

  return {
    action: direction,
    entryPrice: close,
    stopLoss: stop,
    target,
    riskRewardRatio: rr,
    reason: `${spec.entry} ${direction} · bias ${bias} · risk ${risk.toFixed(1)}`,
    analysis: {
      strategySpec: spec,
      bias,
      levelHigh,
      levelLow,
      orHigh: or.high,
      orLow: or.low,
      dayNetPts: state.dayNetPts,
      tradesToday: state.tradesToday,
      settings: {
        donchianLength: settings.donchianLength,
        emaLength: settings.emaLength,
        swingLookback: settings.swingLookback,
        entryWindow: `${earliest}-${latest}`,
      },
    },
  };
}

/** Initial risk from entry/target (stable after stop is moved by profit-protect). */
export function indexRuleInitialRisk(
  open: ManagedOpenPosition,
  settings: StrategySettings,
): number {
  if (settings.targetRMultiple > 0) {
    const fromTarget = Math.abs(open.target - open.entry) / settings.targetRMultiple;
    if (fromTarget > 0) {
      return fromTarget;
    }
  }
  return Math.abs(open.entry - open.stop);
}

/**
 * If MFE ≥ armR × risk, ratchet stop to entry + lockR × risk (never loosen).
 * Mutates `open.stop` so paper/live desks can sync the tightened stop.
 */
export function applyIndexRuleProfitProtect(
  candle: Candle,
  open: ManagedOpenPosition,
  settings: StrategySettings,
): void {
  if (!settings.profitProtectEnabled || settings.profitProtectArmR <= 0) {
    return;
  }
  const risk = indexRuleInitialRisk(open, settings);
  if (!(risk > 0)) {
    return;
  }
  const armPts = settings.profitProtectArmR * risk;
  const lockPts = settings.profitProtectLockR * risk;
  if (open.direction === 'BUY') {
    const mfe = candle.high - open.entry;
    if (mfe >= armPts) {
      const lockStop = open.entry + lockPts;
      if (lockStop > open.stop) {
        open.stop = lockStop;
      }
    }
  } else {
    const mfe = open.entry - candle.low;
    if (mfe >= armPts) {
      const lockStop = open.entry - lockPts;
      if (lockStop < open.stop) {
        open.stop = lockStop;
      }
    }
  }
}

/**
 * Research (reports/sl-confirm-cutoff): strict near-SL cuts lose money.
 * Valid rule — loser-only confirmed cutoff:
 *  - trade never went meaningfully green (MFE < maxMfeR × risk)
 *  - MAE ≥ fracR × risk (SL about to hit)
 *  - close against the trade with an adverse candle body
 * → exit at close (slightly better than waiting for hard SL on doomed legs).
 * OOS Trap ~+₹7k / Genie-proxy ~+₹1k vs baseline; avg loss not worse.
 */
export function applySlConfirmCutoff(
  candle: Candle,
  open: ManagedOpenPosition,
  settings: StrategySettings,
): ManagedExitDecision | null {
  const x = settings.extras ?? {};
  if (x['slConfirmCutoffEnabled'] === false) {
    return null;
  }
  const fracR = typeof x['slConfirmCutoffFracR'] === 'number' ? x['slConfirmCutoffFracR'] : 0.7;
  const maxMfeR =
    typeof x['slConfirmCutoffMaxMfeR'] === 'number' ? x['slConfirmCutoffMaxMfeR'] : 0.25;
  if (!(fracR > 0) || !(maxMfeR >= 0)) {
    return null;
  }
  const risk =
    open.initialRiskPts != null && open.initialRiskPts > 0
      ? open.initialRiskPts
      : Math.abs(open.entry - open.stop);
  if (!(risk > 0)) {
    return null;
  }

  const mfe =
    open.direction === 'BUY'
      ? Math.max(0, candle.high - open.entry)
      : Math.max(0, open.entry - candle.low);
  const peak = Math.max(open.peakMfePts ?? 0, mfe);
  open.peakMfePts = peak;
  // Winners / partial greens: do not soft-cut (research: hurts net).
  if (peak >= maxMfeR * risk) {
    return null;
  }

  const mae =
    open.direction === 'BUY'
      ? Math.max(0, open.entry - candle.low)
      : Math.max(0, candle.high - open.entry);
  if (mae < fracR * risk) {
    return null;
  }

  const against =
    open.direction === 'BUY' ? candle.close < open.entry : candle.close > open.entry;
  const adverseBody =
    open.direction === 'BUY' ? candle.close < candle.open : candle.close > candle.open;
  if (!(against && adverseBody)) {
    return null;
  }

  return {
    exitPrice: candle.close,
    reason: 'SL cutoff — confirmed adverse',
  };
}

export function indexRuleExitLogic(
  candle: Candle,
  open: ManagedOpenPosition,
  closes: number[],
  settings: StrategySettings,
  spec: IndexRuleSpec,
  series?: Candle[],
): ManagedExitDecision | null {
  const time = extractHhMm(candle.date);

  if (spec.exit === 'swing_trail') {
    // Research order: hard SL first, then separate structure trail, then EOD.
    // Lookback from settings (Donch default: 5 = exit-lab structure_sw5; classic swing3 = 3).
    // Do NOT merge trail into hard stop — that diverged from research books.
    const lb = Math.max(1, Math.floor(settings.swingLookback) || 3);
    if (open.direction === 'BUY') {
      if (candle.low <= open.stop) {
        return { exitPrice: open.stop, reason: `Swing-${lb} trail / stop` };
      }
    } else if (candle.high >= open.stop) {
      return { exitPrice: open.stop, reason: `Swing-${lb} trail / stop` };
    }

    const bars = series ?? [];
    if (bars.length >= lb * 2 + 1) {
      const sw = researchSwingAt(bars, lb);
      if (open.direction === 'BUY' && sw.low != null) {
        open.trail =
          open.trail == null || !Number.isFinite(open.trail)
            ? sw.low
            : Math.max(open.trail, sw.low);
        if (candle.low <= open.trail) {
          return { exitPrice: open.trail, reason: `Swing-${lb} trail / stop` };
        }
      } else if (open.direction === 'SELL' && sw.high != null) {
        open.trail =
          open.trail == null || !Number.isFinite(open.trail)
            ? sw.high
            : Math.min(open.trail, sw.high);
        if (candle.high >= open.trail) {
          return { exitPrice: open.trail, reason: `Swing-${lb} trail / stop` };
        }
      }
    }

    if (time >= settings.exitTime) {
      return { exitPrice: candle.close, reason: 'EOD / session exit' };
    }
    return null;
  }

  applyIndexRuleProfitProtect(candle, open, settings);

  if (open.direction === 'BUY') {
    if (candle.low <= open.stop) {
      return {
        exitPrice: open.stop,
        reason: 'Stop loss hit',
      };
    }
    if (settings.targetRMultiple > 0 && candle.high >= open.target) {
      return { exitPrice: open.target, reason: 'Target hit' };
    }
  } else {
    if (candle.high >= open.stop) {
      return {
        exitPrice: open.stop,
        reason: 'Stop loss hit',
      };
    }
    if (settings.targetRMultiple > 0 && candle.low <= open.target) {
      return { exitPrice: open.target, reason: 'Target hit' };
    }
  }

  if (spec.exit === 'ema') {
    const ema = emaLast(closes, settings.emaLength);
    if (ema != null) {
      if (open.direction === 'BUY' && candle.close < ema) {
        return { exitPrice: candle.close, reason: `EMA-${settings.emaLength} exit` };
      }
      if (open.direction === 'SELL' && candle.close > ema) {
        return { exitPrice: candle.close, reason: `EMA-${settings.emaLength} exit` };
      }
    }
  }

  if (time >= settings.exitTime) {
    return { exitPrice: candle.close, reason: 'EOD / session exit' };
  }
  return null;
}

export function mergeSettings(
  base: StrategySettings,
  partial?: Partial<StrategySettings>,
): StrategySettings {
  if (!partial) {
    return { ...base, extras: { ...base.extras } };
  }
  return defaultStrategySettings({ ...base, ...partial, extras: { ...base.extras, ...partial.extras } });
}

export function recordRuleTradeClosed(
  state: RuleDayState,
  points: number,
  dayStopPts: number,
  dayProfitLockPts = 0,
): void {
  state.dayNetPts += points;
  state.tradesToday += 1;
  if (dayStopPts > 0 && state.dayNetPts <= -dayStopPts) {
    state.dayStopped = true;
  }
  if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStopped = true;
  }
}

/** unused import guard helper for toMin in tests */
export const _ruleTimeHelpers = { toMin };

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
  swingLevels,
  toMin,
} from '../indicators/desk-indicators';
import {
  ManagedExitDecision,
  ManagedOpenPosition,
  ManagedStrategySignal,
} from '../models/strategy-module.interface';
import {
  StrategySettings,
  defaultStrategySettings,
} from '../models/strategy-settings.model';

export type RuleEntryMode = 'vol_expand' | 'donch' | 'swing';
export type RuleBiasMode = 'ema' | 'prev_day' | 'none';
export type RuleExitMode = 'eod' | 'ema';

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
}

export function createRuleDayState(): RuleDayState {
  return { tradingDate: null, dayNetPts: 0, tradesToday: 0, dayStopped: false };
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
    return skip('Max trades per day reached');
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
  }

  if (!direction) {
    return wait('No breakout', { levelHigh, levelLow, bias });
  }
  if (bias === 'BUY' || bias === 'SELL') {
    if (direction !== bias) {
      return skip(`Breakout ${direction} against bias ${bias}`, { levelHigh, levelLow, bias });
    }
  }

  let stop =
    direction === 'BUY' ? Math.min(candle.low, levelLow) : Math.max(candle.high, levelHigh);
  let risk = Math.abs(close - stop);
  if (risk < settings.minStopPts) {
    return skip(`Risk ${risk.toFixed(1)} < min ${settings.minStopPts}`);
  }
  if (risk > settings.stopLossPts) {
    stop = direction === 'BUY' ? close - settings.stopLossPts : close + settings.stopLossPts;
    risk = settings.stopLossPts;
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

export function indexRuleExitLogic(
  candle: Candle,
  open: ManagedOpenPosition,
  closes: number[],
  settings: StrategySettings,
  spec: IndexRuleSpec,
): ManagedExitDecision | null {
  const time = extractHhMm(candle.date);

  if (open.direction === 'BUY') {
    if (candle.low <= open.stop) {
      return { exitPrice: open.stop, reason: 'Stop loss hit' };
    }
    if (settings.targetRMultiple > 0 && candle.high >= open.target) {
      return { exitPrice: open.target, reason: 'Target hit' };
    }
  } else {
    if (candle.high >= open.stop) {
      return { exitPrice: open.stop, reason: 'Stop loss hit' };
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

export function recordRuleTradeClosed(state: RuleDayState, points: number, dayStopPts: number): void {
  state.dayNetPts += points;
  state.tradesToday += 1;
  if (dayStopPts > 0 && state.dayNetPts <= -dayStopPts) {
    state.dayStopped = true;
  }
}

/** unused import guard helper for toMin in tests */
export const _ruleTimeHelpers = { toMin };

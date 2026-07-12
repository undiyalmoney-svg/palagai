import type {
  BarFeatures,
  Direction,
  EntryId,
  ExitId,
  SrId,
  StopId,
  TargetId,
  TimeId,
  TrendId,
} from './types.ts';

export function trendBias(f: BarFeatures, trend: TrendId): Direction {
  switch (trend) {
    case 'none':
      return 'FLAT';
    case 'hh_hl':
      return f.hhHl ? 'BUY' : f.lhLl ? 'SELL' : 'FLAT';
    case 'lh_ll':
      return f.lhLl ? 'SELL' : f.hhHl ? 'BUY' : 'FLAT';
    case 'ema20':
      return f.close > f.ema20 ? 'BUY' : f.close < f.ema20 ? 'SELL' : 'FLAT';
    case 'ema50':
      return f.close > f.ema50 ? 'BUY' : f.close < f.ema50 ? 'SELL' : 'FLAT';
    case 'ema200':
      return f.close > f.ema200 ? 'BUY' : f.close < f.ema200 ? 'SELL' : 'FLAT';
    case 'vwap':
      return f.close > f.vwap ? 'BUY' : f.close < f.vwap ? 'SELL' : 'FLAT';
    case 'supertrend':
      return f.supertrendDir === 1 ? 'BUY' : 'SELL';
    case 'prev_day_trend':
      return f.prevDayUp ? 'BUY' : 'SELL';
    case 'opening_range':
      if (!f.orDone) return 'FLAT';
      return f.orBullish ? 'BUY' : 'SELL';
    default:
      return 'FLAT';
  }
}

export function srLevels(f: BarFeatures, sr: SrId): { resistance: number; support: number } {
  switch (sr) {
    case 'swing':
      return { resistance: f.swingHigh, support: f.swingLow };
    case 'pdhl':
      return { resistance: f.pdh, support: f.pdl };
    case 'pivot':
      return { resistance: f.r1, support: f.s1 };
    case 'fractal':
      return { resistance: f.fractalHigh, support: f.fractalLow };
    case 'supply_demand':
      return { resistance: f.supply, support: f.demand };
    case 'session_hl':
      return { resistance: f.sessionHigh, support: f.sessionLow };
    case 'dynamic_sr':
      return { resistance: f.dynamicRes, support: f.dynamicSup };
    default:
      return { resistance: f.swingHigh, support: f.swingLow };
  }
}

export function entrySignal(
  f: BarFeatures,
  prev: BarFeatures | null,
  entry: EntryId,
  bias: Direction,
  levels: { resistance: number; support: number },
): 'BUY' | 'SELL' | null {
  const allowBuy = bias === 'BUY' || bias === 'FLAT';
  const allowSell = bias === 'SELL' || bias === 'FLAT';

  switch (entry) {
    case 'breakout':
      if (allowBuy && f.close > levels.resistance) return 'BUY';
      if (allowSell && f.close < levels.support) return 'SELL';
      return null;
    case 'break_retest':
      if (!prev) return null;
      if (allowBuy && prev.high >= levels.resistance && f.low <= levels.resistance && f.close > levels.resistance) {
        return 'BUY';
      }
      if (allowSell && prev.low <= levels.support && f.high >= levels.support && f.close < levels.support) {
        return 'SELL';
      }
      return null;
    case 'pullback':
      if (allowBuy && bias === 'BUY' && f.low <= f.ema20 && f.close > f.ema20) return 'BUY';
      if (allowSell && bias === 'SELL' && f.high >= f.ema20 && f.close < f.ema20) return 'SELL';
      return null;
    case 'bullish_engulfing':
      return allowBuy && f.bullEngulf ? 'BUY' : null;
    case 'bearish_engulfing':
      return allowSell && f.bearEngulf ? 'SELL' : null;
    case 'hammer':
      return allowBuy && f.hammer ? 'BUY' : null;
    case 'shooting_star':
      return allowSell && f.shootingStar ? 'SELL' : null;
    case 'inside_bar_break':
      if (!prev || !prev.insideBar) return null;
      if (allowBuy && f.close > prev.high) return 'BUY';
      if (allowSell && f.close < prev.low) return 'SELL';
      return null;
    case 'outside_bar':
      if (!f.outsideBar) return null;
      if (allowBuy && f.close > f.open) return 'BUY';
      if (allowSell && f.close < f.open) return 'SELL';
      return null;
    case 'liquidity_sweep':
      if (allowBuy && f.liqSweepLow) return 'BUY';
      if (allowSell && f.liqSweepHigh) return 'SELL';
      return null;
    case 'trendline_break':
      if (allowBuy && f.trendlineBreakUp) return 'BUY';
      if (allowSell && f.trendlineBreakDown) return 'SELL';
      return null;
    case 'triangle_break':
      if (allowBuy && f.triangleBreakUp) return 'BUY';
      if (allowSell && f.triangleBreakDown) return 'SELL';
      return null;
    case 'wedge_break':
      if (allowBuy && f.wedgeBreakUp) return 'BUY';
      if (allowSell && f.wedgeBreakDown) return 'SELL';
      return null;
    default:
      return null;
  }
}

export function computeStop(
  f: BarFeatures,
  direction: 'BUY' | 'SELL',
  entry: number,
  stop: StopId,
  levels: { resistance: number; support: number },
): number {
  const atr = Math.max(f.atr, 5);
  switch (stop) {
    case 'prev_swing':
      return direction === 'BUY' ? Math.min(f.swingLow, entry - atr) : Math.max(f.swingHigh, entry + atr);
    case 'candle_hl':
      return direction === 'BUY' ? f.low : f.high;
    case 'atr':
      return direction === 'BUY' ? entry - atr * 1.5 : entry + atr * 1.5;
    case 'fixed_points':
      return direction === 'BUY' ? entry - 40 : entry + 40;
    case 'dynamic_structure':
      return direction === 'BUY'
        ? Math.min(f.dynamicSup, entry - atr)
        : Math.max(f.dynamicRes, entry + atr);
    case 'zone_based':
      return direction === 'BUY' ? Math.min(levels.support, entry - atr) : Math.max(levels.resistance, entry + atr);
    default:
      return direction === 'BUY' ? entry - 40 : entry + 40;
  }
}

export function computeTarget(
  f: BarFeatures,
  direction: 'BUY' | 'SELL',
  entry: number,
  stop: number,
  target: TargetId,
  levels: { resistance: number; support: number },
): number {
  const risk = Math.max(Math.abs(entry - stop), 1);
  const atr = Math.max(f.atr, 5);
  switch (target) {
    case 'r_1':
      return direction === 'BUY' ? entry + risk : entry - risk;
    case 'r_1_5':
      return direction === 'BUY' ? entry + risk * 1.5 : entry - risk * 1.5;
    case 'r_2':
      return direction === 'BUY' ? entry + risk * 2 : entry - risk * 2;
    case 'r_2_5':
      return direction === 'BUY' ? entry + risk * 2.5 : entry - risk * 2.5;
    case 'r_3':
      return direction === 'BUY' ? entry + risk * 3 : entry - risk * 3;
    case 'prev_swing':
      return direction === 'BUY' ? Math.max(f.swingHigh, entry + risk) : Math.min(f.swingLow, entry - risk);
    case 'next_resistance':
      return direction === 'BUY'
        ? Math.max(levels.resistance, entry + risk)
        : Math.min(levels.support, entry - risk);
    case 'atr_target':
      return direction === 'BUY' ? entry + atr * 2.5 : entry - atr * 2.5;
    case 'trailing_stop':
      return direction === 'BUY' ? entry + risk * 2 : entry - risk * 2;
    default:
      return direction === 'BUY' ? entry + risk * 2 : entry - risk * 2;
  }
}

export function inTimeWindow(hhmm: string, time: TimeId): boolean {
  switch (time) {
    case '0920_1030':
      return hhmm >= '09:20' && hhmm <= '10:30';
    case '1030_1200':
      return hhmm >= '10:30' && hhmm <= '12:00';
    case '1300_1430':
      return hhmm >= '13:00' && hhmm <= '14:30';
    case 'whole_day':
    case 'one_trade_day':
    case 'max_two_trades':
      return hhmm >= '09:20' && hhmm <= '15:10';
    default:
      return true;
  }
}

export function maxTradesPerDay(time: TimeId): number {
  if (time === 'one_trade_day') return 1;
  if (time === 'max_two_trades') return 2;
  return 99;
}

export function shouldExitByRule(
  f: BarFeatures,
  direction: 'BUY' | 'SELL',
  exit: ExitId,
  opposite: boolean,
): boolean {
  if (exit === 'end_of_day' && f.hhmm >= '15:15') return true;
  if (exit === 'opposite_signal' && opposite) return true;
  if (exit === 'ema_exit') {
    if (direction === 'BUY' && f.close < f.ema20) return true;
    if (direction === 'SELL' && f.close > f.ema20) return true;
  }
  if (exit === 'trailing_swing') {
    if (direction === 'BUY' && f.close < f.swingLow) return true;
    if (direction === 'SELL' && f.close > f.swingHigh) return true;
  }
  return false;
}

export const TREND_IDS: TrendId[] = [
  'hh_hl',
  'lh_ll',
  'ema20',
  'ema50',
  'ema200',
  'vwap',
  'supertrend',
  'prev_day_trend',
  'opening_range',
  'none',
];

export const SR_IDS: SrId[] = [
  'swing',
  'pdhl',
  'pivot',
  'fractal',
  'supply_demand',
  'session_hl',
  'dynamic_sr',
];

export const ENTRY_IDS: EntryId[] = [
  'breakout',
  'break_retest',
  'pullback',
  'bullish_engulfing',
  'bearish_engulfing',
  'hammer',
  'shooting_star',
  'inside_bar_break',
  'outside_bar',
  'liquidity_sweep',
  'trendline_break',
  'triangle_break',
  'wedge_break',
];

export const STOP_IDS: StopId[] = [
  'prev_swing',
  'candle_hl',
  'atr',
  'fixed_points',
  'dynamic_structure',
  'zone_based',
];

export const TARGET_IDS: TargetId[] = [
  'r_1',
  'r_1_5',
  'r_2',
  'r_2_5',
  'r_3',
  'prev_swing',
  'next_resistance',
  'atr_target',
  'trailing_stop',
];

export const TIME_IDS: TimeId[] = [
  '0920_1030',
  '1030_1200',
  '1300_1430',
  'whole_day',
  'one_trade_day',
  'max_two_trades',
];

export const EXIT_IDS: ExitId[] = [
  'fixed_rr',
  'opposite_signal',
  'end_of_day',
  'trailing_swing',
  'ema_exit',
];

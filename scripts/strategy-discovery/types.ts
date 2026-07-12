/** Shared types for the strategy discovery engine. */

export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Direction = 'BUY' | 'SELL' | 'FLAT';

export type TrendId =
  | 'hh_hl'
  | 'lh_ll'
  | 'ema20'
  | 'ema50'
  | 'ema200'
  | 'vwap'
  | 'supertrend'
  | 'prev_day_trend'
  | 'opening_range'
  | 'none';

export type SrId =
  | 'swing'
  | 'pdhl'
  | 'pivot'
  | 'fractal'
  | 'supply_demand'
  | 'session_hl'
  | 'dynamic_sr';

export type EntryId =
  | 'breakout'
  | 'break_retest'
  | 'pullback'
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'hammer'
  | 'shooting_star'
  | 'inside_bar_break'
  | 'outside_bar'
  | 'liquidity_sweep'
  | 'trendline_break'
  | 'triangle_break'
  | 'wedge_break';

export type StopId =
  | 'prev_swing'
  | 'candle_hl'
  | 'atr'
  | 'fixed_points'
  | 'dynamic_structure'
  | 'zone_based';

export type TargetId =
  | 'r_1'
  | 'r_1_5'
  | 'r_2'
  | 'r_2_5'
  | 'r_3'
  | 'prev_swing'
  | 'next_resistance'
  | 'atr_target'
  | 'trailing_stop';

export type TimeId =
  | '0920_1030'
  | '1030_1200'
  | '1300_1430'
  | 'whole_day'
  | 'one_trade_day'
  | 'max_two_trades';

export type ExitId =
  | 'fixed_rr'
  | 'opposite_signal'
  | 'end_of_day'
  | 'trailing_swing'
  | 'ema_exit';

export interface StrategyDna {
  id: string;
  trend: TrendId;
  sr: SrId;
  entry: EntryId;
  stop: StopId;
  target: TargetId;
  time: TimeId;
  exit: ExitId;
}

export interface ClosedTrade {
  entryTime: string;
  exitTime: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  exit: number;
  stop: number;
  target: number;
  points: number;
  rMultiple: number;
  outcome: 'WIN' | 'LOSS';
  month: string;
  year: string;
}

export interface StrategyMetrics {
  netProfit: number;
  cagr: number;
  winRate: number;
  profitFactor: number;
  sharpe: number;
  maxDrawdownPct: number;
  avgR: number;
  totalTrades: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  monthlyReturns: Record<string, number>;
  yearlyReturns: Record<string, number>;
  consistencyScore: number;
  stabilityScore: number;
}

export interface StrategyResult {
  dna: StrategyDna;
  metrics: StrategyMetrics;
  trades: ClosedTrade[];
  equityCurve: { date: string; equity: number }[];
  passedFilters: boolean;
  rankScore: number;
}

/** Per-bar precomputed features — one pass for all strategies. */
export interface BarFeatures {
  i: number;
  date: string;
  hhmm: string;
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20: number;
  ema50: number;
  ema200: number;
  vwap: number;
  atr: number;
  supertrend: number;
  supertrendDir: 1 | -1;
  swingHigh: number;
  swingLow: number;
  fractalHigh: number;
  fractalLow: number;
  pivot: number;
  r1: number;
  s1: number;
  pdh: number;
  pdl: number;
  pdc: number;
  sessionHigh: number;
  sessionLow: number;
  orHigh: number;
  orLow: number;
  orDone: boolean;
  supply: number;
  demand: number;
  dynamicRes: number;
  dynamicSup: number;
  hhHl: boolean;
  lhLl: boolean;
  prevDayUp: boolean;
  orBullish: boolean;
  bullEngulf: boolean;
  bearEngulf: boolean;
  hammer: boolean;
  shootingStar: boolean;
  insideBar: boolean;
  outsideBar: boolean;
  liqSweepHigh: boolean;
  liqSweepLow: boolean;
  trendlineBreakUp: boolean;
  trendlineBreakDown: boolean;
  triangleBreakUp: boolean;
  triangleBreakDown: boolean;
  wedgeBreakUp: boolean;
  wedgeBreakDown: boolean;
}

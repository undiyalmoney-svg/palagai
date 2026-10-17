export type MarketBias =
  | 'bullish'
  | 'mild-bull'
  | 'mixed'
  | 'sideways'
  | 'mild-bear'
  | 'bearish'
  | 'insufficient';

export type BreakoutStatus =
  | 'none'
  | 'potential'
  | 'confirmed'
  | 'retest'
  | 'failed'
  | 'insufficient';

export interface MarketDeskSettings {
  emaFast: number;
  emaSlow: number;
  adxPeriod: number;
  adxWeak: number;
  adxStrong: number;
  pivotStrength: number;
  srLookback: number;
  breakoutBufferPct: number;
  volumeFilter: boolean;
  retestRequired: boolean;
  cooldownBars: number;
  uiRefreshMs: number;
  alertCooldownMs: number;
  primaryTimeframe: '5minute' | '15minute' | '60minute' | 'day';
}

export interface MarketBreakout {
  status: BreakoutStatus;
  direction: 'bull' | 'bear' | null;
  level: number | null;
  close: number | null;
  closeTime: string | null;
  support: number | null;
  resistance: number | null;
  volumeOk?: boolean;
  interval?: string;
  forming?: boolean;
}

export interface MarketSetup {
  symbol: string;
  name?: string;
  direction: 'long' | 'short';
  timeframe: string;
  status: string;
  level: number;
  support: number | null;
  resistance: number | null;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  trendAgreement: string;
  invalidation: string;
  reason: string;
}

export interface MarketIndexCard {
  id: string;
  name: string;
  symbol: string;
  ltp: number | null;
  change: number | null;
  changePct: number | null;
  bias: MarketBias;
  biasLabel: string;
  confirmed: boolean;
  score: number | null;
  strength: string;
  strengthLabel: string;
  breakout15: MarketBreakout;
  breakout60: MarketBreakout;
  agreement: string;
  m15Trend: string;
  h1Trend: string;
  dayTrend: string;
  setup?: MarketSetup | null;
  behaviour?: MarketBehaviour | null;
}

export interface MarketStockTile {
  symbol: string;
  name: string;
  sector: string;
  ltp: number | null;
  changePct: number | null;
  bias: MarketBias;
  biasLabel: string;
  confirmed: boolean;
  score: number | null;
  strength: string;
  m15Trend: string;
  h1Trend: string;
  breakout15: MarketBreakout;
  breakout60: MarketBreakout;
  breakoutAgree: boolean;
  breakoutConflict?: boolean;
  aboveEma20: boolean | null;
  aboveEma50: boolean | null;
  setup?: MarketSetup | null;
}

export interface MarketBreadth {
  advances: number;
  declines: number;
  unchanged: number;
  adRatio: number | null;
  adRatioLabel: string;
  pctAboveEma20: number | null;
  pctAboveEma50: number | null;
  strongest: { symbol: string; changePct: number }[];
  weakest: { symbol: string; changePct: number }[];
  sectors: { sector: string; avgChangePct: number; n: number }[];
  divergence: string | null;
}

export interface MarketDeskAlert {
  type: string;
  symbol: string;
  provisional: boolean;
  message: string;
  direction?: string | null;
  status?: string;
  closeTime?: string | null;
}

export interface MarketDeskSession {
  status: string;
  label: string;
  open: boolean;
  day: string;
  istNow: string;
  lastUpdateAt: string;
  lastTickAt: string | null;
  lastConfirmedCandleAt: string | null;
  connection: string;
  freshness: string;
  timeframe: string;
  message?: string | null;
}

export type BehaviourFlow = 'bull' | 'bear' | 'side' | 'fade' | 'reversal' | 'failed' | 'wait';

export interface MarketBehaviourTf {
  interval?: string;
  key?: string;
  label: string;
  trend: string;
  direction: string;
  rsi?: number | null;
  adx?: number | null;
  atr?: number | null;
  strength?: string;
  strengthLabel?: string;
  structure?: string;
  bos?: string | null;
  choch?: string | null;
  momentum?: string;
  volatility?: string;
  forming?: boolean;
  provisional?: boolean;
  missing?: boolean;
}

export interface MarketBehaviour {
  instrument: string;
  name?: string;
  ltp: number | null;
  change: number | null;
  changePct: number | null;
  classification: string;
  classificationLabel: string;
  direction: string;
  nodeLabel: string;
  flow: BehaviourFlow;
  trendStrength: string;
  trendStrengthLabel: string;
  evidenceStrength: string;
  evidenceStrengthLabel: string;
  confirmed: boolean;
  provisional: boolean;
  primaryTimeframe: string;
  timeframes: {
    m5: MarketBehaviourTf;
    m15: MarketBehaviourTf;
    h1: MarketBehaviourTf;
    day: MarketBehaviourTf;
  };
  alignment: {
    status: string;
    label: string;
    bulls: number;
    bears: number;
    sides: number;
    available: number;
    conflicts: string[];
  };
  structure: {
    label?: string;
    hh?: boolean;
    hl?: boolean;
    lh?: boolean;
    ll?: boolean;
    bos?: string | null;
    choch?: string | null;
    lastHigh?: number | null;
    lastLow?: number | null;
    developing?: boolean;
  } | null;
  range: {
    kind: string;
    high: number;
    low: number;
    mid: number;
    width: number;
    widthAtr: number | null;
    testsHigh: number;
    testsLow: number;
    position: number;
  } | null;
  breakout: { status: string; direction: string | null; level: number | null };
  reversal: { status: string; side: string | null; timeframe: string | null };
  momentum: { state: string; label: string };
  volatility: { state: string; label: string };
  transition: { stage: number; label: string; confirmed: string[]; required: string[] };
  explanation: {
    behaviour: string;
    higherTf: string;
    intraday: string;
    momentum: string;
    structure: string;
    breakout: string;
    reversal: string;
    supporting: string[];
    conflicting: string[];
    confirmation: string;
    invalidation: string;
  };
  levels: { support: number | null; resistance: number | null; invalidation: string };
  timeline: {
    instrument: string;
    timestamp: string;
    timeframe: string;
    type: string;
    level: number | null;
    evidence: string;
    status: string;
  }[];
  lastUpdateAt: string;
  sample: boolean;
}

export interface MarketDeskSnapshot {
  private: true;
  demo: boolean;
  needsReauth: boolean;
  settings: MarketDeskSettings;
  session: MarketDeskSession;
  indices: MarketIndexCard[];
  stocks: MarketStockTile[];
  breadth: MarketBreadth;
  setups: MarketSetup[];
  alerts: MarketDeskAlert[];
  warning: string | null;
}

export interface MarketDeskCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDeskOverlay {
  emaFast: number | null;
  emaSlow: number | null;
  vwap: number | null;
  adx: number | null;
  support: number | null;
  resistance: number | null;
  pivots: { kind: string; index: number; price: number; date: string }[];
  breakout: MarketBreakout;
  lastCandleAt?: string;
  forming?: boolean;
}

export interface MarketDeskCandles {
  demo?: boolean;
  needsReauth?: boolean;
  symbol?: string;
  interval?: string;
  candles: MarketDeskCandle[];
  overlay?: MarketDeskOverlay;
  message?: string;
}

export const DEFAULT_DESK_SETTINGS: MarketDeskSettings = {
  emaFast: 20,
  emaSlow: 50,
  adxPeriod: 14,
  adxWeak: 18,
  adxStrong: 25,
  pivotStrength: 2,
  srLookback: 20,
  breakoutBufferPct: 0.08,
  volumeFilter: false,
  retestRequired: false,
  cooldownBars: 4,
  uiRefreshMs: 5_000,
  alertCooldownMs: 120_000,
  primaryTimeframe: '15minute',
};

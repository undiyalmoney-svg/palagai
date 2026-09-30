/**
 * Smart Money Concepts (SMC) model shared by the engine, the stats, the alert
 * tracker and the chart renderer.
 *
 * Every record carries a `confirmedAt` bar index: the closed bar on which the
 * engine first knew it. Nothing is ever created, moved or deleted by a later
 * bar, which is what makes the output non-repainting. `index` is where the
 * thing sits on the chart (a swing is drawn on its own pivot bar, but is only
 * known `swingLength` bars later).
 */

export type SmcMarketId = 'nifty' | 'bank' | 'crude';

export const SMC_MARKET_NAMES: Record<SmcMarketId, string> = {
  nifty: 'NIFTY 50',
  bank: 'BANK NIFTY',
  crude: 'CRUDE OIL',
};

export type SmcTrend = 'bullish' | 'bearish' | 'sideways';
export type SmcDir = 'bull' | 'bear';
export type SmcSide = 'BUY' | 'SELL';

export type SmcSwingLabel = 'HH' | 'HL' | 'LH' | 'LL' | 'EQH' | 'EQL';

export interface SmcSwing {
  id: string;
  kind: 'high' | 'low';
  /** Pivot bar. */
  index: number;
  price: number;
  /** Bar on which the pivot became known (`index + swingLength`). */
  confirmedAt: number;
  /** Classification against the previous swing of the same kind. */
  label: SmcSwingLabel | null;
  /** Bar whose close broke this swing, or null while it stands. */
  brokenAt: number | null;
}

export type SmcStructureKind = 'BOS' | 'CHoCH';

export interface SmcStructureEvent {
  id: string;
  kind: SmcStructureKind;
  dir: SmcDir;
  /** Level that was broken (the swing price). */
  level: number;
  /** Pivot bar of the broken swing. */
  swingIndex: number;
  /** Bar that closed through the level; also the bar it was confirmed on. */
  index: number;
  confirmedAt: number;
  date: string;
}

export type SmcZoneStatus = 'active' | 'invalidated' | 'filled';

export interface SmcOrderBlock {
  id: string;
  dir: SmcDir;
  /** The candle the block is drawn from. */
  index: number;
  confirmedAt: number;
  lo: number;
  hi: number;
  /** First bar that traded back into the block, or null. */
  touchedAt: number | null;
  status: SmcZoneStatus;
  /** Bar on which a close went through the block. */
  endedAt: number | null;
  eventId: string;
}

export interface SmcFvg {
  id: string;
  dir: SmcDir;
  /** Middle candle of the three. */
  index: number;
  confirmedAt: number;
  lo: number;
  hi: number;
  status: SmcZoneStatus;
  endedAt: number | null;
}

export interface SmcLiquidity {
  id: string;
  /** BSL rests above swing highs, SSL below swing lows. */
  side: 'BSL' | 'SSL';
  price: number;
  /** Pivot bar the level came from. */
  index: number;
  confirmedAt: number;
  /** Two or more swings within tolerance. */
  equal: boolean;
  sweptAt: number | null;
  /** The sweeping bar closed back on the near side of the level. */
  rejected: boolean;
}

export interface SmcEqualLevel {
  id: string;
  kind: 'EQH' | 'EQL';
  price: number;
  indexA: number;
  indexB: number;
  confirmedAt: number;
}

export interface SmcRange {
  hi: number;
  lo: number;
  eq: number;
  /** Bar the range was fixed on. */
  since: number;
  startIndex: number;
}

export type SmcPdZone = 'premium' | 'discount' | 'equilibrium';

export type SmcExitReason =
  | 'stop_loss'
  | 'breakeven_stop'
  | 'take_profit'
  | 'opposite_structure'
  | 'trend_reversal'
  | 'setup_invalidated';

export const SMC_EXIT_LABELS: Record<SmcExitReason, string> = {
  stop_loss: 'Stop loss hit',
  breakeven_stop: 'Stopped at breakeven',
  take_profit: 'Final target hit',
  opposite_structure: 'Opposite structure confirmed',
  trend_reversal: 'Trend reversal',
  setup_invalidated: 'Setup / order block invalidated',
};

export type SmcFillKind = 'TP1' | 'TP2' | 'FINAL' | 'STOP' | 'EXIT';

export interface SmcFill {
  kind: SmcFillKind;
  index: number;
  date: string;
  price: number;
  /** Share of the original position closed by this fill (0–1). */
  fraction: number;
}

export interface SmcTrade {
  id: string;
  side: SmcSide;
  entryIndex: number;
  entryDate: string;
  entryTs: number;
  entryPrice: number;
  /** Stop as first placed. */
  sl: number;
  /** Stop currently working (moves to breakeven after TP1). */
  slNow: number;
  tp1: number;
  tp2: number;
  tpFinal: number;
  /** Price distance from entry to the first stop. */
  risk: number;
  /** Planned reward:risk to the final target. */
  rr: number;
  /** Position size in units, from risk % of running equity. */
  units: number;
  /** What put the setup on: e.g. Discount, Order block, Liquidity sweep. */
  poi: string[];
  triggerKind: SmcStructureKind;
  triggerEventId: string;
  obId: string | null;
  status: 'open' | 'closed';
  fills: SmcFill[];
  /** Share of the position still open (0–1). */
  remaining: number;
  exitIndex: number | null;
  exitDate: string | null;
  exitTs: number | null;
  /** Size-weighted average price of all fills. */
  exitPrice: number | null;
  exitReason: SmcExitReason | null;
  /** Realised result in R (1R = initial risk). */
  rMultiple: number | null;
  /** Realised result as a percent of equity at the time (rMultiple × risk %). */
  returnPct: number | null;
}

export interface SmcSignal {
  id: string;
  side: SmcSide;
  index: number;
  date: string;
  price: number;
  tradeId: string;
}

export type SmcAlertType =
  | 'BUY'
  | 'SELL'
  | 'EXIT'
  | 'STOP_LOSS'
  | 'TP1'
  | 'TP2'
  | 'FINAL_TP'
  | 'BOS_BULL'
  | 'BOS_BEAR'
  | 'CHOCH_BULL'
  | 'CHOCH_BEAR';

export const SMC_ALERT_TYPES: readonly SmcAlertType[] = [
  'BUY',
  'SELL',
  'EXIT',
  'STOP_LOSS',
  'TP1',
  'TP2',
  'FINAL_TP',
  'BOS_BULL',
  'BOS_BEAR',
  'CHOCH_BULL',
  'CHOCH_BEAR',
];

export const SMC_ALERT_LABELS: Record<SmcAlertType, string> = {
  BUY: 'Confirmed BUY',
  SELL: 'Confirmed SELL',
  EXIT: 'Exit',
  STOP_LOSS: 'Stop loss',
  TP1: 'TP1',
  TP2: 'TP2',
  FINAL_TP: 'Final TP',
  BOS_BULL: 'Bullish BOS',
  BOS_BEAR: 'Bearish BOS',
  CHOCH_BULL: 'Bullish CHoCH',
  CHOCH_BEAR: 'Bearish CHoCH',
};

export interface SmcAlertEvent {
  /** Stable across re-runs, so the same event can never fire twice. */
  id: string;
  type: SmcAlertType;
  index: number;
  date: string;
  ts: number;
  price: number;
  message: string;
}

export interface SmcArmedSetup {
  side: SmcSide;
  armedAt: number;
  armedDate: string;
  lastTouchAt: number;
  poi: string[];
  /** A sweep or a rejection candle has already happened. */
  reacted: boolean;
  /** Lowest low (long) or highest high (short) since arming. */
  extreme: number;
  obId: string | null;
}

export interface SmcHtfPoint {
  closeTs: number;
  trend: SmcTrend;
}

export interface SmcPreview {
  kind: 'setup' | 'entry';
  side: SmcSide;
  /** Forming bar index (= number of closed bars). */
  index: number;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tpFinal: number | null;
  rr: number | null;
  label: string;
}

export type SmcPositionStatus = 'Waiting' | 'Long' | 'Short' | 'Exited';

export interface SmcSnapshot {
  market: SmcMarketId;
  marketName: string;
  /** Trend that gates entries: higher timeframe when available. */
  trend: SmcTrend;
  ltfTrend: SmcTrend;
  htfTrend: SmcTrend | null;
  structure: string;
  lastBos: 'Bullish' | 'Bearish' | null;
  lastChoch: 'Bullish' | 'Bearish' | null;
  setup: 'None' | 'Buy Setup' | 'Sell Setup';
  /** True while the setup is only a developing one. */
  setupUnconfirmed: boolean;
  signal: 'BUY' | 'SELL' | 'NONE';
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tpFinal: number | null;
  rr: number | null;
  position: SmcPositionStatus;
  zone: SmcPdZone | null;
  lastPrice: number | null;
}

export interface SmcStats {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** Percent, 0–100. */
  winRate: number | null;
  /** Mean planned reward:risk of the trades taken. */
  avgPlannedRr: number | null;
  /** Mean realised R. */
  avgR: number | null;
  profitFactor: number | null;
  /** Peak-to-trough fall of the closed-trade equity curve, in percent. */
  maxDrawdownPct: number;
  netReturnPct: number;
  avgTradePct: number | null;
  buySignals: number;
  sellSignals: number;
  openTrades: number;
}

export interface SmcStatsSplit {
  backtest: SmcStats;
  live: SmcStats;
  /** Timestamp the live session starts at, or null when nothing is live. */
  liveFromTs: number | null;
}

export interface SmcAnalysis {
  market: SmcMarketId;
  /** Closed candles the analysis ran over. */
  bars: number;
  swings: SmcSwing[];
  structure: SmcStructureEvent[];
  orderBlocks: SmcOrderBlock[];
  fvgs: SmcFvg[];
  liquidity: SmcLiquidity[];
  equalLevels: SmcEqualLevel[];
  range: SmcRange | null;
  zone: SmcPdZone | null;
  /** Trend as it stood on each closed bar. Never rewritten. */
  trendAt: SmcTrend[];
  htfTrendAt: (SmcTrend | null)[];
  trades: SmcTrade[];
  signals: SmcSignal[];
  alerts: SmcAlertEvent[];
  setup: SmcArmedSetup | null;
  preview: SmcPreview | null;
  snapshot: SmcSnapshot;
  stats: SmcStatsSplit;
  atr: number | null;
  htfAvailable: boolean;
}

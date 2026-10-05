/**
 * Response shapes of the Order API `/momentum` endpoints.
 * The frontend only renders these; every number is computed server-side.
 */

export type PortfolioMode = 'PAPER' | 'LIVE';
export type Regime = 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'HIGH_VOLATILITY';
export type Action = 'BUY' | 'HOLD' | 'WAIT' | 'REDUCE' | 'SELL' | 'EXIT' | 'ADD';
export type EntryStatus = 'WAIT' | 'WATCH' | 'BUY' | 'STRONG_BUY';

export interface ApiOk {
  status: 'ok';
}

export interface ProviderInfo {
  id: string;
  label: string;
  simulated: boolean;
  ready: boolean;
  note?: string;
  simulatedNotice?: string | null;
}

export interface MomentumStatus extends ApiOk {
  provider: ProviderInfo;
  data: { rows: number; symbols: number; first: string | null; last: string | null };
  market: { open: boolean; reason: string; date: string };
  lastTradingDate: string;
  broker: {
    configured: boolean;
    apiKey?: string;
    updatedAt?: string;
    liveEnabled: boolean;
    hasLivePortfolio: boolean;
  };
  strategy: { id: string; name: string };
  horizon: string;
  today: string;
  phrases: { live: string; auto: string };
}

export interface RegimePolicy {
  positionsMult: number;
  minCashPct: number;
  allowNewBuys: boolean;
  minEntryStatus: string;
  sizeMult: number;
  scoreBonus: number;
  trailMult: number;
}

export interface RegimeReading {
  regime: Regime;
  score: number;
  reasons: string[];
  policy: RegimePolicy;
  components?: { trend: number; breadth: number; momentum: number; volatility: number };
  metrics?: {
    niftyClose: number;
    niftyRet1m: number;
    niftyRet3m: number;
    hv20: number;
    hvPercentile: number;
    drawdownFrom52wHigh: number;
    pctAboveMid: number;
    pctAboveLong: number;
    pctPositive3m: number;
    universeSize: number;
  };
  asOf?: string;
}

export interface RegimeHistoryRow {
  date: string;
  regime: Regime;
  score: number;
}

export interface Returns {
  d1?: number;
  w1?: number;
  m1?: number;
  m3?: number;
  m6?: number;
  m12?: number;
}

export interface RankRow {
  rank: number;
  symbol: string;
  name: string;
  sector: string;
  price: number;
  score: number;
  eligible: boolean;
  components: Record<string, number>;
  ret: Returns;
  rsVsIndex3m: number | null;
  relVolume: number;
  rsi: number;
  adx: number;
  atrPct: number;
  aboveEma: Record<string, boolean>;
  breakout: boolean;
  pctFromHigh52: number;
  held: boolean;
  status: EntryStatus | string;
  ineligibleReasons: string[];
}

export interface Check {
  id: string;
  label: string;
  pass: boolean;
  critical: boolean;
  detail: string;
}

export interface RiskPlan {
  stopPrice?: number;
  stopType?: string;
  target?: number;
  rewardRisk?: number;
  riskPerShare?: number;
  riskAmount?: number;
  riskPctOfPortfolio?: number;
}

export interface Explanation {
  whyBuy?: string;
  whyNow?: string;
  whyThisStock?: string;
  whyThisPrice?: string;
  howMuch?: string;
  howManyShares?: string;
  confirms?: string[];
  invalidates?: string[];
  expectedHolding?: string;
  risk?: string;
  headline?: string;
  waitFor?: string[];
  whySell?: string;
  whyHold?: string;
  result?: string;
  thesis?: string[];
  warnings?: string[];
  nextStep?: string;
  note?: string | null;
  score?: number;
}

export interface Decision {
  symbol: string;
  name: string;
  sector: string;
  action: Action;
  timing: string;
  quantity: number;
  priceRef: number;
  allocationValue: number;
  allocationPct: number;
  reason: string;
  reasons: string[];
  strategy: string;
  risk: RiskPlan | null;
  score: number | null;
  confidence: number | null;
  rank: number | null;
  trigger: string | null;
  entryStatus: string | null;
  waitFor: string[];
  explanation: Explanation | null;
  checks: Check[];
  thesis: Array<{ id?: string; label?: string; ok?: boolean; detail?: string }> | null;
  components: Record<string, number> | null;
  kind: string | null;
  asOf: string;
  timestamp: string;
  decisionKey: string;
}

export interface DecisionSummary {
  answer: string;
  headline: string;
  lines: string[];
  text: string;
  counts: { buy: number; sell: number; reduce: number; hold: number; wait: number };
  deployable: number;
}

export interface SizeConstraint {
  id: string;
  label: string;
  value: number;
  detail: string;
  binding: boolean;
}

export interface DecisionResult {
  hypothetical?: boolean;
  persisted?: boolean;
  runId?: number;
  strategy?: { id: string; name: string };
  asOf: string;
  answer: string;
  headline: string;
  summary: DecisionSummary;
  regime: RegimeReading;
  review: boolean;
  triggers: Array<{ type: string; detail: string }>;
  capital: {
    equity: number;
    planEquity: number;
    cash: number;
    invested: number;
    deployable: number;
    reserve: number;
    reservePct: number;
    capitalEvent: { amount: number; kind?: string } | null;
  };
  portfolioSize: {
    n: number;
    explanation: string;
    constraints: SizeConstraint[];
    reservePct: number;
    rho: number;
  };
  allocation: { option: string; label: string; explanation: string; notes: string[]; cashLeft: number };
  decisions: Decision[];
  exposure: {
    invested: number;
    openRisk: number;
    openRiskPct: number;
    positionsCount: number;
    sectors: Record<string, number>;
  };
  drawdown: { drawdown: number; halted: boolean };
  signals?: Array<{ id: number; created: boolean; decisionKey: string }>;
  execution?: ExecutionOutcome | null;
}

export interface ExecutionOutcome {
  auto: boolean;
  results: Array<{
    signalId: number;
    symbol: string;
    action: string;
    orderId?: number;
    status: string;
    duplicate?: boolean;
    message?: string | null;
  }>;
}

export interface Signal {
  id: number;
  runId: number | null;
  portfolioId: number;
  asOf: string;
  symbol: string;
  action: Action;
  timing: string;
  quantity: number;
  priceRef: number;
  allocationValue: number;
  reason: string;
  trigger: string | null;
  strategy: string;
  score: number | null;
  confidence: number | null;
  status: string;
  decisionKey: string;
  orderId: number | null;
  createdAt: string;
}

export interface OrderStep {
  id: string;
  pass: boolean;
  detail: string;
}

export interface Order {
  id: number;
  portfolioId: number;
  signalId: number | null;
  idempotencyKey: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  orderType: string;
  limitPrice: number | null;
  priceRef: number | null;
  status: string;
  filledQty: number;
  avgFillPrice: number | null;
  broker: string;
  brokerOrderId: string | null;
  variety: string | null;
  reason: string;
  error: string | null;
  validation: OrderStep[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEvent {
  status: string;
  filledQty: number;
  detail: string;
  ts: string;
}

export interface ExecuteResponse {
  order: Order;
  duplicate: boolean;
  queued: boolean;
  rejected: boolean;
  validation: OrderStep[] | null;
  message: string | null;
}

export interface Position {
  symbol: string;
  name: string;
  sector: string;
  qty: number;
  avgPrice: number;
  lastPrice: number;
  value: number;
  weightPct: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  entryDate: string;
  stopPrice: number | null;
  initialStop: number | null;
  riskToStop: number | null;
  realizedPnl: number;
}

export interface CapitalEvent {
  id: number;
  kind: string;
  amount: number;
  note: string | null;
  ts: string;
  processed: boolean;
}

export interface PortfolioView extends ApiOk {
  portfolio: {
    id: number;
    mode: PortfolioMode;
    name: string;
    strategyId: string;
    autoExecute: boolean;
    initialCapital: number;
    lastReviewDate: string | null;
    prevRegime: string | null;
    peakEquity: number;
    createdAt: string;
  };
  valuation: { equity: number; cash: number; invested: number; unrealized: number; exposurePct: number };
  positions: Position[];
  sectors: Record<string, number>;
  openOrders: Order[];
  capitalEvents: CapitalEvent[];
}

export interface Trade {
  id: number;
  orderId: number | null;
  date: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  value: number;
  cost: number;
  pnl: number | null;
  pnlPct: number | null;
  holdingDays: number | null;
  reason: string;
}

export interface Performance extends ApiOk {
  equity: number;
  cash: number;
  invested: number;
  unrealized: number;
  realizedPnl: number;
  totalPnl: number;
  totalReturnPct: number;
  contributions: number;
  tradesClosed: number;
  winRatePct: number;
  totalCosts: number;
  metrics: Metrics | null;
  equitySeries: Array<{ date: string; equity: number; cash: number; invested: number }>;
  note?: string;
}

export interface Metrics {
  startCapital: number;
  endCapital: number;
  netContributions?: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  maxDrawdownStart?: string;
  maxDrawdownEnd?: string;
  annualVolPct?: number;
  sharpe: number;
  sortino: number;
  calmar?: number;
  trades: number;
  roundTrips: number;
  winRatePct: number;
  profitFactor: number;
  avgProfit: number;
  avgLoss: number;
  avgWinPct?: number;
  avgLossPct?: number;
  expectancy: number;
  avgHoldingDays: number;
  turnoverPerYear: number;
  totalCosts: number;
  totalSlippage: number;
  costDragPct?: number;
  avgExposurePct?: number;
  bestTrade?: number;
  worstTrade?: number;
  years: number;
  days: number;
  benchmarkReturnPct?: number;
  benchmarkCagrPct?: number;
  benchmarkMaxDrawdownPct?: number;
  alphaCagrPct?: number;
  rejectedOrders?: number;
  capitalEvents?: number;
}

export interface BacktestTrade {
  seq: number;
  date: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  action: string;
  qty: number;
  price: number;
  value: number;
  cost: number;
  pnl: number | null;
  pnlPct: number | null;
  holdingDays: number | null;
  trigger: string | null;
  reason: string;
  regime: string | null;
}

export interface Backtest {
  id: number;
  name: string;
  strategyId: string;
  from: string;
  to: string;
  status: string;
  error: string | null;
  createdAt: string;
  config: {
    capital: number;
    slippageBps: number;
    rebalance: string;
    numStocks: number;
    costs: { model: string; extraBps: number };
    capitalEvents: Array<{ date: string; amount: number }>;
  };
  metrics: Metrics | null;
  equity: Array<{ date: string; equity: number; invested: number }>;
  extra: {
    actualFrom: string;
    actualTo: string;
    timeline: Array<{
      date: string;
      regime: string;
      review: boolean;
      answer: string;
      positions: number;
      targetSize: number;
      equity: number;
      orders: number;
    }>;
    openPositions: Array<{ symbol: string; qty: number; avgPrice: number; lastPrice: number; unrealizedPnl: number; entryDate: string }>;
    rejected: Array<{ date: string; symbol: string; reason: string }>;
    exitBreakdown: Record<string, { count: number; pnl: number; avgHoldingDays: number }>;
    benchmark: number[];
  } | null;
  trades: BacktestTrade[];
}

export interface BacktestListItem {
  id: number;
  name: string;
  strategyId: string;
  from: string;
  to: string;
  status: string;
  createdAt: string;
  metrics: Metrics | null;
}

export interface WhatIfResponse extends ApiOk {
  requestedDate: string;
  asOf: string;
  verifiedNoLookahead: boolean;
  result: DecisionResult;
  strategy: { id: string; name: string };
  capital: number;
  hindsight: {
    note: string;
    through: string;
    invested: number;
    pnl: number;
    returnOnInvestedPct: number;
    returnOnCapitalPct: number;
    benchmarkReturnPct: number;
    followedSystem: {
      description: string;
      endCapital: number;
      totalReturnPct: number;
      maxDrawdownPct: number;
      trades: number;
      benchmarkReturnPct: number;
      openPositions: number;
    };
    buys: Array<{
      symbol: string;
      quantity: number;
      entry: number;
      forward: Record<string, { date: string; returnPct: number } | null>;
      stopHit: { date: string; price: number } | null;
      endPrice: number;
      pnl: number;
      returnPct: number;
    }>;
  };
}

export interface StrategySummary {
  id: string;
  name: string;
  description: string;
  preset: boolean;
  horizon: string;
  paramsHash: string;
}

export interface MomentumConfig extends ApiOk {
  settings: {
    strategyId: string;
    costs: { model: string; extraBps: number };
    slippageBps: number;
    paper: { fillWhenClosed: boolean; partialFillPct: number };
    live: { enabled: boolean; allowAmo: boolean; enabledAt: string | null };
  };
  risk: Record<string, number>;
  riskKeys: string[];
  strategy: { id: string; name: string };
  strategies: StrategySummary[];
  params: any;
  horizons: Record<string, { review: string; hint: string; expectedHolding: string }>;
}

export interface CompareRow {
  strategyId: string;
  name: string;
  horizon?: string;
  metrics?: Metrics;
  equity?: Array<{ date: string; equity: number }>;
  error?: string;
}

export interface ResearchRun {
  id: number;
  kind: 'OPTIMIZE' | 'WALK_FORWARD';
  status: string;
  progress: number;
  config: any;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  result: any;
}

export interface JobRun {
  id: number;
  job: string;
  periodKey: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  result: any;
}

export interface StockDetail extends ApiOk {
  symbol: string;
  name: string;
  sector: string;
  asOf: string;
  candles: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
  overlays: { emaFast: number[]; emaMid: number[]; emaSlow: number[]; emaLong: number[]; dates: string[] };
  score: { total: number; components: Record<string, any> };
  eligibility: { eligible: boolean; reasons: string[] };
  entry: {
    status: string;
    actionable: boolean;
    setup: string;
    headline: string;
    checks: Check[];
    waitFor: string[];
    invalidation: string[];
    risk: { entry: number; stop: number; stopType: string; riskPerShare: number; riskPct: number; target: number; targetType: string; rewardRisk: number };
    expectedHolding: string;
    confirmations: string[];
  };
  features: any;
  regime: string;
  holdings: any[];
  signals: Signal[];
}

export interface DecisionRunRow {
  id: number;
  portfolioId: number;
  asOf: string;
  kind: string;
  createdAt: string;
  answer: string;
  regime: string;
  summary: DecisionSummary;
  result?: DecisionResult;
}

export interface NarratorAnswer extends ApiOk {
  source: string;
  question: string;
  answer: string;
  evidence: string[];
}

export interface BrokerStatus extends ApiOk {
  broker: { configured: boolean; apiKey?: string; updatedAt?: string };
  liveEnabled: boolean;
  phrases: { live: string; auto: string };
}

export interface DeskScheduleSlot {
  date: string;
  weekday: string;
  time: string;
  when: string;
  instruction: string;
}

export interface DeskSchedule {
  horizon: string;
  scanTime: string;
  fillTime: string;
  lastCompletedBar: string;
  today: string;
  buy: DeskScheduleSlot;
  sell: DeskScheduleSlot;
  holdRule: string;
}

export interface DeskLastWeekPick {
  symbol: string;
  name: string;
  qty: number;
  priceRef: number;
  suggestedLimit?: number | null;
  date: string;
  action: string;
  reason: string;
}

export interface DeskHoldingsSync {
  ok: boolean;
  error?: string | null;
  preview?: boolean;
  imported?: string[];
  updated?: string[];
  removed?: string[];
  skipped?: Array<{ symbol: string; reason: string; qty?: number | null }>;
  cash?: number;
}

export interface DeskAlsoHeld {
  symbol: string;
  name?: string;
  qty: number | null;
  avgPrice: number | null;
  lastPrice: number | null;
  suggestedSell?: number | null;
  suggestedLimit?: number | null;
  fillHint?: string | null;
  reason: string;
  suggestion: string;
  note: string;
}

export interface DeskGuideStep {
  step: number;
  title: string;
  body: string;
  href?: string;
  done?: boolean;
}

export interface DeskOverview {
  status?: string;
  kind?: string;
  schedule: DeskSchedule;
  strategy: { id: string; name: string; horizon: string; description?: string | null };
  paperDefaults?: { capital: number; from: string | null; to: string | null; auto?: boolean };
  lastWeek: { week: string | null; picks: DeskLastWeekPick[] };
  liveEnabled: boolean;
  hasLive: boolean;
  hasPaper: boolean;
  tokenReady?: boolean;
  funds?: DeskFunds | null;
  guide?: DeskGuideStep[];
  lastScan?: DeskScan | null;
}

export interface DeskClosedTrade {
  symbol: string;
  qty: number;
  entryDate: string | null;
  entryTime: string;
  entryPrice: number | null;
  exitDate: string;
  exitTime: string;
  exitPrice: number;
  holdingDays: number | null;
  pnl: number | null;
  pnlPct: number | null;
  exitReason: string;
  trigger: string | null;
}

export interface DeskOpenTrade {
  symbol: string;
  qty: number;
  entryDate: string;
  entryTime: string;
  entryPrice: number;
  lastPrice: number;
  holdingDays: number | null;
  pnl: number | null;
  status: string;
}

export interface DeskPaperSummary {
  headline: string;
  bullets: string[];
  honestNote: string;
  started: number;
  ended: number | null;
  returnPct: number | null;
  winRatePct: number | null;
  maxDrawdownPct: number | null;
}

export interface DeskThisWeek {
  asOf: string;
  headline: string;
  answer: string;
  regime: string | null;
  buy: DeskActionRow[];
  hold: DeskActionRow[];
  sell: DeskActionRow[];
}

export interface DeskPaperReplay {
  status?: string;
  kind?: 'PAPER';
  from: string;
  to: string;
  autoRange?: boolean;
  capital: number;
  strategy: string;
  strategyName?: string;
  fillTime: string;
  scanTime: string;
  totalProfit: number;
  closedProfit: number;
  openProfit: number;
  metrics: Metrics | null;
  summary?: DeskPaperSummary;
  thisWeek?: DeskThisWeek | null;
  nextAction?: string;
  closed: DeskClosedTrade[];
  open: DeskOpenTrade[];
}

export interface DeskActionRow {
  symbol: string;
  name: string;
  sector: string;
  action: Action;
  qty: number;
  priceRef: number;
  lastPrice?: number | null;
  avgPrice?: number | null;
  stopPrice?: number | null;
  suggestedLimit?: number | null;
  suggestedBuy?: number | null;
  suggestedSell?: number | null;
  fillHint?: string | null;
  whyThisPrice?: string | null;
  allocationValue: number;
  reason: string;
  score: number | null;
  signalId: number | null;
  canExecute: boolean;
}

export interface DeskFunds {
  ok: boolean;
  error?: string | null;
  equityCash?: number | null;
  equityNet?: number | null;
  capitalRs?: number | null;
  source?: string | null;
}

export interface DeskProduct {
  kind: PortfolioMode;
  strategy: string;
  tokenReady: boolean;
  fundsReady: boolean;
  cash: number;
  sizedFrom?: 'kite-funds' | 'entered';
  nextAction: string;
  guide: DeskGuideStep[];
}

export interface DeskScan {
  status?: string;
  mode: PortfolioMode;
  usedPaperFallback: boolean;
  capital: number;
  sizedFrom?: 'kite-funds' | 'entered';
  funds?: DeskFunds | null;
  asOf: string;
  runId: number;
  answer: string;
  headline: string;
  schedule: DeskSchedule;
  lastWeek: { week: string | null; picks: DeskLastWeekPick[] };
  holdingsSync?: DeskHoldingsSync | null;
  alsoHeld?: DeskAlsoHeld[];
  product?: DeskProduct;
  nextAction?: string;
  buy: DeskActionRow[];
  hold: DeskActionRow[];
  sell: DeskActionRow[];
}

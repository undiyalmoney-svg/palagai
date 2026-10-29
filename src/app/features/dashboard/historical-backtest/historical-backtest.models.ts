export interface BacktestProgress {
  phase: string;
  done: number;
  total: number;
  symbol: string | null;
  batch?: number;
  batches?: number;
  batchSize?: number;
  cacheHits?: number;
}

export interface BacktestMark {
  t: string;
  px: number;
  mtmRs: number;
  label?: string;
}

export interface BacktestTrade {
  symbol: string;
  day: string;
  side: 'L' | 'S' | string;
  entryT: string;
  exitT: string;
  exitReason: string;
  entryPx: number;
  exitPx: number;
  stopPx?: number;
  tgtPx?: number;
  qty: number;
  grossRs: number;
  chargesRs: number;
  netRs: number;
  notionalRs: number;
  maxWentRs?: number;
  maxWentPx?: number;
  signalT?: string;
  riskRs?: number;
  promisedRs?: number;
  marks?: BacktestMark[];
}

export interface LiveMoneyFill {
  instrument: string;
  side: 'L' | 'S' | string;
  qty: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  signalT?: string | null;
}

export interface LiveMoneyStatus {
  enabled: boolean;
  liveOrders: boolean;
  date: string;
  crowd: string | null;
  capital: number;
  fundsRs: number;
  doneToday: boolean;
  takenToday?: string[];
  fills: LiveMoneyFill[];
  scan?: { phase: string; done: number; total: number; symbol: string | null };
  lastTick: string | null;
  lastError: string | null;
  lastMessage: string | null;
  sessionOk: boolean;
  dropletWatching?: boolean;
  dropletPlacing?: boolean;
  guaranteed: boolean;
}

export interface LiveMoneyResponse {
  status: string;
  liveOrders: boolean;
  money: LiveMoneyStatus;
  message?: string;
}

export interface PromisedLock {
  targetR: number;
  fundsRs: number;
  capitalRs: number;
  names: number;
  promisedRs: number;
  lockedRs: number;
  openRs: number;
  stoppedRs: number;
  actualRs: number;
  riskRs: number;
  liveOrders: boolean;
  guaranteed: boolean;
}

export interface BacktestStockRow {
  symbol: string;
  trades: number;
  wins: number;
  netRs: number;
  winRate: number;
  slHits?: number;
  maxWentRs?: number;
}

export interface BacktestCross {
  symbol: string;
  day: string;
  side: 'L' | 'S' | string;
  t: string;
  close: number;
  orh: number;
  orl: number;
  orWPct: number;
  volume?: number;
  qualified: boolean;
  taken: boolean;
}

export interface BacktestSnapshot {
  day: string;
  t: string;
  label: string;
  netRs: number;
  slHits: number;
  open: number;
  taken: number;
  maxWentRs: number;
}

export interface BacktestEodRow {
  day: string;
  netRs: number;
  trades: number;
  slHits: number;
  maxWentRs: number;
}

export interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  returnPct: number;
  maxDrawdown: number;
  capitalUtilized: number;
  capitalUtilizedPct: number;
  avgWin: number;
  avgLoss: number;
  equityCurve: Array<{ day: string; equity: number }>;
  stocks: BacktestStockRow[];
  days: number;
  orbCrossed?: number;
  orbCrossedTaken?: number;
  slHits?: number;
  eodExits?: number;
  maxWentRs?: number;
  snapshots?: BacktestSnapshot[];
  eod?: BacktestEodRow[];
}

export interface BacktestResult {
  simulated: boolean;
  liveOrders: boolean;
  config: {
    capital: number;
    maxStocksPerDay: number;
    family?: string;
    preset?: string;
    targetR?: number | null;
    orEnd?: string;
    entryStart?: string;
    entryEnd: string;
    timeExit: string;
    rankBy?: string;
    crowdFilter?: string | null;
    sizing?: string;
    pullbacksNeeded?: number;
    engineVersion?: string;
  };
  assumptions: string[];
  rawTrades: number;
  summary: BacktestSummary;
  trades: BacktestTrade[];
  crosses?: BacktestCross[];
  snapshots?: BacktestSnapshot[];
  dailyBooks?: DailyBook[];
  lastBook?: DailyBook | null;
  promised?: PromisedLock | null;
  family?: string;
  universe?: {
    requested: number;
    resolved: number;
    withBars: number;
    missing: string[];
    noCandles: string[];
  };
  range?: { from: string; to: string };
  warnings?: string[];
  note?: string;
}

export interface BacktestJob {
  status: string;
  id?: string;
  simulated?: boolean;
  liveOrders?: boolean;
  input?: {
    from?: string;
    to?: string;
    liveToday?: boolean;
    preset?: string;
    capital?: number;
    fundsRs?: number | null;
    targetR?: number | null;
    maxStocksPerDay?: number;
    rankBy?: string;
    crowdFilter?: string | null;
    entryEnd?: string;
    timeExit?: string;
  };
  progress?: BacktestProgress;
  error?: string | null;
  warnings?: string[];
  missing?: string[];
  result?: BacktestResult | null;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
  jobId?: string | null;
}

export interface DiscoverRules {
  entry: string;
  cutoff: string;
  exit: string;
  stopLoss: string;
  target: string;
  stockCount: string;
  sizing: string;
  filters?: string[];
}

export interface DiscoverStockRow {
  symbol: string;
  trades: number;
  netRs: number;
  wins?: number;
}

export interface DiscoverMetrics {
  trades: number;
  wins?: number;
  losses?: number;
  winRate?: number;
  netPnl: number;
  returnPct: number;
  maxDrawdown: number;
  profitFactor: number;
  expectancy: number;
  profitableDayPct?: number;
  profitableWeekPct: number;
  weeks?: number;
  sessionDays?: number;
  days?: number;
  capitalUtilized?: number;
  stockConcentration?: number;
  stocks?: DiscoverStockRow[];
  equityCurve?: Array<{ day: string; equity: number }>;
}

export interface DiscoverLeaderRow {
  rank: number;
  id: string;
  name: string;
  family?: string;
  isBaseline?: boolean;
  experimental?: boolean;
  rules?: DiscoverRules;
  entryRule?: string;
  cutoff?: string;
  exitRule?: string;
  stopLoss?: string;
  target?: string;
  stockCount?: number;
  sizing?: string;
  netPnl: number;
  returnPct: number;
  maxDrawdown: number;
  profitFactor: number;
  expectancy: number;
  trades: number;
  weeks?: number;
  profitableWeekPct: number;
  profitableDayPct?: number;
  capitalUtilized?: number;
  validationStatus: string;
  profitable: boolean;
  trainNet?: number;
  validationNet?: number;
  oosNet?: number;
  walkForwardNet?: number | null;
  fragile?: boolean;
}

export interface DiscoverDailyWinner {
  day: string;
  bestId: string | null;
  bestName: string;
  netPnl: number;
  trades: number;
  stocks: string[];
  entries: Array<{
    symbol: string;
    side: string;
    in: string;
    out: string;
    qty: number;
    netRs: number;
  }>;
  runnerUpId: string | null;
  runnerUpNet: number;
  gap: number;
  prospectiveId: string | null;
  prospectiveNet: number | null;
  selection: string;
  note: string;
}

export interface DiscoverWeeklyWinner {
  week: string;
  days: string[];
  bestId: string | null;
  bestName: string | null;
  netPnl: number;
  trades: number;
  winDays: number;
  loseDays: number;
  noTradeDays: number;
  bestDay: { day: string; netRs: number } | null;
  worstDay: { day: string; netRs: number } | null;
  stocks: DiscoverStockRow[];
  runnerUpId: string | null;
  gap: number;
  recommendedId?: string | null;
  selection: string;
  note: string;
  perCandidate: Array<{
    id: string;
    name: string;
    netPnl: number;
    trades: number;
    isBaseline?: boolean;
  }>;
}

export interface DiscoverCoverage {
  requested: number;
  resolved: number;
  withBars: number;
  cacheHits?: number;
  missing: string[];
  noCandles: string[];
  from?: string;
  to?: string;
  complete?: boolean;
}

export interface DiscoverRecommended {
  id: string;
  name: string;
  family?: string;
  rules: DiscoverRules;
  config?: Record<string, unknown>;
  oos: DiscoverMetrics;
  validation?: DiscoverMetrics;
  train?: DiscoverMetrics;
  why?: string[];
  risks?: string[];
  trades?: BacktestTrade[];
  stocks?: DiscoverStockRow[];
  equityCurve?: Array<{ day: string; equity: number }>;
  summary?: BacktestSummary;
}

export interface DiscoverLabPoint {
  id: string;
  value: unknown;
  netPnl: number;
  maxDrawdown: number;
  trades: number;
  profitableWeekPct: number;
  isBaseline?: boolean;
}

export interface DiscoverResult {
  simulated: boolean;
  liveOrders: boolean;
  engineVersion?: string;
  capital: number;
  days?: string[];
  split?: {
    mode: string;
    note?: string;
    train?: string[];
    validation?: string[];
    oos?: string[];
  };
  coverage?: DiscoverCoverage | null;
  candidatesEvaluated: number;
  minTrades?: number;
  noRobust: string | null;
  recommended: DiscoverRecommended | null;
  rankings?: Record<string, string | null>;
  leaderboard: DiscoverLeaderRow[];
  dailyWinners: DiscoverDailyWinner[];
  weeklyWinners: DiscoverWeeklyWinner[];
  cutoffLab?: Array<{ axis: string; label: string; points: DiscoverLabPoint[] }>;
  capitalSensitivity?: Array<{
    capital: number;
    netPnl: number;
    returnPct: number;
    maxDrawdown: number;
    trades: number;
    capitalUtilized: number;
  }>;
  costSensitivity?: Array<{
    slippage: number;
    netPnl: number;
    trades: number;
    maxDrawdown: number;
  }>;
  baseline?: { id: string; metrics: DiscoverMetrics };
  walkForwardFolds?: number;
  assumptions?: string[];
  warnings?: string[];
  note?: string;
}

export interface DiscoverJob {
  status: string;
  id?: string;
  simulated?: boolean;
  liveOrders?: boolean;
  progress?: BacktestProgress;
  error?: string | null;
  coverage?: DiscoverCoverage | null;
  warnings?: string[];
  result?: DiscoverResult | null;
  engineVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  input?: { from: string; to: string; capital: number; budget: number };
  message?: string;
  jobId?: string | null;
}

export interface DiscoverSpace {
  status?: string;
  liveOrders: boolean;
  count: number;
  baselineId?: string;
  candidates: Array<{
    id: string;
    name: string;
    family: string;
    isBaseline: boolean;
    experimental: boolean;
    rules: DiscoverRules;
  }>;
}

export interface DiscoverExperimentRow {
  id: string;
  status: string;
  input?: { from?: string; to?: string; capital?: number; budget?: number };
  engineVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  error?: string | null;
  simulated?: boolean;
  liveOrders?: boolean;
}

export interface DiscoverCandidateDetail {
  simulated: boolean;
  liveOrders: boolean;
  candidate: DiscoverLeaderRow;
  trades: BacktestTrade[];
}

export interface DailyBookStock {
  symbol: string;
  side: string;
  reason?: string;
  entryT: string;
  exitT: string;
  exitReason: string;
  entryPx: number;
  stopPx?: number;
  tgtPx?: number;
  qty: number;
  allocatedRs: number;
  netRs: number;
  chargesRs: number;
  riskRs?: number;
  promisedRs?: number;
}

export interface DailyBook {
  day: string;
  capital: number;
  stocks: DailyBookStock[];
  trades: number;
  winners: number;
  losers: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  allocatedRs: number;
  note?: string;
}

export interface DailyProfitResult {
  simulated: boolean;
  liveOrders: boolean;
  capital: number;
  days?: string[];
  split?: { train: string[]; validation: string[]; oos: string[]; mode: string; note: string };
  coverage?: DiscoverCoverage;
  candidatesEvaluated: number;
  minTrades?: number;
  noRobust?: string | null;
  recommended?: (DiscoverRecommended & { dailyBooks?: DailyBook[]; lastBook?: DailyBook | null }) | null;
  lastBook?: DailyBook | null;
  dailyBooks?: DailyBook[];
  rankings?: DiscoverResult['rankings'];
  leaderboard: DiscoverLeaderRow[];
  weekly?: Array<{ week: string; days: string[]; netPnl: number; trades: number; winDays: number; loseDays: number }>;
  assumptions?: string[];
  warnings?: string[];
  note?: string;
  engineVersion?: string;
}

export interface DailyProfitJob {
  status: string;
  id?: string;
  simulated?: boolean;
  liveOrders?: boolean;
  kind?: string;
  progress?: BacktestProgress;
  error?: string | null;
  coverage?: DiscoverCoverage | null;
  warnings?: string[];
  result?: DailyProfitResult | null;
  engineVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  input?: { from: string; to: string; capital: number; budget: number };
}

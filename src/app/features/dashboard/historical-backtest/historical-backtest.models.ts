export interface BacktestProgress {
  phase: string;
  done: number;
  total: number;
  symbol: string | null;
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
  marks?: BacktestMark[];
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
    targetR?: number;
    orEnd: string;
    entryStart?: string;
    entryEnd: string;
    timeExit: string;
  };
  assumptions: string[];
  rawTrades: number;
  summary: BacktestSummary;
  trades: BacktestTrade[];
  crosses?: BacktestCross[];
  snapshots?: BacktestSnapshot[];
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

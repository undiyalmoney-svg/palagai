export interface ResearchConfig {
  startingCapital: number;
  riskPerTrade: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  maxDailyLoss: number;
  maxNotionalPct: number;
  minRewardRisk: number;
  slippageBps: number;
  quoteStaleMs: number;
  openingRangeMinutes: number;
  experimentWeeks: number;
}

export interface ResearchAccount {
  accountId: string;
  strategyId: string;
  strategyVersion: number;
  initialCapital: number;
  cashBalance: number;
  realizedPnl: number;
  currentEquity: number;
  startOfDayEquity: number;
  unrealizedPnl: number;
  openPositions: number;
}

export interface ResearchFeed {
  configured: boolean;
  connected: boolean;
  stale: boolean;
  lastTickAt: string | null;
  mode: string;
  message: string;
}

export interface ResearchStatus {
  experiment: {
    experimentId: string;
    name: string;
    status: string;
    startedAt: string | null;
    plannedEndAt: string | null;
    tradingDays: number;
    configuration: ResearchConfig;
  };
  accounts: ResearchAccount[];
  combined: {
    equity: number;
    cash: number;
    realized: number;
    unrealized: number;
    netPnl: number;
    note: string;
  };
  feed: ResearchFeed;
  paperOnly: boolean;
  dataMode: string;
  disclaimer: string;
}

export interface ReadinessCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface ResearchStrategy {
  strategyId: string;
  name: string;
  version: number;
  enabled: boolean;
  parameters: Record<string, number>;
  parentVersion: number | null;
  optimizationNotes: string | null;
}

export interface ResearchCandidate {
  signalId: string;
  strategyId: string;
  symbol: string;
  direction: string;
  referencePrice: number;
  stopPrice: number;
  targetPrice: number;
  rankingScore: number;
  accepted: boolean;
  rejectionReason: string | null;
  metadata?: { reason?: string; source?: string };
}

export interface ResearchPosition {
  tradeId: string;
  strategyId: string;
  symbol: string;
  direction: string;
  quantity: number;
  actualSimulatedEntryPrice: number;
  lastPrice: number | null;
  stopPrice: number;
  targetPrice: number;
  status: string;
}

export interface ResearchTrade {
  tradeId: string;
  tradingDate: string;
  strategyId: string;
  symbol: string;
  direction: string;
  quantity: number;
  entryTime: string;
  actualSimulatedEntryPrice: number;
  exitTime: string | null;
  actualSimulatedExitPrice: number | null;
  exitReason: string | null;
  grossPnl: number | null;
  fees: number | null;
  slippage: number | null;
  netPnl: number | null;
  status: string;
}

export interface StrategyStats {
  strategyId?: string;
  initialCapital: number;
  currentEquity: number;
  netPnl: number;
  returnPct: number | null;
  closed: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  avgHoldingMs: number | null;
  fees: number;
  equityCurveSource: string;
}

export interface ResearchSummary {
  byStrategy: Record<string, StrategyStats>;
  overall: StrategyStats;
  formulas: Record<string, string>;
  disclaimer: string;
}

export interface WeeklyRow {
  week: string;
  netPnl: number;
  trades: number;
  maxDrawdown: number;
}

export interface SystemEvent {
  timestamp: string;
  severity: string;
  eventType: string;
  message: string;
}

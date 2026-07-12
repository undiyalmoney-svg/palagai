export interface ModuleCheck {
  name: string;
  passed: boolean;
  reason: string;
  value?: string | number | boolean;
}

export interface ModuleResult {
  passed: boolean;
  confidence: number;
  reason: string;
  checks: ModuleCheck[];
  metadata?: Record<string, unknown>;
}

export type SignalAction =
  | 'BUY'
  | 'SELL'
  | 'WAIT'
  | 'WAITING'
  | 'SKIPPED'
  | 'NO_TRADE'
  | 'STRONG_BUY'
  | 'WEAK_BUY'
  | 'STRONG_SELL'
  | 'WEAK_SELL';

export type MarketBias = 'bullish' | 'bearish' | 'sideways';

export type TimelinePhase = 'Trend' | 'Structure' | 'Pullback' | 'Entry' | 'Trade' | 'Exit';
export type TradeStatusLabel = 'Waiting' | 'Open' | 'Closed';

export interface EntryResult extends ModuleResult {
  action: SignalAction;
  entryPrice: number;
}

export interface StopLossResult {
  stopLoss: number;
  reason: string;
}

export interface TargetResult {
  targetPrice: number;
  riskRewardRatio: number;
  reason: string;
}

export interface ExitResult {
  shouldExit: boolean;
  exitPrice: number;
  exitReason: string;
  outcome: 'WIN' | 'LOSS';
}

export interface StrategySignal {
  strategyId: string;
  strategyName: string;
  signalType: SignalAction;
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  riskRewardRatio: number;
  trend: ModuleResult;
  structure: ModuleResult;
  pullback: ModuleResult;
  entry: EntryResult;
  volume: ModuleResult;
  momentum: ModuleResult;
  allConditionsMet: boolean;
  timelinePhase: TimelinePhase;
  reasons: string[];
  analysis: Record<string, unknown>;
}

export interface TradeExecutionSnapshot {
  strategyId: string;
  strategyName: string;
  signal: StrategySignal;
  tradeStatus: TradeStatusLabel;
  currentProfitLoss: number;
  exitReason: string;
  tradeOpen: boolean;
  tradeJustOpened?: boolean;
  tradeJustClosed?: boolean;
  closedTrade?: import('../../models/historical-test.model').HistoricalTrade;
}

export function isLongSignal(type: SignalAction): boolean {
  return type === 'BUY' || type === 'STRONG_BUY' || type === 'WEAK_BUY';
}

export function isShortSignal(type: SignalAction): boolean {
  return type === 'SELL' || type === 'STRONG_SELL' || type === 'WEAK_SELL';
}

export function isTradeableSignal(type: SignalAction): boolean {
  return isLongSignal(type) || isShortSignal(type);
}

export function emptyModule(reason: string): ModuleResult {
  return { passed: false, confidence: 0, reason, checks: [] };
}

export function moduleFromCheck(name: string, passed: boolean, reason: string): ModuleResult {
  return {
    passed,
    confidence: passed ? 80 : 0,
    reason,
    checks: [{ name, passed, reason }],
  };
}

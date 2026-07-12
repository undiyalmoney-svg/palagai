import { HistoricalTrade } from '../../../models/historical-test.model';
import { RESEARCH_STRATEGY_IDS } from '../../interfaces/research-strategy.interface';

export type ResearchStrategyId =
  | typeof RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT
  | typeof RESEARCH_STRATEGY_IDS.MTF_PULLBACK
  | typeof RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT;

export type ModuleKey =
  | 'trend'
  | 'structure'
  | 'pullback'
  | 'breakout'
  | 'retest'
  | 'confirmation'
  | 'entry';

export type WaitingState =
  | 'None'
  | 'Waiting for Breakout'
  | 'Waiting for Pullback'
  | 'Waiting for Retest'
  | 'Waiting for Confirmation'
  | 'Waiting for Entry Trigger';

export interface DebugRuleCheck {
  name: string;
  passed: boolean;
  reason: string;
  expected?: string;
  actual?: string;
}

export interface TrendModuleDebug {
  passed: boolean;
  detectedTrend: 'Bullish' | 'Bearish' | 'Sideways';
  requiredCondition: string;
  actualResult: string;
  reason: string;
  latestSwingHighs: number[];
  latestSwingLows: number[];
  higherHighCount: number;
  higherLowCount: number;
  lowerHighCount: number;
  lowerLowCount: number;
  checks: DebugRuleCheck[];
}

export interface StructureModuleDebug {
  passed: boolean;
  reason: string;
  support: number | null;
  resistance: number | null;
  swingHighs: number[];
  swingLows: number[];
  trendline: string | null;
  breakoutLevel: number | null;
  retestLevel: number | null;
  distanceFromSupport: number | null;
  distanceFromResistance: number | null;
  expectedCondition: string;
  actualCondition: string;
  checks: DebugRuleCheck[];
}

export interface EntryModuleDebug {
  passed: boolean;
  reason: string;
  entryTrigger: 'REACHED' | 'NOT REACHED';
  checks: DebugRuleCheck[];
}

export interface Strategy2AuditDetail {
  trend60: 'Bullish' | 'Bearish' | 'Sideways';
  trend60SwingHighs: number[];
  trend60SwingLows: number[];
  trend30: 'BUY' | 'SELL' | 'NEUTRAL';
  trend30Reason: string;
  trend30Current: { high: number; low: number; close: number } | null;
  trend30Previous: { high: number; low: number; close: number } | null;
  support30: number | null;
  resistance30: number | null;
  pullbackLevel: number | null;
  pullbackSide: 'support' | 'resistance' | null;
  pullbackWindow: {
    date: string;
    low: number;
    high: number;
    touchesLevel: boolean;
    distancePct: number;
  }[];
  pullbackDetected: boolean;
  confirmation5m: {
    isBullish: boolean;
    isBearish: boolean;
    bodySize: number;
    prevBodySize: number;
    passed: boolean;
  } | null;
  riskRewardRatio: number | null;
  evaluatorAction: 'BUY' | 'SELL' | 'NO_TRADE';
  evaluatorReason: string;
  debugMatchesEvaluator: boolean;
  mismatchNote: string | null;
}

export interface Strategy3AuditDetail {
  formingHourCandle: { date: string; open: number; high: number; low: number; close: number } | null;
  previousCompletedHourCandle: { date: string; open: number; high: number; low: number; close: number } | null;
  usesCompletedHourVerified: boolean;
  hourBarIndexNote: string;
  previous5Close: number | null;
  current5Close: number;
  hourHigh: number | null;
  hourLow: number | null;
  bullishBreakoutCloseCondition: boolean;
  bearishBreakoutCloseCondition: boolean;
  highCrossedHourHigh: boolean;
  lowCrossedHourLow: boolean;
  storedBreakoutCandle: { date: string; open: number; high: number; low: number; close: number } | null;
  pendingDirection: 'BUY' | 'SELL' | null;
  followThroughBuy: boolean;
  followThroughSell: boolean;
  followThroughLevel: number | null;
  evaluatorPhase:
    | 'no_hour_reference'
    | 'waiting_range_break'
    | 'breakout_stored_buy'
    | 'breakout_stored_sell'
    | 'waiting_follow_through_buy'
    | 'waiting_follow_through_sell'
    | 'entry_buy'
    | 'entry_sell'
    | 'rr_rejected';
  exactBlockReason: string;
  evaluatorAction: 'BUY' | 'SELL' | 'NO_TRADE';
  evaluatorReason: string;
}

export interface ImplementationAuditIssue {
  strategyId: ResearchStrategyId;
  strategyName: string;
  rule: string;
  severity: 'warning' | 'info';
  message: string;
  neverTrueInBacktest: boolean;
  passCount: number;
  totalCandles: number;
}

export interface Strategy3HourDebug {
  previousHourCandle: { open: number; high: number; low: number; close: number; date: string } | null;
  current5mCandle: { open: number; high: number; low: number; close: number; date: string };
  highCrossedPreviousHourHigh: boolean;
  lowCrossedPreviousHourLow: boolean;
  breakoutDetected: boolean;
  waitingForNextCandle: boolean;
  entryTriggerHit: boolean;
}

export interface CandleDebugRecord {
  timestamp: string;
  tradingDate: string;
  strategyId: ResearchStrategyId;
  strategyName: string;
  trend: TrendModuleDebug;
  structure: StructureModuleDebug;
  pullback: { passed: boolean; reason: string; checks: DebugRuleCheck[] };
  breakout: { passed: boolean; reason: string; checks: DebugRuleCheck[] };
  retest: { passed: boolean; reason: string; checks: DebugRuleCheck[] };
  confirmation: { passed: boolean; reason: string; checks: DebugRuleCheck[] };
  entry: EntryModuleDebug;
  waitingState: WaitingState;
  finalDecision: 'BUY' | 'SELL' | 'NO_TRADE';
  rejectionReason: string;
  blockingModule: ModuleKey | null;
  strategy2Audit?: Strategy2AuditDetail;
  strategy3Details?: Strategy3HourDebug;
  strategy3Audit?: Strategy3AuditDetail;
  tradeDetails: {
    entry: number | null;
    stopLoss: number | null;
    target: number | null;
    riskReward: number | null;
    profitLoss: number | null;
  };
  openTradeActive: boolean;
}

export interface DailyDebugSummary {
  date: string;
  displayDate: string;
  strategyId: ResearchStrategyId;
  strategyName: string;
  trend: 'PASS' | 'FAIL';
  structure: 'PASS' | 'FAIL';
  pullback: 'PASS' | 'FAIL';
  breakout: 'PASS' | 'FAIL';
  retest: 'PASS' | 'FAIL';
  confirmation: 'PASS' | 'FAIL';
  entry: 'PASS' | 'FAIL';
  finalDecision: 'BUY' | 'SELL' | 'NO_TRADE';
  reason: string;
  waitingState: WaitingState;
  signalsGenerated: number;
  tradesTaken: number;
}

export interface RuleFailureCounts {
  trendFailed: number;
  structureFailed: number;
  pullbackFailed: number;
  breakoutFailed: number;
  retestFailed: number;
  confirmationFailed: number;
  entryFailed: number;
}

export interface RuleStatistics {
  trendPassed: number;
  trendFailed: number;
  structurePassed: number;
  structureFailed: number;
  pullbackPassed: number;
  pullbackFailed: number;
  breakoutPassed: number;
  breakoutFailed: number;
  retestPassed: number;
  retestFailed: number;
  confirmationPassed: number;
  confirmationFailed: number;
  entryPassed: number;
  entryFailed: number;
  totalCandles: number;
}

export interface RuleBottleneck {
  ruleName: string;
  module: ModuleKey;
  rejectionCount: number;
  rejectionPercent: number;
  rank: number;
}

export interface StrategyDebugSummary {
  strategyId: ResearchStrategyId;
  strategyName: string;
  failureCounts: RuleFailureCounts;
  statistics: RuleStatistics;
  bottlenecks: RuleBottleneck[];
  trades: HistoricalTrade[];
  performance: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    grossProfit: number;
    grossLoss: number;
    netProfit: number;
    profitFactor: number;
    maxDrawdown: number;
    averageWin: number;
    averageLoss: number;
    averageHoldingMinutes: number;
  };
}

export interface StrategyResearchDebugRun {
  id: string;
  createdAt: string;
  instrumentToken: number;
  instrumentSymbol: string;
  fromDateTime: string;
  toDateTime: string;
  durationMs: number;
  candleRecords: CandleDebugRecord[];
  dailySummaries: DailyDebugSummary[];
  strategySummaries: StrategyDebugSummary[];
  tradingDays: string[];
  implementationAudit: ImplementationAuditIssue[];
}

export interface StrategyResearchDebugConfig {
  instrumentToken: number;
  instrumentSymbol: string;
  fromDateTime: string;
  toDateTime: string;
}

export const STRATEGY_DEBUG_META: Record<
  ResearchStrategyId,
  { name: string; shortName: string }
> = {
  [RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT]: {
    name: 'Strategy 1 — Trendline Breakout + Retest',
    shortName: 'Trendline Breakout',
  },
  [RESEARCH_STRATEGY_IDS.MTF_PULLBACK]: {
    name: 'Strategy 2 — Multi Timeframe Pullback',
    shortName: 'Multi Timeframe Pullback',
  },
  [RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT]: {
    name: 'Strategy 3 — 1 Hour Breakout',
    shortName: '1 Hour Breakout',
  },
};

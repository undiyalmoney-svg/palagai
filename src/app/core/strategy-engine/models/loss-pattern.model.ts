import { TradeDirection, TradeOutcome } from '../../models/historical-test.model';

export type TradingSession = 'Morning' | 'Mid Session' | 'Afternoon';
export type TimeframeTrendLabel = 'Bullish' | 'Bearish' | 'Sideways';
export type ExitMethod =
  | 'Target'
  | 'Stop Loss'
  | 'Early Exit'
  | 'Momentum Exit'
  | 'Manual Exit'
  | 'Time Exit';

export type LossReason =
  | 'Late Entry'
  | 'Weak Momentum'
  | 'Sideways Market'
  | 'Counter Trend'
  | 'Near Resistance'
  | 'Near Support'
  | 'Poor Candle'
  | 'Large Entry Candle'
  | 'Momentum Collapse'
  | 'Higher Timeframe Conflict'
  | 'Trade After Consecutive Loss'
  | 'Middle Session Trade'
  | 'Duplicate Entry'
  | 'Trend Exhaustion'
  | 'Long Holding Time'
  | 'Structure Failure'
  | 'UNKNOWN';

export interface TradeDiagnosticRecord {
  tradeId: string;
  tradeNumber: number;
  tradeDate: string;
  dayOfWeek: string;
  entryTime: string;
  exitTime: string;
  holdingMinutes: number;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  target: number;
  risk: number;
  reward: number;
  profitLoss: number;
  points: number;
  tradeResult: TradeOutcome;

  momentumAtEntry: number;
  momentumAtExit: number;
  highestMomentum: number;
  lowestMomentum: number;
  momentumWeakened: boolean;
  momentumWeakenPath: string[];

  higherHighCount: number;
  higherLowCount: number;
  lowerHighCount: number;
  lowerLowCount: number;
  marketTrending: boolean;
  marketSideways: boolean;
  marketReversal: boolean;

  trend30m: TimeframeTrendLabel;
  trend60m: TimeframeTrendLabel;
  trend30mAgrees: boolean;
  trend60mAgrees: boolean;

  entryCandleBody: number;
  entryCandleUpperWick: number;
  entryCandleLowerWick: number;
  entryCandleRange: number;
  entryCandleClosePosition: 'Top' | 'Middle' | 'Bottom';
  entryCandleLargerThanAvg: boolean;
  entryCandleExtremelyLarge: boolean;

  distanceFromSwingHigh: number | null;
  distanceFromSwingLow: number | null;
  distanceFromResistance: number | null;
  distanceFromSupport: number | null;
  enteredAfterLargeMove: boolean;

  sidewaysScore: number;
  priceCompression: boolean;
  overlapZone: boolean;
  failedBreakouts: boolean;
  flatStructure: boolean;
  smallBodyCluster: boolean;

  tradeNumberOfDay: number;
  tradeNumberOfDayLabel: string;
  consecutiveBuy: number;
  consecutiveSell: number;
  previousTradeResult: TradeOutcome | null;
  twoConsecutiveLossesBefore: boolean;

  tradingSession: TradingSession;
  exitMethod: ExitMethod;
  momentumDisappearedBeforeStopLoss: boolean;

  lossReasons: LossReason[];
  lossScore: number;
}

export interface LossReasonFrequency {
  reason: LossReason;
  count: number;
  percentage: number;
}

export interface PatternMilestoneReport {
  tradeCount: number;
  topLossReasons: LossReasonFrequency[];
}

export interface StatisticalReport {
  winRate: number;
  lossRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  averageHoldingMinutes: number;
  bestTradingSession: TradingSession | null;
  worstTradingSession: TradingSession | null;
  bestDay: string | null;
  worstDay: string | null;
  bestMomentumScore: number | null;
  worstMomentumScore: number | null;
  bestHoldingMinutes: number | null;
  worstHoldingMinutes: number | null;
  bestTradeNumber: number | null;
  worstTradeNumber: number | null;
  mostProfitableDirection: TradeDirection | null;
}

export interface AiInsight {
  observation: string;
  recommendation: string;
}

export interface LossPatternAnalysis {
  testId: string;
  strategyId: string;
  strategyName: string;
  totalTradesAnalyzed: number;
  tradeRecords: TradeDiagnosticRecord[];
  patternReports: PatternMilestoneReport[];
  statisticalReport: StatisticalReport;
  aiInsights: AiInsight[];
  generatedAt: string;
}

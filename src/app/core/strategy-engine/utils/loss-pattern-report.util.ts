import {
  AiInsight,
  LossPatternAnalysis,
  LossReason,
  LossReasonFrequency,
  PatternMilestoneReport,
  StatisticalReport,
  TradeDiagnosticRecord,
  TradingSession,
} from '../models/loss-pattern.model';
import { HistoricalTrade, TradeDirection } from '../../models/historical-test.model';

const PATTERN_MILESTONE = 100;
const TOP_REASONS_COUNT = 20;

export function generateLossPatternAnalysis(params: {
  testId: string;
  strategyId: string;
  strategyName: string;
  records: TradeDiagnosticRecord[];
}): LossPatternAnalysis {
  const patternReports = buildPatternMilestones(params.records);
  const statisticalReport = buildStatisticalReport(params.records);
  const aiInsights = buildAiInsights(params.records);

  return {
    testId: params.testId,
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    totalTradesAnalyzed: params.records.length,
    tradeRecords: params.records,
    patternReports,
    statisticalReport,
    aiInsights,
    generatedAt: new Date().toISOString(),
  };
}

function buildPatternMilestones(records: TradeDiagnosticRecord[]): PatternMilestoneReport[] {
  const reports: PatternMilestoneReport[] = [];

  for (let i = PATTERN_MILESTONE; i <= records.length; i += PATTERN_MILESTONE) {
    const slice = records.slice(0, i);
    const losing = slice.filter((r) => r.tradeResult === 'LOSS');
    reports.push({
      tradeCount: i,
      topLossReasons: topLossReasons(losing, TOP_REASONS_COUNT),
    });
  }

  if (records.length > 0 && records.length % PATTERN_MILESTONE !== 0) {
    const losing = records.filter((r) => r.tradeResult === 'LOSS');
    reports.push({
      tradeCount: records.length,
      topLossReasons: topLossReasons(losing, TOP_REASONS_COUNT),
    });
  }

  return reports;
}

function topLossReasons(
  losingRecords: TradeDiagnosticRecord[],
  limit: number,
): LossReasonFrequency[] {
  const counts = new Map<LossReason, number>();

  for (const record of losingRecords) {
    for (const reason of record.lossReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  const total = losingRecords.length || 1;
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function buildStatisticalReport(records: TradeDiagnosticRecord[]): StatisticalReport {
  const wins = records.filter((r) => r.tradeResult === 'WIN');
  const losses = records.filter((r) => r.tradeResult === 'LOSS');
  const grossProfit = wins.reduce((sum, r) => sum + r.points, 0);
  const grossLoss = Math.abs(losses.reduce((sum, r) => sum + r.points, 0));

  const sessionStats = sessionPerformance(records);
  const dayStats = dayPerformance(records);
  const momentumStats = momentumPerformance(records);
  const holdingStats = holdingPerformance(records);
  const tradeNumberStats = tradeNumberPerformance(records);
  const directionStats = directionPerformance(records);

  return {
    winRate: records.length ? (wins.length / records.length) * 100 : 0,
    lossRate: records.length ? (losses.length / records.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    averageWin: wins.length ? grossProfit / wins.length : 0,
    averageLoss: losses.length ? -grossLoss / losses.length : 0,
    averageHoldingMinutes: records.length
      ? records.reduce((sum, r) => sum + r.holdingMinutes, 0) / records.length
      : 0,
    bestTradingSession: sessionStats.best,
    worstTradingSession: sessionStats.worst,
    bestDay: dayStats.best,
    worstDay: dayStats.worst,
    bestMomentumScore: momentumStats.best,
    worstMomentumScore: momentumStats.worst,
    bestHoldingMinutes: holdingStats.best,
    worstHoldingMinutes: holdingStats.worst,
    bestTradeNumber: tradeNumberStats.best,
    worstTradeNumber: tradeNumberStats.worst,
    mostProfitableDirection: directionStats.best,
  };
}

function sessionPerformance(records: TradeDiagnosticRecord[]): {
  best: TradingSession | null;
  worst: TradingSession | null;
} {
  const sessions: TradingSession[] = ['Morning', 'Mid Session', 'Afternoon'];
  const totals = sessions.map((session) => ({
    session,
    points: records.filter((r) => r.tradingSession === session).reduce((sum, r) => sum + r.points, 0),
  }));
  if (!totals.length) {
    return { best: null, worst: null };
  }
  totals.sort((a, b) => b.points - a.points);
  return { best: totals[0]!.session, worst: totals.at(-1)!.session };
}

function dayPerformance(records: TradeDiagnosticRecord[]): { best: string | null; worst: string | null } {
  const byDay = new Map<string, number>();
  for (const record of records) {
    byDay.set(record.dayOfWeek, (byDay.get(record.dayOfWeek) ?? 0) + record.points);
  }
  const sorted = [...byDay.entries()].sort((a, b) => b[1] - a[1]);
  return {
    best: sorted[0]?.[0] ?? null,
    worst: sorted.at(-1)?.[0] ?? null,
  };
}

function momentumPerformance(records: TradeDiagnosticRecord[]): {
  best: number | null;
  worst: number | null;
} {
  if (!records.length) {
    return { best: null, worst: null };
  }
  const byScore = new Map<number, number>();
  for (const record of records) {
    byScore.set(record.momentumAtEntry, (byScore.get(record.momentumAtEntry) ?? 0) + record.points);
  }
  const sorted = [...byScore.entries()].sort((a, b) => b[1] - a[1]);
  return { best: sorted[0]?.[0] ?? null, worst: sorted.at(-1)?.[0] ?? null };
}

function holdingPerformance(records: TradeDiagnosticRecord[]): {
  best: number | null;
  worst: number | null;
} {
  if (!records.length) {
    return { best: null, worst: null };
  }
  const sorted = [...records].sort((a, b) => b.points - a.points);
  return {
    best: sorted[0]?.holdingMinutes ?? null,
    worst: sorted.at(-1)?.holdingMinutes ?? null,
  };
}

function tradeNumberPerformance(records: TradeDiagnosticRecord[]): {
  best: number | null;
  worst: number | null;
} {
  if (!records.length) {
    return { best: null, worst: null };
  }
  const byNumber = new Map<number, number>();
  for (const record of records) {
    byNumber.set(
      record.tradeNumberOfDay,
      (byNumber.get(record.tradeNumberOfDay) ?? 0) + record.points,
    );
  }
  const sorted = [...byNumber.entries()].sort((a, b) => b[1] - a[1]);
  return { best: sorted[0]?.[0] ?? null, worst: sorted.at(-1)?.[0] ?? null };
}

function directionPerformance(records: TradeDiagnosticRecord[]): {
  best: TradeDirection | null;
} {
  const buyPoints = records.filter((r) => r.direction === 'BUY').reduce((sum, r) => sum + r.points, 0);
  const sellPoints = records.filter((r) => r.direction === 'SELL').reduce((sum, r) => sum + r.points, 0);
  if (buyPoints === sellPoints) {
    return { best: null };
  }
  return { best: buyPoints > sellPoints ? 'BUY' : 'SELL' };
}

function buildAiInsights(records: TradeDiagnosticRecord[]): AiInsight[] {
  const insights: AiInsight[] = [];
  const losing = records.filter((r) => r.tradeResult === 'LOSS');
  if (!losing.length) {
    return insights;
  }

  const sidewaysLosses = losing.filter((r) => r.lossReasons.includes('Sideways Market')).length;
  const sidewaysPct = (sidewaysLosses / losing.length) * 100;
  if (sidewaysPct >= 20) {
    insights.push({
      observation: `Most losing trades (${sidewaysPct.toFixed(0)}%) occur during Sideways markets.`,
      recommendation: 'Improve Sideways Filter.',
    });
  }

  const thirdTradeLosses = losing.filter((r) => r.tradeNumberOfDay >= 3).length;
  const thirdPct = (thirdTradeLosses / losing.length) * 100;
  if (thirdPct >= 15) {
    insights.push({
      observation: `Most losing trades (${thirdPct.toFixed(0)}%) occur after the third trade of the day.`,
      recommendation: 'Limit daily trades to two.',
    });
  }

  const buyLosses60mBear = losing.filter(
    (r) => r.direction === 'BUY' && r.trend60m === 'Bearish',
  ).length;
  const buyLossPct = (buyLosses60mBear / losing.length) * 100;
  if (buyLossPct >= 15) {
    insights.push({
      observation: `Most losing BUY trades (${buyLossPct.toFixed(0)}%) occur when the 60-minute trend is bearish.`,
      recommendation: 'Require 60-minute trend confirmation.',
    });
  }

  const midSessionLosses = losing.filter((r) => r.tradingSession === 'Mid Session').length;
  const midPct = (midSessionLosses / losing.length) * 100;
  if (midPct >= 20) {
    insights.push({
      observation: `Most losses (${midPct.toFixed(0)}%) occur during 10:30–13:00.`,
      recommendation: 'Avoid trading during this session unless Momentum Score equals 5.',
    });
  }

  const weakMomentumLosses = losing.filter((r) => r.lossReasons.includes('Weak Momentum')).length;
  const weakPct = (weakMomentumLosses / losing.length) * 100;
  if (weakPct >= 20) {
    insights.push({
      observation: `Weak momentum at entry appears in ${weakPct.toFixed(0)}% of losing trades.`,
      recommendation: 'Require minimum momentum score of 4 before entry.',
    });
  }

  const htfConflict = losing.filter((r) =>
    r.lossReasons.includes('Higher Timeframe Conflict'),
  ).length;
  const htfPct = (htfConflict / losing.length) * 100;
  if (htfPct >= 15) {
    insights.push({
      observation: `${htfPct.toFixed(0)}% of losses show higher-timeframe conflict.`,
      recommendation: 'Add 30m/60m trend alignment as a filter condition.',
    });
  }

  const consecutiveLoss = losing.filter((r) =>
    r.lossReasons.includes('Trade After Consecutive Loss'),
  ).length;
  const consecPct = (consecutiveLoss / losing.length) * 100;
  if (consecPct >= 10) {
    insights.push({
      observation: `${consecPct.toFixed(0)}% of losses follow two consecutive stop losses.`,
      recommendation: 'Extend consecutive-loss pause or require stronger momentum to resume.',
    });
  }

  return insights;
}

export function filterTradesForStrategy(
  trades: HistoricalTrade[],
  strategyId: string,
): HistoricalTrade[] {
  return trades.filter((t) => t.strategyId === strategyId);
}

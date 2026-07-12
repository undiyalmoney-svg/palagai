import { Candle } from '../../models/candle.model';
import { HistoricalTrade } from '../../models/historical-test.model';
import { bodySize, bodyStrengthPct, candleRange } from '../../strategy-engine/utils/ohlc-candle.util';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';

export interface CandleMetrics {
  bodyPct: number;
  candleRange: number;
  upperWickPct: number;
  lowerWickPct: number;
  oppositeWickPct: number;
  bodySize: number;
}

export interface MomentumMetrics {
  bodyVsPrev2Avg: number;
  closeChangeVsPrev2Avg: number;
  volumeVsPrev2Avg: number;
}

export interface TradeCharacteristicsRecord {
  tradeId: string;
  strategyId: string;
  strategyName: string;
  direction: 'BUY' | 'SELL';
  outcome: 'WIN' | 'LOSS';
  points: number;
  entryTime: string;
  exitTime: string;
  entryTimeHhMm: string;
  holdingMinutes: number;
  marketRegime?: string;
  /** Entry (confirmation) candle */
  entryCandle: CandleMetrics;
  entryMomentum: MomentumMetrics;
  /** First Hour Breakout — breakout candle (bar before confirmation) */
  breakoutCandle?: CandleMetrics;
  breakoutDistancePts?: number;
  breakoutDistancePct?: number;
  firstHourRangeWidth?: number;
  hadRetestBeforeEntry?: boolean;
  /** Intraday Reversal */
  retestOccurred?: boolean;
  confidenceScore?: number;
  riskRewardRatio?: number;
  entryQualityTotal?: number;
}

export interface MetricComparison {
  metric: string;
  winnersAvg: number;
  losersAvg: number;
  winnersMedian: number;
  losersMedian: number;
  delta: number;
  deltaPct: number;
  separationScore: number;
  suggestedThreshold: number | null;
  filterDirection: 'above' | 'below' | 'none';
  recommendationStrength: 'strong' | 'moderate' | 'weak' | 'none';
  note: string;
}

export interface TradeCharacteristicsReport {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  byStrategy: Record<
    string,
    {
      totalTrades: number;
      wins: number;
      losses: number;
      comparisons: MetricComparison[];
    }
  >;
  overallComparisons: MetricComparison[];
  filterRecommendations: string[];
  records: TradeCharacteristicsRecord[];
}

export function measureCandle(candle: Candle, direction?: 'BUY' | 'SELL'): CandleMetrics {
  const range = candleRange(candle);
  const body = bodySize(candle);
  const bodyPct = bodyStrengthPct(candle);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWickPct = range > 0 ? (upperWick / range) * 100 : 0;
  const lowerWickPct = range > 0 ? (lowerWick / range) * 100 : 0;
  const oppositeWick = direction === 'BUY' ? lowerWick : direction === 'SELL' ? upperWick : 0;
  const oppositeWickPct = body > 0 ? (oppositeWick / body) * 100 : 100;

  return {
    bodyPct,
    candleRange: range,
    upperWickPct,
    lowerWickPct,
    oppositeWickPct,
    bodySize: body,
  };
}

export function measureMomentum(candles: Candle[], index: number): MomentumMetrics {
  const current = candles[index];
  if (!current) {
    return { bodyVsPrev2Avg: 0, closeChangeVsPrev2Avg: 0, volumeVsPrev2Avg: 0 };
  }

  const prev2 = candles.slice(Math.max(0, index - 2), index);
  const avgPrevBody =
    prev2.length > 0 ? prev2.reduce((sum, c) => sum + bodySize(c), 0) / prev2.length : 0;
  const curBody = bodySize(current);

  const closeChanges: number[] = [];
  for (let i = Math.max(1, index - 2); i <= index; i += 1) {
    closeChanges.push(candles[i]!.close - candles[i - 1]!.close);
  }
  const curChange = closeChanges[closeChanges.length - 1] ?? 0;
  const prevChanges = closeChanges.slice(0, -1);
  const avgPrevChange =
    prevChanges.length > 0
      ? prevChanges.reduce((sum, v) => sum + Math.abs(v), 0) / prevChanges.length
      : 0;

  const avgPrevVol =
    prev2.length > 0 ? prev2.reduce((sum, c) => sum + c.volume, 0) / prev2.length : 0;

  return {
    bodyVsPrev2Avg: avgPrevBody > 0 ? curBody / avgPrevBody : curBody > 0 ? 1 : 0,
    closeChangeVsPrev2Avg:
      avgPrevChange > 0 ? Math.abs(curChange) / avgPrevChange : Math.abs(curChange),
    volumeVsPrev2Avg: avgPrevVol > 0 ? current.volume / avgPrevVol : 1,
  };
}

export function detectRetestBetweenBreakoutAndEntry(
  candles: Candle[],
  breakoutIndex: number,
  entryIndex: number,
  direction: 'BUY' | 'SELL',
  rangeHigh: number,
  rangeLow: number,
): boolean {
  const tolerance = rangeHigh > 0 ? (rangeHigh - rangeLow) * 0.002 : 0;

  for (let i = breakoutIndex + 1; i < entryIndex; i += 1) {
    const c = candles[i]!;
    if (direction === 'BUY') {
      if (c.low <= rangeHigh + tolerance) {
        return true;
      }
    } else if (c.high >= rangeLow - tolerance) {
      return true;
    }
  }
  return false;
}

export function buildTradeCharacteristicsReport(
  records: TradeCharacteristicsRecord[],
): TradeCharacteristicsReport {
  const wins = records.filter((r) => r.outcome === 'WIN');
  const losses = records.filter((r) => r.outcome === 'LOSS');

  const metricExtractors: { key: string; label: string; extract: (r: TradeCharacteristicsRecord) => number | null }[] =
    [
      { key: 'entryBodyPct', label: 'Entry candle body %', extract: (r) => r.entryCandle.bodyPct },
      {
        key: 'entryOppositeWickPct',
        label: 'Entry opposite wick % of body',
        extract: (r) => r.entryCandle.oppositeWickPct,
      },
      { key: 'entryCandleRange', label: 'Entry candle range (pts)', extract: (r) => r.entryCandle.candleRange },
      {
        key: 'entryUpperWickPct',
        label: 'Entry upper wick % of range',
        extract: (r) => r.entryCandle.upperWickPct,
      },
      {
        key: 'entryLowerWickPct',
        label: 'Entry lower wick % of range',
        extract: (r) => r.entryCandle.lowerWickPct,
      },
      {
        key: 'entryBodyVsPrev2',
        label: 'Entry body vs prev-2 avg',
        extract: (r) => r.entryMomentum.bodyVsPrev2Avg,
      },
      {
        key: 'entryCloseMomentum',
        label: 'Entry close change vs prev-2 avg',
        extract: (r) => r.entryMomentum.closeChangeVsPrev2Avg,
      },
      {
        key: 'entryVolumeVsPrev2',
        label: 'Entry volume vs prev-2 avg',
        extract: (r) => r.entryMomentum.volumeVsPrev2Avg,
      },
      {
        key: 'breakoutBodyPct',
        label: 'Breakout candle body %',
        extract: (r) => r.breakoutCandle?.bodyPct ?? null,
      },
      {
        key: 'breakoutOppositeWickPct',
        label: 'Breakout opposite wick % of body',
        extract: (r) => r.breakoutCandle?.oppositeWickPct ?? null,
      },
      {
        key: 'breakoutDistancePts',
        label: 'Breakout distance beyond 1H range (pts)',
        extract: (r) => r.breakoutDistancePts ?? null,
      },
      {
        key: 'breakoutDistancePct',
        label: 'Breakout distance beyond 1H range (%)',
        extract: (r) => r.breakoutDistancePct ?? null,
      },
      {
        key: 'firstHourRangeWidth',
        label: 'First hour range width (pts)',
        extract: (r) => r.firstHourRangeWidth ?? null,
      },
      {
        key: 'hadRetest',
        label: 'Retest before entry (0/1)',
        extract: (r) => (r.hadRetestBeforeEntry === undefined ? null : r.hadRetestBeforeEntry ? 1 : 0),
      },
      {
        key: 'retestOccurred',
        label: 'Reversal retest (0/1)',
        extract: (r) => (r.retestOccurred === undefined ? null : r.retestOccurred ? 1 : 0),
      },
      {
        key: 'confidenceScore',
        label: 'Reversal confidence (/6)',
        extract: (r) => r.confidenceScore ?? null,
      },
      {
        key: 'riskRewardRatio',
        label: 'Risk/reward ratio',
        extract: (r) => r.riskRewardRatio ?? null,
      },
      {
        key: 'entryQualityTotal',
        label: 'Entry quality score (/100)',
        extract: (r) => r.entryQualityTotal ?? null,
      },
      {
        key: 'entryTimeMinutes',
        label: 'Entry time (minutes from 09:15)',
        extract: (r) => timeToMinutesFromOpen(r.entryTimeHhMm),
      },
      { key: 'holdingMinutes', label: 'Holding duration (min)', extract: (r) => r.holdingMinutes },
    ];

  const overallComparisons = metricExtractors
    .map((m) => compareMetric(records, wins, losses, m.label, m.extract))
    .filter((c): c is MetricComparison => c !== null);

  const byStrategy: TradeCharacteristicsReport['byStrategy'] = {};
  const strategyIds = [...new Set(records.map((r) => r.strategyId))];

  for (const strategyId of strategyIds) {
    const stratRecords = records.filter((r) => r.strategyId === strategyId);
    const stratWins = stratRecords.filter((r) => r.outcome === 'WIN');
    const stratLosses = stratRecords.filter((r) => r.outcome === 'LOSS');
    byStrategy[strategyId] = {
      totalTrades: stratRecords.length,
      wins: stratWins.length,
      losses: stratLosses.length,
      comparisons: metricExtractors
        .map((m) => compareMetric(stratRecords, stratWins, stratLosses, m.label, m.extract))
        .filter((c): c is MetricComparison => c !== null),
    };
  }

  const filterRecommendations = deriveFilterRecommendations(overallComparisons, byStrategy);

  return {
    totalTrades: records.length,
    wins: wins.length,
    losses: losses.length,
    winRate: records.length ? (wins.length / records.length) * 100 : 0,
    byStrategy,
    overallComparisons,
    filterRecommendations,
    records,
  };
}

function compareMetric(
  all: TradeCharacteristicsRecord[],
  wins: TradeCharacteristicsRecord[],
  losses: TradeCharacteristicsRecord[],
  label: string,
  extract: (r: TradeCharacteristicsRecord) => number | null,
): MetricComparison | null {
  const winValues = wins.map(extract).filter((v): v is number => v !== null && Number.isFinite(v));
  const lossValues = losses.map(extract).filter((v): v is number => v !== null && Number.isFinite(v));

  if (winValues.length < 2 && lossValues.length < 2) {
    return null;
  }
  if (winValues.length < 3 || lossValues.length < 3) {
    return {
      metric: label,
      winnersAvg: average(winValues),
      losersAvg: average(lossValues),
      winnersMedian: median(winValues),
      losersMedian: median(lossValues),
      delta: average(winValues) - average(lossValues),
      deltaPct: 0,
      separationScore: 0,
      suggestedThreshold: null,
      filterDirection: 'none',
      recommendationStrength: 'none',
      note: `Need ≥3 winners and ≥3 losers (have ${winValues.length}W / ${lossValues.length}L)`,
    };
  }

  const winnersAvg = average(winValues);
  const losersAvg = average(lossValues);
  const winnersMedian = median(winValues);
  const losersMedian = median(lossValues);
  const delta = winnersAvg - losersAvg;
  const deltaPct = losersAvg !== 0 ? (delta / Math.abs(losersAvg)) * 100 : delta !== 0 ? 100 : 0;

  const pooledStd = pooledStandardDeviation(winValues, lossValues);
  const separationScore = pooledStd > 0 ? Math.abs(delta) / pooledStd : Math.abs(delta) > 0 ? 1 : 0;

  const thresholdAnalysis = findBestThreshold(all, extract, wins, losses);
  let recommendationStrength: MetricComparison['recommendationStrength'] = 'none';
  const minSide = Math.min(winValues.length, lossValues.length);
  if (minSide >= 3 && thresholdAnalysis.accuracy >= 0.85) {
    recommendationStrength = 'strong';
  } else if (minSide >= 3 && thresholdAnalysis.accuracy >= 0.7 && separationScore >= 0.8) {
    recommendationStrength = 'moderate';
  } else if (minSide >= 3 && thresholdAnalysis.accuracy >= 0.6 && separationScore >= 0.5) {
    recommendationStrength = 'weak';
  }

  return {
    metric: label,
    winnersAvg,
    losersAvg,
    winnersMedian,
    losersMedian,
    delta,
    deltaPct,
    separationScore,
    suggestedThreshold: thresholdAnalysis.threshold,
    filterDirection: thresholdAnalysis.direction,
    recommendationStrength,
    note: thresholdAnalysis.note,
  };
}

function findBestThreshold(
  records: TradeCharacteristicsRecord[],
  extract: (r: TradeCharacteristicsRecord) => number | null,
  wins: TradeCharacteristicsRecord[],
  losses: TradeCharacteristicsRecord[],
): {
  threshold: number | null;
  direction: 'above' | 'below' | 'none';
  accuracy: number;
  minGroupSize: number;
  note: string;
} {
  const values = records
    .map((r) => ({ value: extract(r), outcome: r.outcome }))
    .filter((v): v is { value: number; outcome: 'WIN' | 'LOSS' } => v.value !== null && Number.isFinite(v.value));

  if (values.length < 4) {
    return { threshold: null, direction: 'none', accuracy: 0, minGroupSize: 0, note: 'Too few samples' };
  }

  const sorted = [...new Set(values.map((v) => v.value))].sort((a, b) => a - b);
  let best: {
    threshold: number | null;
    direction: 'above' | 'below' | 'none';
    accuracy: number;
    minGroupSize: number;
    note: string;
  } = { threshold: null, direction: 'none', accuracy: 0, minGroupSize: 0, note: '' };

  for (const threshold of sorted) {
    for (const direction of ['above', 'below'] as const) {
      let correct = 0;
      let winPass = 0;
      let lossPass = 0;
      for (const v of values) {
        const passes = direction === 'above' ? v.value >= threshold : v.value <= threshold;
        const predicted = passes ? 'WIN' : 'LOSS';
        if (predicted === v.outcome) {
          correct += 1;
        }
        if (v.outcome === 'WIN' && passes) {
          winPass += 1;
        }
        if (v.outcome === 'LOSS' && passes) {
          lossPass += 1;
        }
      }
      const accuracy = correct / values.length;
      const minGroupSize = Math.min(winPass, wins.length - winPass, lossPass, losses.length - lossPass);
      if (accuracy > best.accuracy) {
        best = {
          threshold,
          direction,
          accuracy,
          minGroupSize,
          note: `${(accuracy * 100).toFixed(0)}% separation at ${direction} ${threshold.toFixed(2)}`,
        };
      }
    }
  }

  if (best.accuracy < 0.55) {
    return {
      threshold: null,
      direction: 'none',
      accuracy: best.accuracy,
      minGroupSize: best.minGroupSize,
      note: 'No threshold meaningfully separates winners from losers',
    };
  }

  return best;
}

function deriveFilterRecommendations(
  overall: MetricComparison[],
  byStrategy: TradeCharacteristicsReport['byStrategy'],
): string[] {
  const recommendations: string[] = [];

  const strong = overall.filter((c) => c.recommendationStrength === 'strong');
  const moderate = overall.filter((c) => c.recommendationStrength === 'moderate');

  for (const c of [...strong, ...moderate]) {
    if (c.suggestedThreshold === null || c.filterDirection === 'none') {
      continue;
    }
    recommendations.push(
      `[Overall] Require ${c.metric} ${c.filterDirection} ${c.suggestedThreshold.toFixed(2)} — ${c.note} (winners avg ${c.winnersAvg.toFixed(2)}, losers avg ${c.losersAvg.toFixed(2)})`,
    );
  }

  for (const [strategyId, data] of Object.entries(byStrategy)) {
    const stratStrong = data.comparisons.filter(
      (c) => c.recommendationStrength === 'strong' || c.recommendationStrength === 'moderate',
    );
    for (const c of stratStrong) {
      if (c.suggestedThreshold === null || c.filterDirection === 'none') {
        continue;
      }
      recommendations.push(
        `[${strategyId}] Require ${c.metric} ${c.filterDirection} ${c.suggestedThreshold.toFixed(2)} — ${c.note}`,
      );
    }
  }

  if (!recommendations.length) {
    recommendations.push(
      'No metric reached strong or moderate separation in this sample. Collect more trades before adding filters.',
    );
  }

  return recommendations;
}

function timeToMinutesFromOpen(hhMm: string): number {
  const [h, m] = hhMm.split(':').map(Number);
  return (h - 9) * 60 + (m - 15);
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pooledStandardDeviation(a: number[], b: number[]): number {
  if (a.length < 2 && b.length < 2) {
    return 0;
  }
  const meanA = average(a);
  const meanB = average(b);
  const varA = a.length > 1 ? a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (a.length - 1) : 0;
  const varB = b.length > 1 ? b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (b.length - 1) : 0;
  const pooled =
    (a.length + b.length) > 2
      ? Math.sqrt(((a.length - 1) * varA + (b.length - 1) * varB) / (a.length + b.length - 2))
      : 0;
  return pooled;
}

export function attachTradeOutcome(
  partial: Omit<TradeCharacteristicsRecord, 'outcome' | 'points' | 'exitTime' | 'holdingMinutes'>,
  trade: HistoricalTrade,
): TradeCharacteristicsRecord {
  return {
    ...partial,
    outcome: trade.outcome,
    points: trade.points,
    exitTime: trade.exitTime,
    holdingMinutes: trade.holdingMinutes,
  };
}

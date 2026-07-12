import { HistoricalTrade, TradeDirection } from '../../models/historical-test.model';
import { MarketRegime } from '../../strategy-engine/utils/market-regime.util';

export interface RegimePerformanceRow {
  strategyId: string;
  strategyName: string;
  regime: MarketRegime;
  trades: number;
  wins: number;
  losses: number;
  netProfit: number;
}

export interface MarketRegimeSummary {
  trendingDays: number;
  rangingDays: number;
  highVolatilityDays: number;
  lowVolatilityDays: number;
  unknownDays: number;
  performanceByRegime: RegimePerformanceRow[];
}

export function buildMarketRegimeSummary(params: {
  dayRegimes: Map<string, MarketRegime>;
  trades: HistoricalTrade[];
}): MarketRegimeSummary {
  const { dayRegimes, trades } = params;

  let trendingDays = 0;
  let rangingDays = 0;
  let highVolatilityDays = 0;
  let lowVolatilityDays = 0;
  let unknownDays = 0;

  for (const regime of dayRegimes.values()) {
    switch (regime) {
      case 'TRENDING':
        trendingDays += 1;
        break;
      case 'RANGING':
        rangingDays += 1;
        break;
      case 'HIGH_VOLATILITY':
        highVolatilityDays += 1;
        break;
      case 'LOW_VOLATILITY':
        lowVolatilityDays += 1;
        break;
      default:
        unknownDays += 1;
    }
  }

  const performanceByRegime = buildPerformanceByRegime(trades);

  return {
    trendingDays,
    rangingDays,
    highVolatilityDays,
    lowVolatilityDays,
    unknownDays,
    performanceByRegime,
  };
}

function buildPerformanceByRegime(trades: HistoricalTrade[]): RegimePerformanceRow[] {
  const buckets = new Map<string, RegimePerformanceRow>();

  for (const trade of trades) {
    const regime = (trade.marketRegime ?? 'UNKNOWN') as MarketRegime;
    const key = `${trade.strategyId}:${regime}`;
    const row =
      buckets.get(key) ??
      ({
        strategyId: trade.strategyId,
        strategyName: trade.strategyName,
        regime,
        trades: 0,
        wins: 0,
        losses: 0,
        netProfit: 0,
      } satisfies RegimePerformanceRow);

    row.trades += 1;
    if (trade.outcome === 'WIN') {
      row.wins += 1;
    } else {
      row.losses += 1;
    }
    row.netProfit += trade.points;
    buckets.set(key, row);
  }

  return [...buckets.values()].sort(
    (a, b) => a.strategyName.localeCompare(b.strategyName) || a.regime.localeCompare(b.regime),
  );
}

export function extractTradeDayRegimes(
  dayRegimeMap: Map<string, { regime: MarketRegime }>,
): Map<string, MarketRegime> {
  const result = new Map<string, MarketRegime>();
  for (const [date, entry] of dayRegimeMap) {
    result.set(date, entry.regime);
  }
  return result;
}

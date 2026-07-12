import type { ClosedTrade, StrategyMetrics } from './types.ts';

export function computeMetrics(trades: ClosedTrade[], startingCapital = 200_000): StrategyMetrics {
  const monthlyReturns: Record<string, number> = {};
  const yearlyReturns: Record<string, number> = {};
  let equity = startingCapital;
  const equityCurve: number[] = [equity];
  let peak = equity;
  let maxDd = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let sumR = 0;
  let maxConW = 0;
  let maxConL = 0;
  let curW = 0;
  let curL = 0;
  const returns: number[] = [];

  for (const t of trades) {
    // Approx ₹/pt for Nifty futures lot ~65; use points as PnL units then scale
    const pnlRupees = t.points * 65;
    equity += pnlRupees;
    equityCurve.push(equity);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    returns.push(pnlRupees / startingCapital);

    monthlyReturns[t.month] = (monthlyReturns[t.month] ?? 0) + t.points;
    yearlyReturns[t.year] = (yearlyReturns[t.year] ?? 0) + t.points;
    sumR += t.rMultiple;

    if (t.points > 0) {
      wins += 1;
      grossProfit += t.points;
      curW += 1;
      curL = 0;
      maxConW = Math.max(maxConW, curW);
    } else {
      losses += 1;
      grossLoss += Math.abs(t.points);
      curL += 1;
      curW = 0;
      maxConL = Math.max(maxConL, curL);
    }
  }

  const totalTrades = trades.length;
  const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const netProfit = trades.reduce((s, t) => s + t.points, 0);

  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1
      ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
      : 0;
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;

  const years =
    trades.length >= 2
      ? Math.max(
          1 / 12,
          (new Date(trades.at(-1)!.exitTime).getTime() - new Date(trades[0]!.entryTime).getTime()) /
            (365.25 * 86400000),
        )
      : 1;
  const endEquity = startingCapital + netProfit * 65;
  const cagr =
    years > 0 && endEquity > 0
      ? (Math.pow(endEquity / startingCapital, 1 / years) - 1) * 100
      : 0;

  const months = Object.values(monthlyReturns);
  const greenMonths = months.filter((m) => m > 0).length;
  const consistencyScore = months.length ? (greenMonths / months.length) * 100 : 0;

  const yearsList = Object.values(yearlyReturns);
  const greenYears = yearsList.filter((y) => y > 0).length;
  const stabilityScore = yearsList.length
    ? (greenYears / yearsList.length) * 100 - maxDd * 0.5 + Math.min(profitFactor, 5) * 5
    : 0;

  return {
    netProfit,
    cagr,
    winRate,
    profitFactor,
    sharpe,
    maxDrawdownPct: maxDd,
    avgR: totalTrades ? sumR / totalTrades : 0,
    totalTrades,
    consecutiveWins: maxConW,
    consecutiveLosses: maxConL,
    monthlyReturns,
    yearlyReturns,
    consistencyScore,
    stabilityScore,
  };
}

export function passesHardFilters(m: StrategyMetrics): boolean {
  return (
    m.totalTrades >= 100 &&
    m.profitFactor >= 1.5 &&
    m.maxDrawdownPct <= 15 &&
    m.winRate >= 40
  );
}

export function rankScore(m: StrategyMetrics): number {
  // Weighted: PF, net, low DD, consistency, multi-year stability
  return (
    Math.min(m.profitFactor, 5) * 25 +
    Math.min(m.netProfit / 50, 40) +
    Math.max(0, 30 - m.maxDrawdownPct) +
    m.consistencyScore * 0.35 +
    m.stabilityScore * 0.25 +
    Math.min(m.sharpe, 3) * 5
  );
}

export function buildEquityCurve(trades: ClosedTrade[]): { date: string; equity: number }[] {
  let equity = 0;
  const curve: { date: string; equity: number }[] = [];
  for (const t of trades) {
    equity += t.points;
    curve.push({ date: t.exitTime, equity });
  }
  return curve;
}

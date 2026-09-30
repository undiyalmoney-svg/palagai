/**
 * Performance statistics over the trades the engine took.
 *
 * Each trade was decided on closed bars only and filled from later bars, so
 * nothing here can look ahead. Open trades count as signals but are left out
 * of every P&L figure until they close.
 *
 * Returns assume each trade risks `riskPerTradePct` of running equity, so a
 * trade that makes 2R adds `2 × riskPerTradePct` percent.
 */
import { SmcStats, SmcStatsSplit, SmcTrade } from './smc.types';

const BREAKEVEN_R = 0.05;

export function computeSmcStats(trades: SmcTrade[], riskPerTradePct: number): SmcStats {
  const closed = trades
    .filter((t) => t.status === 'closed' && t.rMultiple != null)
    .sort((a, b) => (a.exitTs ?? 0) - (b.exitTs ?? 0) || (a.exitIndex ?? 0) - (b.exitIndex ?? 0));

  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let sumR = 0;
  let sumPct = 0;
  let equity = 1;
  let peak = 1;
  let maxDd = 0;

  for (const t of closed) {
    const r = t.rMultiple!;
    sumR += r;
    if (r > BREAKEVEN_R) {
      wins += 1;
      grossWin += r;
    } else if (r < -BREAKEVEN_R) {
      losses += 1;
      grossLoss += -r;
    } else {
      breakeven += 1;
    }
    const pct = t.returnPct ?? r * riskPerTradePct;
    sumPct += pct;
    equity *= 1 + pct / 100;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const total = closed.length;
  const plannedRr = trades.reduce((sum, t) => sum + t.rr, 0);
  return {
    totalTrades: total,
    wins,
    losses,
    breakeven,
    winRate: total ? (wins / total) * 100 : null,
    avgPlannedRr: trades.length ? plannedRr / trades.length : null,
    avgR: total ? sumR / total : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    maxDrawdownPct: maxDd * 100,
    netReturnPct: (equity - 1) * 100,
    avgTradePct: total ? sumPct / total : null,
    buySignals: trades.filter((t) => t.side === 'BUY').length,
    sellSignals: trades.filter((t) => t.side === 'SELL').length,
    openTrades: trades.filter((t) => t.status === 'open').length,
  };
}

/**
 * Backtest = everything decided before the live session began. Live = trades
 * entered during the current live session. On a past date nothing is live.
 */
export function splitSmcStats(
  trades: SmcTrade[],
  riskPerTradePct: number,
  liveFromTs: number | null,
): SmcStatsSplit {
  const live = liveFromTs == null ? [] : trades.filter((t) => t.entryTs >= liveFromTs);
  const back = liveFromTs == null ? trades : trades.filter((t) => t.entryTs < liveFromTs);
  return {
    backtest: computeSmcStats(back, riskPerTradePct),
    live: computeSmcStats(live, riskPerTradePct),
    liveFromTs,
  };
}

/**
 * NSE equity day strategies for Stocks Desk (₹60k capital plan).
 *
 * GAP_FADE_500 — ~₹500/weekday avg (docs/08)
 * ALMOST_GREEN_MIX — ~82% signal green / ~70% calendar green (docs/10)
 */
import { Candle } from '../../../models/candle.model';
import { extractTradeDate } from '../../../utils/trade-date.util';

export const STOCKS_CAPITAL_RS = 60_000;
export const STOCKS_RISK_PCT = 0.02;
export const STOCKS_DAY_LOSS_RS = 2_400;
export const STOCKS_STOP_PCT = 0.01;

/** Honest ₹500-calendar champion params */
export const GAP_FADE_500_GAP_PCT = 0.003;
export const GAP_FADE_500_STOP_PCT = 0.015;
export const GAP_FADE_500_RISK_PCT = 0.025;
export const GAP_FADE_500_MAX_PER_DAY = 3;

/** Almost-all-green mix: fade gap-up OR bounce gap-down, tight TP */
export const ALMOST_GREEN_GAP_PCT = 0.005;
export const ALMOST_GREEN_STOP_PCT = 0.025;
export const ALMOST_GREEN_TARGET_PCT = 0.005;
export const ALMOST_GREEN_RISK_PCT = 0.025;
/** Default max simultaneous names — capital split across legs */
export const ALMOST_GREEN_MAX_PER_DAY = 3;
export const STOCKS_MAX_LEGS = 3;

export type StocksStrategyId =
  | 'ALMOST_GREEN_MIX'
  | 'GAP_FADE_500'
  | 'FOLLOW_PRIOR_COLOR'
  | 'GAP_DOWN_BOUNCE'
  | 'GAP_UP_FADE'
  | 'PDHL_CONT_EOD'
  | 'BUY_OPEN_EOD'
  | 'SELL_OPEN_EOD';

export const STOCKS_STRATEGY_OPTIONS: Array<{ id: StocksStrategyId; label: string }> = [
  {
    id: 'GAP_FADE_500',
    label: '₹500 book — gap-up fade 0.3% · max 3 (DEFAULT)',
  },
  {
    id: 'ALMOST_GREEN_MIX',
    label: 'Almost-green mix — 0.5% gap ± TP 0.5% (split up to 3)',
  },
  { id: 'FOLLOW_PRIOR_COLOR', label: 'Follow prior day colour' },
  { id: 'GAP_DOWN_BOUNCE', label: 'Gap-down bounce 0.5%' },
  { id: 'GAP_UP_FADE', label: 'Gap-up fade 0.5%' },
  { id: 'PDHL_CONT_EOD', label: 'PDHL continuation' },
  { id: 'BUY_OPEN_EOD', label: 'Buy open → EOD' },
  { id: 'SELL_OPEN_EOD', label: 'Sell open → EOD' },
];

export interface StocksDayTrade {
  symbol: string;
  date: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  exit: number;
  qty: number;
  points: number;
  pnlRs: number;
  strategyId: StocksStrategyId;
  exitReason: string;
  /** Absolute gap fraction at open — used for honest max-N/day ranking */
  gapAbs?: number;
}

function dayKey(c: Candle): string {
  return extractTradeDate(c.date);
}

export function qtyForRisk(
  entry: number,
  stop: number,
  capital = STOCKS_CAPITAL_RS,
  riskPct = STOCKS_RISK_PCT,
): number {
  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare < 0.05) {
    return 0;
  }
  const riskRs = capital * riskPct;
  const q = Math.floor(riskRs / riskPerShare);
  const maxQty = Math.floor((capital * 1.5) / entry);
  return Math.max(0, Math.min(q, maxQty));
}

/** Stop / target fractions for live MIS protection (mirrors day-bar DNA). */
export function stockRiskParams(strategyId: StocksStrategyId): {
  stopPct: number;
  targetPct: number;
  riskPct: number;
} {
  if (strategyId === 'GAP_FADE_500') {
    return {
      stopPct: GAP_FADE_500_STOP_PCT,
      targetPct: 0,
      riskPct: GAP_FADE_500_RISK_PCT,
    };
  }
  if (strategyId === 'ALMOST_GREEN_MIX') {
    return {
      stopPct: ALMOST_GREEN_STOP_PCT,
      targetPct: ALMOST_GREEN_TARGET_PCT,
      riskPct: ALMOST_GREEN_RISK_PCT,
    };
  }
  return { stopPct: STOCKS_STOP_PCT, targetPct: 0, riskPct: STOCKS_RISK_PCT };
}

export function stockLevelsFromEntry(
  direction: 'BUY' | 'SELL',
  entry: number,
  strategyId: StocksStrategyId,
): { stop: number; target: number | null; stopPct: number; targetPct: number } {
  const { stopPct, targetPct } = stockRiskParams(strategyId);
  const stop = direction === 'BUY' ? entry * (1 - stopPct) : entry * (1 + stopPct);
  const target =
    targetPct > 0
      ? direction === 'BUY'
        ? entry * (1 + targetPct)
        : entry * (1 - targetPct)
      : null;
  return { stop, target, stopPct, targetPct };
}

function pushTrade(
  out: StocksDayTrade[],
  params: Omit<StocksDayTrade, 'points' | 'pnlRs'> & { points: number },
): void {
  out.push({
    ...params,
    pnlRs: params.points * params.qty,
  });
}

/** After multi-symbol replay: keep top N by gap size per day (known at open). */
export function applyMaxTradesPerDayByGap(
  trades: StocksDayTrade[],
  maxPerDay: number,
): StocksDayTrade[] {
  const byDay = new Map<string, StocksDayTrade[]>();
  for (const t of trades) {
    const arr = byDay.get(t.date) ?? [];
    arr.push(t);
    byDay.set(t.date, arr);
  }
  const out: StocksDayTrade[] = [];
  for (const [, arr] of byDay) {
    arr.sort(
      (a, b) =>
        (b.gapAbs ?? 0) - (a.gapAbs ?? 0) || a.symbol.localeCompare(b.symbol),
    );
    out.push(...arr.slice(0, maxPerDay));
  }
  return out;
}

export function maxPerDayForStrategy(strategyId: StocksStrategyId): number | null {
  if (strategyId === 'GAP_FADE_500') return GAP_FADE_500_MAX_PER_DAY;
  if (strategyId === 'ALMOST_GREEN_MIX') return ALMOST_GREEN_MAX_PER_DAY;
  return null;
}

/**
 * After picking up to maxLegs signals for a day, resize qty so ₹60k is split
 * equally across that day's legs (risk + notional per leg = capital / n).
 */
export function resizeTradesForCapitalSplit(
  trades: StocksDayTrade[],
  capitalRs = STOCKS_CAPITAL_RS,
): StocksDayTrade[] {
  const byDay = new Map<string, StocksDayTrade[]>();
  for (const t of trades) {
    const arr = byDay.get(t.date) ?? [];
    arr.push(t);
    byDay.set(t.date, arr);
  }
  const out: StocksDayTrade[] = [];
  for (const [, dayTrades] of byDay) {
    const n = dayTrades.length;
    if (n <= 1) {
      out.push(...dayTrades);
      continue;
    }
    const perLegCapital = capitalRs / n;
    for (const t of dayTrades) {
      const riskPct =
        t.strategyId === 'ALMOST_GREEN_MIX'
          ? ALMOST_GREEN_RISK_PCT
          : t.strategyId === 'GAP_FADE_500'
            ? GAP_FADE_500_RISK_PCT
            : STOCKS_RISK_PCT;
      const qty = qtyForRisk(t.entry, t.stop, perLegCapital, riskPct);
      out.push({
        ...t,
        qty,
        pnlRs: t.points * qty,
      });
    }
  }
  return out;
}

/** Replay on daily OHLC series (sorted ascending). */
export function replayStocksDayStrategy(params: {
  symbol: string;
  days: Candle[];
  strategyId: StocksStrategyId;
  capitalRs?: number;
}): StocksDayTrade[] {
  const { symbol, days, strategyId } = params;
  const capital = params.capitalRs ?? STOCKS_CAPITAL_RS;
  const trades: StocksDayTrade[] = [];

  let gapFadePct = 0.005;
  let gapBouncePct = 0.005;
  let stopPct = STOCKS_STOP_PCT;
  let riskPct = STOCKS_RISK_PCT;
  let targetPct = 0;

  if (strategyId === 'GAP_FADE_500') {
    gapFadePct = GAP_FADE_500_GAP_PCT;
    stopPct = GAP_FADE_500_STOP_PCT;
    riskPct = GAP_FADE_500_RISK_PCT;
  } else if (strategyId === 'ALMOST_GREEN_MIX') {
    gapFadePct = ALMOST_GREEN_GAP_PCT;
    gapBouncePct = ALMOST_GREEN_GAP_PCT;
    stopPct = ALMOST_GREEN_STOP_PCT;
    riskPct = ALMOST_GREEN_RISK_PCT;
    targetPct = ALMOST_GREEN_TARGET_PCT;
  }

  for (let i = 0; i < days.length; i += 1) {
    const d = days[i]!;
    const prev = i > 0 ? days[i - 1]! : null;
    const prev2 = i > 1 ? days[i - 2]! : null;
    let dir: 'BUY' | 'SELL' | null = null;
    let gapAbs = 0;

    switch (strategyId) {
      case 'BUY_OPEN_EOD':
        dir = 'BUY';
        break;
      case 'SELL_OPEN_EOD':
        dir = 'SELL';
        break;
      case 'FOLLOW_PRIOR_COLOR':
        if (!prev) continue;
        dir = prev.close >= prev.open ? 'BUY' : 'SELL';
        break;
      case 'GAP_DOWN_BOUNCE':
        if (!prev || d.open >= prev.close * (1 - gapBouncePct)) continue;
        dir = 'BUY';
        gapAbs = (prev.close - d.open) / prev.close;
        break;
      case 'GAP_UP_FADE':
      case 'GAP_FADE_500':
        if (!prev || d.open <= prev.close * (1 + gapFadePct)) continue;
        dir = 'SELL';
        gapAbs = (d.open - prev.close) / prev.close;
        break;
      case 'ALMOST_GREEN_MIX': {
        if (!prev) continue;
        const gap = (d.open - prev.close) / prev.close;
        if (gap >= gapFadePct) {
          dir = 'SELL';
          gapAbs = gap;
        } else if (gap <= -gapBouncePct) {
          dir = 'BUY';
          gapAbs = -gap;
        } else {
          continue;
        }
        break;
      }
      case 'PDHL_CONT_EOD':
        if (!prev || !prev2) continue;
        if (prev.close > prev2.high && prev.close > prev.open) dir = 'BUY';
        else if (prev.close < prev2.low && prev.close < prev.open) dir = 'SELL';
        else continue;
        break;
      default:
        continue;
    }

    if (!dir) continue;
    const stop = dir === 'BUY' ? d.open * (1 - stopPct) : d.open * (1 + stopPct);
    const qty = qtyForRisk(d.open, stop, capital, riskPct);
    if (qty < 1) continue;

    let exit = d.close;
    let reason = 'EOD';
    let points = dir === 'BUY' ? exit - d.open : d.open - exit;
    // Conservative: SL if touched; else TP if touched; else EOD
    if (dir === 'BUY' && d.low <= stop) {
      exit = stop;
      points = exit - d.open;
      reason = 'SL';
    } else if (dir === 'SELL' && d.high >= stop) {
      exit = stop;
      points = d.open - exit;
      reason = 'SL';
    } else if (targetPct > 0) {
      const tp = dir === 'BUY' ? d.open * (1 + targetPct) : d.open * (1 - targetPct);
      if (dir === 'BUY' && d.high >= tp) {
        exit = tp;
        points = exit - d.open;
        reason = 'TP';
      } else if (dir === 'SELL' && d.low <= tp) {
        exit = tp;
        points = d.open - exit;
        reason = 'TP';
      }
    }

    pushTrade(trades, {
      symbol,
      date: dayKey(d),
      direction: dir,
      entry: d.open,
      stop,
      exit,
      qty,
      points,
      strategyId,
      exitReason: reason,
      gapAbs,
    });
  }

  return trades;
}

/**
 * Stocks Desk adaptation of Align Combo · GENIE — SEPARATE from index DNA.
 *
 * Equity day-bar proxy for “trade with the aligned move”:
 *   prior red + gap-down ≥0.3% → SELL (dump continuation, screenshot-style)
 *   prior green + gap-up ≥0.3% → BUY
 * Weak / mixed opens → no trade (SKIP analogue).
 *
 * Does not modify GAP_FADE_500 or other stocks strategies.
 */
import { Candle } from '../../../models/candle.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import type { StocksDayTrade } from './stocks-equity.evaluator';

export const ALIGN_COMBO_STOCKS_GAP_PCT = 0.003;
export const ALIGN_COMBO_STOCKS_STOP_PCT = 0.015;
export const ALIGN_COMBO_STOCKS_RISK_PCT = 0.025;
export const ALIGN_COMBO_STOCKS_MAX_PER_DAY = 3;
export const ALIGN_COMBO_STOCKS_CAPITAL_RS = 60_000;

function qtyForRiskLocal(
  entry: number,
  stop: number,
  capital = ALIGN_COMBO_STOCKS_CAPITAL_RS,
  riskPct = ALIGN_COMBO_STOCKS_RISK_PCT,
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

export function replayAlignComboGenieStocks(params: {
  symbol: string;
  days: Candle[];
  capitalRs?: number;
}): StocksDayTrade[] {
  const { symbol, days } = params;
  const capital = params.capitalRs ?? ALIGN_COMBO_STOCKS_CAPITAL_RS;
  const trades: StocksDayTrade[] = [];

  for (let i = 1; i < days.length; i += 1) {
    const d = days[i]!;
    const prev = days[i - 1]!;
    const gap = (d.open - prev.close) / prev.close;
    const priorBear = prev.close < prev.open;
    const priorBull = prev.close > prev.open;

    let dir: 'BUY' | 'SELL' | null = null;
    let gapAbs = 0;
    if (priorBear && gap <= -ALIGN_COMBO_STOCKS_GAP_PCT) {
      dir = 'SELL';
      gapAbs = Math.abs(gap);
    } else if (priorBull && gap >= ALIGN_COMBO_STOCKS_GAP_PCT) {
      dir = 'BUY';
      gapAbs = gap;
    }
    if (!dir) {
      continue;
    }

    const stop =
      dir === 'BUY'
        ? d.open * (1 - ALIGN_COMBO_STOCKS_STOP_PCT)
        : d.open * (1 + ALIGN_COMBO_STOCKS_STOP_PCT);
    const qty = qtyForRiskLocal(d.open, stop, capital, ALIGN_COMBO_STOCKS_RISK_PCT);
    if (qty < 1) {
      continue;
    }

    let exit = d.close;
    let reason = 'EOD';
    let points = dir === 'BUY' ? exit - d.open : d.open - exit;
    if (dir === 'BUY' && d.low <= stop) {
      exit = stop;
      points = exit - d.open;
      reason = 'SL';
    } else if (dir === 'SELL' && d.high >= stop) {
      exit = stop;
      points = d.open - exit;
      reason = 'SL';
    }

    trades.push({
      symbol,
      date: extractTradeDate(d.date),
      direction: dir,
      entry: d.open,
      stop,
      exit,
      qty,
      points,
      pnlRs: points * qty,
      strategyId: 'ALIGN_COMBO_GENIE',
      exitReason: reason,
      gapAbs,
    });
  }
  return trades;
}

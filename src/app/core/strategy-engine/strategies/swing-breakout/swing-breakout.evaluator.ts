import { Candle } from '../../../models/candle.model';
import {
  atrAt,
  avgVolume,
  donchian,
  emaLast,
  swingLevels,
} from '../../../strategy-manager/indicators/desk-indicators';

/**
 * Swing breakout DNA (Trade Desk) — long-only, ~1-week holding horizon.
 *
 * Entry: EMA20 > EMA50 (uptrend) + close breaks above the prior 20-day high
 * (Donchian) + today's volume ≥ 1.2× the 20-day average (confirms real
 * participation, not a thin-volume false break).
 *
 * Stop: whichever is FARTHER from entry of (a) 2×ATR14 below entry or
 * (b) the last confirmed 5-bar swing low — avoids a stop so tight to entry
 * that normal daily noise triggers it right after the breakout. Then capped
 * to at most SWING_MAX_RISK_PCT below entry: on a volatile name, ATR/swing-low
 * alone can put the stop 20–50%+ away, which drags the 2R target out to a
 * move that can never realistically happen inside a one-week hold — a real
 * backtest showed 0 of 86 trades ever reaching TARGET as a result, every
 * single one just riding the 5-day time-stop instead. Capping risk keeps the
 * target close enough to actually be reachable in the time given.
 *
 * Target: 2R (reward = 2× the entry→stop distance).
 * Time-stop: exit by the 5th trading day after entry even if neither
 * stop nor target has been hit — "profit within a week" is the point.
 */

export const SWING_CAPITAL_PER_STOCK_RS = 10_000;
export const SWING_TREND_FAST_EMA = 20;
export const SWING_TREND_SLOW_EMA = 50;
export const SWING_ENTRY_LOOKBACK = 20;
export const SWING_VOLUME_LOOKBACK = 20;
export const SWING_VOLUME_MULTIPLIER = 1.2;
export const SWING_ATR_PERIOD = 14;
export const SWING_ATR_STOP_MULT = 2;
export const SWING_STRUCT_SWING_LB = 5;
/** Hard cap on entry→stop distance — keeps the 2R target reachable within the hold window. */
export const SWING_MAX_RISK_PCT = 0.07;
export const SWING_REWARD_MULTIPLE = 2;
export const SWING_MAX_HOLD_TRADING_DAYS = 5;
export const SWING_MIN_PRICE_RS = 50;
export const SWING_MAX_PRICE_RS = 2_500;
export const SWING_MIN_AVG_VOLUME = 100_000;
/** EMA50 needs the most history — require a healthy buffer beyond it. */
export const SWING_MIN_CANDLES = SWING_TREND_SLOW_EMA + 5;

export interface SwingEntrySignal {
  entry: number;
  stop: number;
  target: number;
  riskPerShareRs: number;
  rewardRiskRatio: number;
  qty: number;
  notionalRs: number;
  breakoutLevel: number;
  volumeToday: number;
  avgVolume20: number;
  volumeRatio: number;
  asOfDate: string;
}

export function qtyForFlatCapital(
  entryPrice: number,
  capitalRs: number = SWING_CAPITAL_PER_STOCK_RS,
): number {
  if (!(entryPrice > 0)) {
    return 0;
  }
  return Math.max(0, Math.floor(capitalRs / entryPrice));
}

/** Evaluates the LAST candle in `candles` (ascending by date) for a fresh breakout entry. */
export function evaluateSwingEntry(candles: Candle[]): SwingEntrySignal | null {
  if (candles.length < SWING_MIN_CANDLES) {
    return null;
  }
  const closes = candles.map((c) => c.close);
  const fastEma = emaLast(closes, SWING_TREND_FAST_EMA);
  const slowEma = emaLast(closes, SWING_TREND_SLOW_EMA);
  if (fastEma == null || slowEma == null || fastEma <= slowEma) {
    return null;
  }

  const last = candles[candles.length - 1]!;
  const donch = donchian(candles, SWING_ENTRY_LOOKBACK, true);
  if (!donch || last.close <= donch.high) {
    return null;
  }

  const vol20 = avgVolume(candles, SWING_VOLUME_LOOKBACK, true);
  if (vol20 == null || vol20 < SWING_MIN_AVG_VOLUME) {
    return null;
  }
  if (last.volume < vol20 * SWING_VOLUME_MULTIPLIER) {
    return null;
  }

  if (last.close < SWING_MIN_PRICE_RS || last.close > SWING_MAX_PRICE_RS) {
    return null;
  }

  const entry = last.close;
  const atr = atrAt(candles, SWING_ATR_PERIOD);
  const swing = swingLevels(candles, SWING_STRUCT_SWING_LB);
  const atrStop = atr != null ? entry - atr * SWING_ATR_STOP_MULT : null;
  const structStop = swing?.low != null && swing.low < entry ? swing.low : null;
  const candidates = [atrStop, structStop].filter(
    (v): v is number => v != null && v < entry,
  );
  const rawStop = candidates.length ? Math.min(...candidates) : entry * 0.95;
  // Cap risk at SWING_MAX_RISK_PCT of entry — pull the stop back up toward entry if
  // ATR/swing-low would otherwise put it (and therefore the 2R target) unreachably far away.
  const stop = Math.max(rawStop, entry * (1 - SWING_MAX_RISK_PCT));

  const riskPerShareRs = entry - stop;
  if (!(riskPerShareRs > 0)) {
    return null;
  }
  const target = entry + riskPerShareRs * SWING_REWARD_MULTIPLE;
  const qty = qtyForFlatCapital(entry);
  if (qty <= 0) {
    return null;
  }

  return {
    entry,
    stop,
    target,
    riskPerShareRs,
    rewardRiskRatio: SWING_REWARD_MULTIPLE,
    qty,
    notionalRs: qty * entry,
    breakoutLevel: donch.high,
    volumeToday: last.volume,
    avgVolume20: vol20,
    volumeRatio: last.volume / vol20,
    asOfDate: last.date,
  };
}

export type SwingExitReason = 'TARGET' | 'STOP' | 'TIME' | 'HOLD';

export interface SwingPositionCheck {
  action: 'HOLD' | 'SELL';
  reason: SwingExitReason;
  currentPrice: number;
  daysHeld: number;
  asOfDate: string;
}

/**
 * Evaluates an open manual position against candles up to "today".
 * `entryDate` is the Kite-style date string (candle.date) of the entry candle.
 */
export function evaluateSwingExit(
  candles: Candle[],
  entryDate: string,
  stop: number,
  target: number,
): SwingPositionCheck | null {
  if (!candles.length) {
    return null;
  }
  const entryDay = entryDate.slice(0, 10);
  const after = candles.filter((c) => c.date.slice(0, 10) > entryDay);
  const last = candles[candles.length - 1]!;
  const daysHeld = after.length;
  const currentPrice = last.close;

  let reason: SwingExitReason = 'HOLD';
  if (currentPrice <= stop) {
    reason = 'STOP';
  } else if (currentPrice >= target) {
    reason = 'TARGET';
  } else if (daysHeld >= SWING_MAX_HOLD_TRADING_DAYS) {
    reason = 'TIME';
  }

  return {
    action: reason === 'HOLD' ? 'HOLD' : 'SELL',
    reason,
    currentPrice,
    daysHeld,
    asOfDate: last.date,
  };
}

/**
 * Historical backtest of this exact evaluator over one symbol's daily candle series —
 * walks forward day by day, fires the same evaluateSwingEntry() rule, then simulates the
 * trade to its stop / target / time-stop exit using the same rules evaluateSwingExit() uses.
 *
 * Fill assumptions (no real broker involved, so these are necessarily simplified):
 * - Entry fills at that day's close (same as the live signal).
 * - If a later day's low touches the stop AND its high touches the target, STOP wins
 *   (conservative — avoids overstating the win rate on volatile bars).
 * - Stop/target fill at the stop/target price itself; a time-stop exits at that day's close.
 * - Trades on the same symbol never overlap — the next scan starts after the prior trade closes.
 */
export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  stop: number;
  target: number;
  exitDate: string;
  exitPrice: number;
  exitReason: 'TARGET' | 'STOP' | 'TIME';
  rMultiple: number;
  pnlPct: number;
  daysHeld: number;
  win: boolean;
}

export function backtestSwingBreakout(candles: Candle[], symbol: string): BacktestTrade[] {
  const trades: BacktestTrade[] = [];
  let i = SWING_MIN_CANDLES - 1;

  while (i < candles.length) {
    const windowUpTo = candles.slice(0, i + 1);
    const entry = evaluateSwingEntry(windowUpTo);
    if (!entry) {
      i += 1;
      continue;
    }

    let exitDate: string | null = null;
    let exitPrice = 0;
    let exitReason: 'TARGET' | 'STOP' | 'TIME' = 'TIME';
    let daysHeld = 0;
    let closedAt = -1;

    for (let j = i + 1; j < candles.length; j += 1) {
      const bar = candles[j]!;
      daysHeld = j - i;
      if (bar.low <= entry.stop) {
        exitReason = 'STOP';
        exitPrice = entry.stop;
        exitDate = bar.date;
        closedAt = j;
        break;
      }
      if (bar.high >= entry.target) {
        exitReason = 'TARGET';
        exitPrice = entry.target;
        exitDate = bar.date;
        closedAt = j;
        break;
      }
      if (daysHeld >= SWING_MAX_HOLD_TRADING_DAYS) {
        exitReason = 'TIME';
        exitPrice = bar.close;
        exitDate = bar.date;
        closedAt = j;
        break;
      }
    }

    if (closedAt < 0 || exitDate == null) {
      // Ran out of candle history before the trade resolved — can't score it, skip.
      i += 1;
      continue;
    }

    trades.push({
      symbol,
      entryDate: entry.asOfDate,
      entryPrice: entry.entry,
      stop: entry.stop,
      target: entry.target,
      exitDate,
      exitPrice,
      exitReason,
      rMultiple: (exitPrice - entry.entry) / entry.riskPerShareRs,
      pnlPct: ((exitPrice - entry.entry) / entry.entry) * 100,
      daysHeld,
      win: exitPrice > entry.entry,
    });
    i = closedAt + 1;
  }

  return trades;
}

export interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  avgRMultiple: number;
  avgWinRMultiple: number;
  avgLossRMultiple: number;
  profitFactor: number | null;
  avgDaysHeld: number;
  byExitReason: Record<'TARGET' | 'STOP' | 'TIME', number>;
}

export function summarizeBacktest(trades: BacktestTrade[]): BacktestSummary {
  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

  const grossWinR = sum(wins.map((t) => t.rMultiple));
  const grossLossR = Math.abs(sum(losses.map((t) => t.rMultiple)));

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgRMultiple: avg(trades.map((t) => t.rMultiple)),
    avgWinRMultiple: avg(wins.map((t) => t.rMultiple)),
    avgLossRMultiple: avg(losses.map((t) => t.rMultiple)),
    profitFactor: grossLossR > 0 ? grossWinR / grossLossR : null,
    avgDaysHeld: avg(trades.map((t) => t.daysHeld)),
    byExitReason: {
      TARGET: trades.filter((t) => t.exitReason === 'TARGET').length,
      STOP: trades.filter((t) => t.exitReason === 'STOP').length,
      TIME: trades.filter((t) => t.exitReason === 'TIME').length,
    },
  };
}

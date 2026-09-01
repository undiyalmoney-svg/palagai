import { Candle } from '../../../models/candle.model';
import { intradayRoundTripCostRs } from './intraday-costs.util';

/**
 * Shared intraday simulation engine. Strategies (ORB, pivot S/R) only decide *when* a
 * signal fires and at what levels; everything about slot allocation, position sizing,
 * exit simulation and costing lives here so both strategies are scored identically.
 */

/** Hard square-off — MIS positions must be flat before the broker force-closes them. */
export const SQUARE_OFF_HHMM = '15:15';
/** No fresh entries after this: a breakout at 15:05 has no room to work. */
export const LAST_ENTRY_HHMM = '14:30';
/** Below this a position is too small for the move to outrun its own costs. */
export const MIN_POSITION_RS = 2_500;
/** Ceiling on concurrent positions, regardless of capital. */
export const MAX_POSITIONS_CAP = 10;

export function dayOf(candleDate: string): string {
  return candleDate.slice(0, 10);
}

export function hhmmOf(candleDate: string): string {
  return candleDate.slice(11, 16);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * How many stocks to hold at once, and how much capital each gets. Rather than always
 * splitting into a fixed number of slots, this keeps each position above MIN_POSITION_RS —
 * small capital concentrates into fewer names instead of being diced into positions so
 * small that charges eat the move.
 */
export interface CapitalPlan {
  positions: number;
  perPositionRs: number;
}

export function planIntradayCapital(capitalRs: number, maxPositions = MAX_POSITIONS_CAP): CapitalPlan {
  if (!(capitalRs > 0)) {
    return { positions: 0, perPositionRs: 0 };
  }
  const affordable = Math.floor(capitalRs / MIN_POSITION_RS);
  const positions = Math.max(1, Math.min(maxPositions, affordable));
  return { positions, perPositionRs: capitalRs / positions };
}

export type IntradayDirection = 'LONG' | 'SHORT';

/** What a strategy emits for one symbol on one day. */
export interface IntradaySignal {
  symbol: string;
  /** Index into that day's candle array where the signal fired. */
  triggerIndex: number;
  triggerTime: string;
  direction: IntradayDirection;
  entryPrice: number;
  stop: number;
  target: number;
  /** Used only to break ties when several signals fire on the same candle. */
  quality: number;
}

export type IntradayExitReason = 'TARGET' | 'STOP' | 'SQUARE_OFF';

export interface IntradayTrade {
  date: string;
  symbol: string;
  direction: IntradayDirection;
  entryTime: string;
  entryPrice: number;
  stop: number;
  target: number;
  exitTime: string;
  exitPrice: number;
  exitReason: IntradayExitReason;
  qty: number;
  grossPnlRs: number;
  costRs: number;
  pnlRs: number;
  win: boolean;
}

export interface IntradayDayResult {
  date: string;
  signalsFound: number;
  trades: IntradayTrade[];
  dayPnlRs: number;
  cumulativePnlRs: number;
}

export interface IntradaySummary {
  days: number;
  tradingDays: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnlRs: number;
  grossPnlRs: number;
  totalCostRs: number;
  avgDailyPnlRs: number;
  greenDays: number;
  redDays: number;
  dayWinRatePct: number;
  bestDayRs: number;
  worstDayRs: number;
  maxDrawdownRs: number;
  byExitReason: Record<IntradayExitReason, number>;
}

export interface IntradayBacktestResult {
  days: IntradayDayResult[];
  summary: IntradaySummary;
}

/** Groups a symbol's candles by trading date, preserving order. */
export function groupByDay(candles: Candle[]): Map<string, Candle[]> {
  const out = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = dayOf(c.date);
    const list = out.get(d);
    if (list) list.push(c);
    else out.set(d, [c]);
  }
  return out;
}

/**
 * Simulates one signal forward through the rest of its day.
 * Conservative on ambiguity: if a candle touches both stop and target, STOP wins.
 */
function simulateExit(
  dayCandles: Candle[],
  signal: IntradaySignal,
): { exitPrice: number; exitTime: string; exitReason: IntradayExitReason } {
  const long = signal.direction === 'LONG';
  for (let i = signal.triggerIndex + 1; i < dayCandles.length; i += 1) {
    const bar = dayCandles[i]!;
    const t = hhmmOf(bar.date);
    if (toMinutes(t) >= toMinutes(SQUARE_OFF_HHMM)) {
      return { exitPrice: bar.open, exitTime: t, exitReason: 'SQUARE_OFF' };
    }
    if (long) {
      if (bar.low <= signal.stop) return { exitPrice: signal.stop, exitTime: t, exitReason: 'STOP' };
      if (bar.high >= signal.target) return { exitPrice: signal.target, exitTime: t, exitReason: 'TARGET' };
    } else {
      if (bar.high >= signal.stop) return { exitPrice: signal.stop, exitTime: t, exitReason: 'STOP' };
      if (bar.low <= signal.target) return { exitPrice: signal.target, exitTime: t, exitReason: 'TARGET' };
    }
  }
  const last = dayCandles[dayCandles.length - 1]!;
  return { exitPrice: last.close, exitTime: hhmmOf(last.date), exitReason: 'SQUARE_OFF' };
}

/**
 * Runs a per-symbol signal generator across every day and simulates the resulting book.
 *
 * Slot allocation is strictly first-come-first-served in trigger-time order. This matters:
 * ranking the day's signals by how well they turned out — or even by quality across the
 * whole day — would be look-ahead bias, since at 10:20 you cannot know which stock will
 * break out at 14:00. Ties inside the same candle break on `quality`, which is knowable.
 */
export function runIntradayBacktest(params: {
  candlesBySymbol: Map<string, Candle[]>;
  capitalRs: number;
  maxPositions?: number;
  generateSignal: (symbol: string, dayCandles: Candle[], prevDayCandles: Candle[] | null) => IntradaySignal | null;
}): IntradayBacktestResult {
  const { candlesBySymbol, capitalRs, generateSignal } = params;
  const plan = planIntradayCapital(capitalRs, params.maxPositions ?? MAX_POSITIONS_CAP);

  const perSymbolDays = new Map<string, Map<string, Candle[]>>();
  const allDates = new Set<string>();
  for (const [symbol, candles] of candlesBySymbol) {
    const byDay = groupByDay(candles);
    perSymbolDays.set(symbol, byDay);
    for (const d of byDay.keys()) allDates.add(d);
  }
  const dates = [...allDates].sort();

  const dayResults: IntradayDayResult[] = [];
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (let di = 0; di < dates.length; di += 1) {
    const date = dates[di]!;
    const prevDate = di > 0 ? dates[di - 1]! : null;

    const signals: { signal: IntradaySignal; dayCandles: Candle[] }[] = [];
    for (const [symbol, byDay] of perSymbolDays) {
      const dayCandles = byDay.get(date);
      if (!dayCandles || dayCandles.length < 2) continue;
      const prevDayCandles = prevDate ? byDay.get(prevDate) ?? null : null;
      const signal = generateSignal(symbol, dayCandles, prevDayCandles);
      if (signal) signals.push({ signal, dayCandles });
    }

    signals.sort((a, b) => {
      if (a.signal.triggerIndex !== b.signal.triggerIndex) {
        return a.signal.triggerIndex - b.signal.triggerIndex;
      }
      return b.signal.quality - a.signal.quality;
    });

    const taken = signals.slice(0, plan.positions);
    const trades: IntradayTrade[] = [];

    for (const { signal, dayCandles } of taken) {
      const qty = Math.max(0, Math.floor(plan.perPositionRs / signal.entryPrice));
      if (qty <= 0) continue;
      const exit = simulateExit(dayCandles, signal);
      const gross =
        signal.direction === 'LONG'
          ? (exit.exitPrice - signal.entryPrice) * qty
          : (signal.entryPrice - exit.exitPrice) * qty;
      const costRs = intradayRoundTripCostRs(
        signal.entryPrice,
        exit.exitPrice,
        qty,
        signal.direction,
      ).totalRs;
      const net = gross - costRs;
      trades.push({
        date,
        symbol: signal.symbol,
        direction: signal.direction,
        entryTime: signal.triggerTime,
        entryPrice: signal.entryPrice,
        stop: signal.stop,
        target: signal.target,
        exitTime: exit.exitTime,
        exitPrice: exit.exitPrice,
        exitReason: exit.exitReason,
        qty,
        grossPnlRs: gross,
        costRs,
        pnlRs: net,
        win: net > 0,
      });
    }

    const dayPnlRs = trades.reduce((a, t) => a + t.pnlRs, 0);
    cumulative += dayPnlRs;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);

    dayResults.push({
      date,
      signalsFound: signals.length,
      trades,
      dayPnlRs,
      cumulativePnlRs: cumulative,
    });
  }

  const allTrades = dayResults.flatMap((d) => d.trades);
  const wins = allTrades.filter((t) => t.win);
  const activeDays = dayResults.filter((d) => d.trades.length > 0);
  const greenDays = activeDays.filter((d) => d.dayPnlRs > 0);
  const redDays = activeDays.filter((d) => d.dayPnlRs < 0);

  const summary: IntradaySummary = {
    days: dayResults.length,
    tradingDays: activeDays.length,
    totalTrades: allTrades.length,
    wins: wins.length,
    losses: allTrades.length - wins.length,
    winRatePct: allTrades.length ? (wins.length / allTrades.length) * 100 : 0,
    totalPnlRs: cumulative,
    grossPnlRs: allTrades.reduce((a, t) => a + t.grossPnlRs, 0),
    totalCostRs: allTrades.reduce((a, t) => a + t.costRs, 0),
    avgDailyPnlRs: activeDays.length ? cumulative / activeDays.length : 0,
    greenDays: greenDays.length,
    redDays: redDays.length,
    dayWinRatePct: activeDays.length ? (greenDays.length / activeDays.length) * 100 : 0,
    bestDayRs: dayResults.length ? Math.max(...dayResults.map((d) => d.dayPnlRs)) : 0,
    worstDayRs: dayResults.length ? Math.min(...dayResults.map((d) => d.dayPnlRs)) : 0,
    maxDrawdownRs: maxDrawdown,
    byExitReason: {
      TARGET: allTrades.filter((t) => t.exitReason === 'TARGET').length,
      STOP: allTrades.filter((t) => t.exitReason === 'STOP').length,
      SQUARE_OFF: allTrades.filter((t) => t.exitReason === 'SQUARE_OFF').length,
    },
  };

  return { days: dayResults, summary };
}

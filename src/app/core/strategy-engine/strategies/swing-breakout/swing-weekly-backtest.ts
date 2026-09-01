import { Candle } from '../../../models/candle.model';
import {
  SWING_REWARD_MULTIPLE,
  SwingEntrySignal,
  evaluateSwingEntry,
} from './swing-breakout.evaluator';
import { roundTripCostRs } from './swing-costs.util';

/**
 * Skip a pick when Monday's open gaps this far from the Friday signal close. Past this,
 * the price paid has nothing to do with the level that triggered the signal — you are
 * chasing, and the reward:risk the setup was chosen for no longer exists.
 */
const MAX_ENTRY_GAP_PCT = 0.03;

/**
 * Market-regime filter: only take long breakouts while the index itself is above its own
 * long moving average. This is a structural rule ("don't buy breakouts into a falling
 * market"), not a parameter fitted to any particular result — buying strength works when
 * the broad market is rising and fails persistently when it isn't.
 */
export const REGIME_MA_PERIOD = 50;

/**
 * Trading dates (YYYY-MM-DD) on which the index closed above its own `REGIME_MA_PERIOD`
 * SMA. Used to gate which scan dates are allowed to produce picks. Only bars at or after
 * the MA is fully warmed up can qualify, so early dates are simply absent from the set.
 */
export function buildRegimeUpDates(indexCandles: Candle[]): Set<string> {
  const up = new Set<string>();
  let rollingSum = 0;
  for (let i = 0; i < indexCandles.length; i += 1) {
    const bar = indexCandles[i]!;
    rollingSum += bar.close;
    if (i >= REGIME_MA_PERIOD) {
      rollingSum -= indexCandles[i - REGIME_MA_PERIOD]!.close;
    }
    if (i < REGIME_MA_PERIOD - 1) continue;
    const ma = rollingSum / REGIME_MA_PERIOD;
    if (bar.close > ma) {
      up.add(bar.date.slice(0, 10));
    }
  }
  return up;
}

/**
 * "Weekly Top-3 pre-order" backtest — a specific operating rule, distinct from the
 * continuous per-symbol backtest in swing-breakout.evaluator.ts:
 *
 * 1. Scan every Friday close (the last trading day of the week) across the whole universe.
 * 2. Rank every qualifying breakout by volume surge (volumeRatio) and take the top N (default 3).
 * 3. "Pre-order" each pick — fill simulated at the FOLLOWING week's Monday open (or first
 *    trading day if Monday is a holiday), not at Friday's signal close. Stop/target are the
 *    levels evaluateSwingEntry computed off the Friday close.
 * 4. Exit on stop or target touch during that week, else force-exit at the week's last
 *    trading day — approximated by that day's CLOSE, since only daily candles are available
 *    (no real 2:30 PM intraday print to exit against).
 * 5. Capital is split evenly across the N slots every week, whether or not all N slots find
 *    a qualifying pick that week (an empty slot just sits idle).
 *
 * Trading weeks are derived from the actual union of trading dates seen across the fetched
 * candles, not wall-clock Mon–Fri, so an exchange holiday shortens a week correctly instead
 * of silently misaligning entries/exits.
 */

export interface WeeklyPickTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  stop: number;
  target: number;
  exitDate: string;
  exitPrice: number;
  exitReason: 'TARGET' | 'STOP' | 'TIME';
  qty: number;
  /** Gross move before any charges. */
  grossPnlRs: number;
  /** STT + stamp + exchange + GST + DP charge for the round trip. */
  costRs: number;
  /** grossPnlRs − costRs. This is the number that matters. */
  pnlRs: number;
  win: boolean;
}

export interface WeeklyBacktestWeek {
  scanDate: string;
  weekStart: string;
  weekEnd: string;
  candidatesFound: number;
  picks: WeeklyPickTrade[];
  weekPnlRs: number;
  cumulativePnlRs: number;
  /** False when the regime filter stood the week down (index below its MA). */
  regimeOk: boolean;
}

export interface WeeklyBacktestSummary {
  weeks: number;
  weeksWithPicks: number;
  totalPicks: number;
  wins: number;
  losses: number;
  pickWinRatePct: number;
  winningWeeks: number;
  weekWinRatePct: number;
  totalPnlRs: number;
  avgWeeklyPnlRs: number;
  bestWeekPnlRs: number;
  worstWeekPnlRs: number;
  /** Weeks the regime filter stood down (0 when the filter is off). */
  weeksStoodDown: number;
  /** Sum of gross P&L before charges. */
  grossPnlRs: number;
  /** Sum of all brokerage/STT/DP charges — the gap between gross and net. */
  totalCostRs: number;
}

export interface WeeklyBacktestResult {
  weeks: WeeklyBacktestWeek[];
  summary: WeeklyBacktestSummary;
}

function groupIntoWeeks(dates: string[]): string[][] {
  const weeks: string[][] = [];
  let current: string[] = [];
  let currentWeekKey: string | null = null;
  for (const d of dates) {
    const dt = new Date(`${d}T00:00:00`);
    const day = dt.getDay();
    const monday = new Date(dt);
    const diff = day === 0 ? -6 : 1 - day;
    monday.setDate(monday.getDate() + diff);
    // Build the key from local date parts. toISOString() converts to UTC, which for IST
    // (UTC+5:30) shifts a midnight-local date back to the previous day — grouping still
    // worked by accident, but the key was silently off by one and timezone-dependent.
    const weekKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(
      monday.getDate(),
    ).padStart(2, '0')}`;
    if (weekKey !== currentWeekKey) {
      if (current.length) weeks.push(current);
      current = [];
      currentWeekKey = weekKey;
    }
    current.push(d);
  }
  if (current.length) weeks.push(current);
  return weeks;
}

export function backtestWeeklyTop3(
  candlesBySymbol: Map<string, Candle[]>,
  weeklyCapitalRs: number,
  topN = 3,
  /** When provided, a scan date absent from this set stands the whole week down. */
  regimeUpDates?: Set<string> | null,
): WeeklyBacktestResult {
  const dateSet = new Set<string>();
  for (const candles of candlesBySymbol.values()) {
    for (const c of candles) dateSet.add(c.date.slice(0, 10));
  }
  const allDates = [...dateSet].sort();
  const weeks = groupIntoWeeks(allDates);
  const perPickCapital = topN > 0 ? weeklyCapitalRs / topN : 0;

  const weekResults: WeeklyBacktestWeek[] = [];
  let cumulative = 0;

  for (let w = 0; w < weeks.length - 1; w += 1) {
    const scanWeek = weeks[w]!;
    const holdWeek = weeks[w + 1]!;
    if (!holdWeek.length) continue;
    const scanDate = scanWeek[scanWeek.length - 1]!;
    const entryDateStr = holdWeek[0]!;

    // Regime gate: with the filter on, a scan date where the index closed below its own MA
    // stands the entire week down — no picks, no capital deployed, flat P&L for that week.
    const regimeOk = !regimeUpDates || regimeUpDates.has(scanDate);
    if (!regimeOk) {
      weekResults.push({
        scanDate,
        weekStart: holdWeek[0]!,
        weekEnd: holdWeek[holdWeek.length - 1]!,
        candidatesFound: 0,
        picks: [],
        weekPnlRs: 0,
        cumulativePnlRs: cumulative,
        regimeOk: false,
      });
      continue;
    }

    const candidates: { symbol: string; signal: SwingEntrySignal; candles: Candle[] }[] = [];
    for (const [symbol, candles] of candlesBySymbol) {
      const idx = candles.findIndex((c) => c.date.slice(0, 10) === scanDate);
      if (idx < 0) continue;
      const signal = evaluateSwingEntry(candles.slice(0, idx + 1));
      if (signal) candidates.push({ symbol, signal, candles });
    }
    candidates.sort((a, b) => b.signal.volumeRatio - a.signal.volumeRatio);
    const picks = candidates.slice(0, topN);

    const weekTrades: WeeklyPickTrade[] = [];
    for (const pick of picks) {
      const entryIdx = pick.candles.findIndex((c) => c.date.slice(0, 10) === entryDateStr);
      if (entryIdx < 0) continue;
      const entryBar = pick.candles[entryIdx]!;
      const entryFill = entryBar.open;

      // The signal's levels were computed off the Friday close, but the pre-order fills at
      // Monday's open. On a gap those levels are stale: a big gap up used to fill ABOVE the
      // stale target and get logged as an instant "TARGET" for ~zero profit, while a gap down
      // could fill below the stale stop. Re-anchor to the actual fill, and skip the trade
      // outright when the gap is large enough that the setup no longer holds.
      const signalClose = pick.signal.entry;
      const gapPct = (entryFill - signalClose) / signalClose;
      if (Math.abs(gapPct) > MAX_ENTRY_GAP_PCT) continue;

      const stop = pick.signal.stop;
      if (entryFill <= stop) continue; // gapped through the stop — setup is already broken
      // Keep the technical stop level, but re-derive the target so reward:risk is measured
      // from the price actually paid rather than Friday's close.
      const target = entryFill + (entryFill - stop) * SWING_REWARD_MULTIPLE;

      let exitPrice: number;
      let exitDate: string;
      let exitReason: 'TARGET' | 'STOP' | 'TIME';

      let resolvedPrice: number | null = null;
      let resolvedDate: string | null = null;
      let resolvedReason: 'TARGET' | 'STOP' | null = null;
      for (let k = entryIdx; k < pick.candles.length; k += 1) {
        const bar = pick.candles[k]!;
        const dayStr = bar.date.slice(0, 10);
        if (!holdWeek.includes(dayStr)) break;
        if (bar.low <= stop) {
          resolvedReason = 'STOP';
          resolvedPrice = stop;
          resolvedDate = bar.date;
          break;
        }
        if (bar.high >= target) {
          resolvedReason = 'TARGET';
          resolvedPrice = target;
          resolvedDate = bar.date;
          break;
        }
      }
      if (resolvedReason && resolvedPrice != null && resolvedDate) {
        exitReason = resolvedReason;
        exitPrice = resolvedPrice;
        exitDate = resolvedDate;
      } else {
        const lastDay = holdWeek[holdWeek.length - 1]!;
        const lastBar = pick.candles.find((c) => c.date.slice(0, 10) === lastDay);
        exitReason = 'TIME';
        exitPrice = lastBar ? lastBar.close : entryFill;
        exitDate = lastDay;
      }

      const qty = Math.max(0, Math.floor(perPickCapital / entryFill));
      const grossPnlRs = (exitPrice - entryFill) * qty;
      const costRs = roundTripCostRs(entryFill, exitPrice, qty).totalRs;
      const netPnlRs = grossPnlRs - costRs;
      weekTrades.push({
        symbol: pick.symbol,
        entryDate: entryDateStr,
        entryPrice: entryFill,
        stop,
        target,
        exitDate,
        exitPrice,
        exitReason,
        qty,
        grossPnlRs,
        costRs,
        pnlRs: netPnlRs,
        // A trade is only a win if it beat its own charges, not merely the entry price.
        win: netPnlRs > 0,
      });
    }

    const weekPnlRs = weekTrades.reduce((a, t) => a + t.pnlRs, 0);
    cumulative += weekPnlRs;
    weekResults.push({
      scanDate,
      weekStart: holdWeek[0]!,
      weekEnd: holdWeek[holdWeek.length - 1]!,
      candidatesFound: candidates.length,
      picks: weekTrades,
      weekPnlRs,
      cumulativePnlRs: cumulative,
      regimeOk: true,
    });
  }

  const allPicks = weekResults.flatMap((w) => w.picks);
  const wins = allPicks.filter((p) => p.win);
  const weeksWithPicks = weekResults.filter((w) => w.picks.length > 0);
  const winningWeeks = weeksWithPicks.filter((w) => w.weekPnlRs > 0);

  const summary: WeeklyBacktestSummary = {
    weeks: weekResults.length,
    weeksWithPicks: weeksWithPicks.length,
    totalPicks: allPicks.length,
    wins: wins.length,
    losses: allPicks.length - wins.length,
    pickWinRatePct: allPicks.length ? (wins.length / allPicks.length) * 100 : 0,
    winningWeeks: winningWeeks.length,
    weekWinRatePct: weeksWithPicks.length ? (winningWeeks.length / weeksWithPicks.length) * 100 : 0,
    totalPnlRs: cumulative,
    avgWeeklyPnlRs: weeksWithPicks.length ? cumulative / weeksWithPicks.length : 0,
    bestWeekPnlRs: weekResults.length ? Math.max(...weekResults.map((w) => w.weekPnlRs)) : 0,
    worstWeekPnlRs: weekResults.length ? Math.min(...weekResults.map((w) => w.weekPnlRs)) : 0,
    weeksStoodDown: weekResults.filter((w) => !w.regimeOk).length,
    grossPnlRs: allPicks.reduce((a, p) => a + p.grossPnlRs, 0),
    totalCostRs: allPicks.reduce((a, p) => a + p.costRs, 0),
  };

  return { weeks: weekResults, summary };
}

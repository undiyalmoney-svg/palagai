import { Injectable, inject, signal } from '@angular/core';
import { Candle } from '../models/candle.model';
import { SwingScannerService } from './swing-scanner.service';
import { NIFTY_500_UNIVERSE } from './nifty500-universe';
import {
  WeeklyBacktestSummary,
  WeeklyBacktestWeek,
  backtestWeeklyTop3,
  buildRegimeUpDates,
} from '../strategy-engine/strategies/swing-breakout/swing-weekly-backtest';
import { NIFTY_50_INSTRUMENT } from '../constants/instruments.const';
import { mapWithConcurrency } from '../utils/concurrency.util';
import { resolveMonthRange } from '../utils/month-range.util';

/** Calendar-day padding fetched before the requested window so EMA50/Donchian/swing have warm-up history. */
const INDICATOR_BUFFER_DAYS = 130;
const FETCH_CONCURRENCY = 3;
const FETCH_BATCH_DELAY_MS = 350;
/** Cap how many individual week rows the UI holds — summary stats still use every week found. */
const MAX_WEEK_ROWS = 80;

export interface SwingWeeklyBacktestProgress {
  done: number;
  total: number;
}

export interface SwingWeeklyBacktestOutput {
  weeks: WeeklyBacktestWeek[];
  summary: WeeklyBacktestSummary;
  totalWeeksFound: number;
  symbolsScanned: number;
  symbolsSkipped: number;
  weeklyCapitalRs: number;
  topN: number;
  fromDate: string;
  toDate: string;
  ranAt: string;
  regimeFilterOn: boolean;
  /** Set when the filter was requested but the index candles could not be fetched. */
  regimeFilterNote?: string;
}

@Injectable({ providedIn: 'root' })
export class SwingWeeklyBacktestService {
  private readonly scanner = inject(SwingScannerService);

  readonly result = signal<SwingWeeklyBacktestOutput | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly progress = signal<SwingWeeklyBacktestProgress>({ done: 0, total: 0 });

  async run(
    weeklyCapitalRs: number,
    startMonth: string,
    endMonth: string,
    topN = 3,
    regimeFilterOn = false,
    universe: readonly string[] = NIFTY_500_UNIVERSE,
  ): Promise<void> {
    if (this.busy()) {
      return;
    }
    if (!this.scanner.hasKiteSession()) {
      this.error.set('Kite access token required. Generate token in Get Token tab.');
      return;
    }
    if (!(weeklyCapitalRs > 0) || !(topN > 0)) {
      this.error.set('Enter a valid weekly capital and pick count.');
      return;
    }
    if (!startMonth || !endMonth || startMonth > endMonth) {
      this.error.set('Pick a valid start month → end month range.');
      return;
    }

    const { requestedFrom, requestedTo, fetchFrom } = resolveMonthRange(
      startMonth,
      endMonth,
      INDICATOR_BUFFER_DAYS,
    );

    this.error.set('');
    this.busy.set(true);
    this.progress.set({ done: 0, total: universe.length });
    const candlesBySymbol = new Map<string, Candle[]>();
    let skipped = 0;

    let regimeUpDates: Set<string> | null = null;
    let regimeFilterNote: string | undefined;

    try {
      if (regimeFilterOn) {
        try {
          const indexCandles = await this.scanner.fetchDailyCandlesByToken(
            NIFTY_50_INSTRUMENT.instrumentToken,
            fetchFrom,
            requestedTo,
          );
          if (indexCandles.length) {
            regimeUpDates = buildRegimeUpDates(indexCandles);
          } else {
            regimeFilterNote = 'Nifty 50 candles came back empty — filter was NOT applied.';
          }
        } catch (err) {
          regimeFilterNote = `Could not fetch Nifty 50 candles — filter was NOT applied (${
            err instanceof Error ? err.message : 'unknown error'
          }).`;
        }
      }

      await mapWithConcurrency(
        universe as string[],
        FETCH_CONCURRENCY,
        async (symbol) => {
          try {
            const candles = await this.scanner.fetchDailyCandlesRange(symbol, fetchFrom, requestedTo);
            if (candles.length) {
              candlesBySymbol.set(symbol, candles);
            } else {
              skipped += 1;
            }
          } catch {
            skipped += 1;
          } finally {
            this.progress.update((p) => ({ ...p, done: p.done + 1 }));
          }
        },
        FETCH_BATCH_DELAY_MS,
      );

      const computed = backtestWeeklyTop3(candlesBySymbol, weeklyCapitalRs, topN, regimeUpDates);
      // Scan warm-up produces weeks before the requested window — keep only weeks whose
      // scan (Friday) date falls inside it, then recompute cumulative P&L and summary
      // stats from that filtered set so both reflect exactly the requested range.
      const inWindow = computed.weeks.filter(
        (w) => w.scanDate >= requestedFrom && w.scanDate <= requestedTo,
      );
      let cumulative = 0;
      const rebased: WeeklyBacktestWeek[] = inWindow.map((w) => {
        cumulative += w.weekPnlRs;
        return { ...w, cumulativePnlRs: cumulative };
      });

      const allPicks = rebased.flatMap((w) => w.picks);
      const wins = allPicks.filter((p) => p.win);
      const weeksWithPicks = rebased.filter((w) => w.picks.length > 0);
      const winningWeeks = weeksWithPicks.filter((w) => w.weekPnlRs > 0);
      const summary: WeeklyBacktestSummary = {
        weeks: rebased.length,
        weeksWithPicks: weeksWithPicks.length,
        totalPicks: allPicks.length,
        wins: wins.length,
        losses: allPicks.length - wins.length,
        pickWinRatePct: allPicks.length ? (wins.length / allPicks.length) * 100 : 0,
        winningWeeks: winningWeeks.length,
        weekWinRatePct: weeksWithPicks.length ? (winningWeeks.length / weeksWithPicks.length) * 100 : 0,
        totalPnlRs: cumulative,
        avgWeeklyPnlRs: weeksWithPicks.length ? cumulative / weeksWithPicks.length : 0,
        bestWeekPnlRs: rebased.length ? Math.max(...rebased.map((w) => w.weekPnlRs)) : 0,
        worstWeekPnlRs: rebased.length ? Math.min(...rebased.map((w) => w.weekPnlRs)) : 0,
        weeksStoodDown: rebased.filter((w) => !w.regimeOk).length,
        grossPnlRs: allPicks.reduce((a, p) => a + p.grossPnlRs, 0),
        totalCostRs: allPicks.reduce((a, p) => a + p.costRs, 0),
      };

      const weeksDesc = [...rebased].reverse();
      this.result.set({
        weeks: weeksDesc.slice(0, MAX_WEEK_ROWS),
        summary,
        totalWeeksFound: rebased.length,
        symbolsScanned: universe.length - skipped,
        symbolsSkipped: skipped,
        weeklyCapitalRs,
        topN,
        fromDate: requestedFrom,
        toDate: requestedTo,
        ranAt: new Date().toISOString(),
        regimeFilterOn: regimeFilterOn && regimeUpDates != null,
        regimeFilterNote,
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Weekly backtest failed.');
    } finally {
      this.busy.set(false);
    }
  }
}

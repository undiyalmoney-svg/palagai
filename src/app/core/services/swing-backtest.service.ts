import { Injectable, inject, signal } from '@angular/core';
import { SwingScannerService } from './swing-scanner.service';
import { NIFTY_500_UNIVERSE } from './nifty500-universe';
import {
  BacktestSummary,
  BacktestTrade,
  backtestSwingBreakout,
  summarizeBacktest,
} from '../strategy-engine/strategies/swing-breakout/swing-breakout.evaluator';
import { mapWithConcurrency } from '../utils/concurrency.util';
import { resolveMonthRange, currentMonth, shiftMonth } from '../utils/month-range.util';

/** Default window shown on first load: trailing 24 months. */
export const BACKTEST_DEFAULT_START_MONTH = shiftMonth(currentMonth(), -24);
export const BACKTEST_DEFAULT_END_MONTH = currentMonth();
/** Calendar-day padding fetched before the requested window so EMA50/Donchian/swing have warm-up history. */
const INDICATOR_BUFFER_DAYS = 130;
const BACKTEST_CONCURRENCY = 3;
const BACKTEST_BATCH_DELAY_MS = 350;
/** Cap how many individual trade rows the UI holds — summary stats still use every trade found. */
const MAX_TRADE_ROWS = 500;

export interface SwingBacktestProgress {
  done: number;
  total: number;
}

export interface SwingBacktestResult {
  summary: BacktestSummary;
  trades: BacktestTrade[];
  totalTradesFound: number;
  symbolsScanned: number;
  symbolsSkipped: number;
  fromDate: string;
  toDate: string;
  ranAt: string;
}

@Injectable({ providedIn: 'root' })
export class SwingBacktestService {
  private readonly scanner = inject(SwingScannerService);

  readonly result = signal<SwingBacktestResult | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly progress = signal<SwingBacktestProgress>({ done: 0, total: 0 });

  async run(
    startMonth: string,
    endMonth: string,
    universe: readonly string[] = NIFTY_500_UNIVERSE,
  ): Promise<void> {
    if (this.busy()) {
      return;
    }
    if (!this.scanner.hasKiteSession()) {
      this.error.set('Kite access token required. Generate token in Get Token tab.');
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
    const allTrades: BacktestTrade[] = [];
    let skipped = 0;

    try {
      await mapWithConcurrency(
        universe as string[],
        BACKTEST_CONCURRENCY,
        async (symbol) => {
          try {
            const candles = await this.scanner.fetchDailyCandlesRange(symbol, fetchFrom, requestedTo);
            const trades = backtestSwingBreakout(candles, symbol).filter(
              (t) => t.entryDate.slice(0, 10) >= requestedFrom && t.entryDate.slice(0, 10) <= requestedTo,
            );
            allTrades.push(...trades);
          } catch {
            skipped += 1;
          } finally {
            this.progress.update((p) => ({ ...p, done: p.done + 1 }));
          }
        },
        BACKTEST_BATCH_DELAY_MS,
      );

      allTrades.sort((a, b) => b.exitDate.localeCompare(a.exitDate));
      this.result.set({
        summary: summarizeBacktest(allTrades),
        trades: allTrades.slice(0, MAX_TRADE_ROWS),
        totalTradesFound: allTrades.length,
        symbolsScanned: universe.length - skipped,
        symbolsSkipped: skipped,
        fromDate: requestedFrom,
        toDate: requestedTo,
        ranAt: new Date().toISOString(),
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Backtest failed.');
    } finally {
      this.busy.set(false);
    }
  }
}

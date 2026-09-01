import { Injectable, inject, signal } from '@angular/core';
import { Candle, Timeframe } from '../models/candle.model';
import { SwingScannerService } from './swing-scanner.service';
import { NIFTY_50_UNIVERSE } from './nifty50-universe';
import {
  IntradayBacktestResult,
  IntradayDayResult,
  IntradaySummary,
  MAX_POSITIONS_CAP,
  planIntradayCapital,
  runIntradayBacktest,
} from '../strategy-engine/strategies/intraday/intraday-engine';
import { generateOrbSignal } from '../strategy-engine/strategies/intraday/orb.strategy';
import { generatePivotSrSignal } from '../strategy-engine/strategies/intraday/pivot-sr.strategy';
import { generateExhaustionFadeSignal } from '../strategy-engine/strategies/intraday/exhaustion-fade.strategy';
import { mapWithConcurrency } from '../utils/concurrency.util';
import { resolveMonthRange } from '../utils/month-range.util';

/**
 * Intraday strategies need only one prior session (for pivot levels), so the warm-up
 * buffer is days rather than the months a 50-EMA swing strategy requires.
 */
const WARMUP_DAYS = 7;
const FETCH_CONCURRENCY = 2;
const FETCH_BATCH_DELAY_MS = 400;
/** Cap day rows held for display; summary stats still use every day. */
const MAX_DAY_ROWS = 120;

export type IntradayStrategyId = 'orb' | 'pivot-sr' | 'exhaustion-fade';

export const INTRADAY_STRATEGY_OPTIONS: { id: IntradayStrategyId; label: string; blurb: string }[] = [
  { id: 'orb', label: 'Opening range breakout', blurb: 'Skip the first hour, trade the break of its high/low' },
  { id: 'pivot-sr', label: 'Support / resistance', blurb: 'Buy rejections of S1, sell rejections of R1' },
  { id: 'exhaustion-fade', label: 'Exhaustion fade', blurb: 'Fade a volume-climax blow-off — trade the crowd exhaustion, most days no trade' },
];

export interface IntradayProgress {
  done: number;
  total: number;
}

export interface IntradayBacktestOutput {
  days: IntradayDayResult[];
  summary: IntradaySummary;
  totalDaysFound: number;
  strategyId: IntradayStrategyId;
  strategyLabel: string;
  capitalRs: number;
  positions: number;
  perPositionRs: number;
  interval: Timeframe;
  symbolsScanned: number;
  symbolsSkipped: number;
  fromDate: string;
  toDate: string;
  ranAt: string;
}

@Injectable({ providedIn: 'root' })
export class IntradayBacktestService {
  private readonly scanner = inject(SwingScannerService);

  readonly result = signal<IntradayBacktestOutput | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly progress = signal<IntradayProgress>({ done: 0, total: 0 });

  async run(params: {
    strategyId: IntradayStrategyId;
    capitalRs: number;
    startMonth: string;
    endMonth: string;
    interval?: Timeframe;
    maxPositions?: number;
    universe?: readonly string[];
  }): Promise<void> {
    if (this.busy()) return;

    const {
      strategyId,
      capitalRs,
      startMonth,
      endMonth,
      interval = '5minute',
      maxPositions = MAX_POSITIONS_CAP,
      universe = NIFTY_50_UNIVERSE,
    } = params;

    if (!this.scanner.hasKiteSession()) {
      this.error.set('Kite access token required. Generate token in Get Token tab.');
      return;
    }
    if (!(capitalRs > 0)) {
      this.error.set('Enter a valid capital amount.');
      return;
    }
    if (!startMonth || !endMonth || startMonth > endMonth) {
      this.error.set('Pick a valid start month → end month range.');
      return;
    }

    const { requestedFrom, requestedTo, fetchFrom } = resolveMonthRange(
      startMonth,
      endMonth,
      WARMUP_DAYS,
    );

    this.error.set('');
    this.busy.set(true);
    this.progress.set({ done: 0, total: universe.length });
    const candlesBySymbol = new Map<string, Candle[]>();
    let skipped = 0;

    try {
      await mapWithConcurrency(
        universe as string[],
        FETCH_CONCURRENCY,
        async (symbol) => {
          try {
            const candles = await this.scanner.fetchIntradayCandlesRange(
              symbol,
              fetchFrom,
              requestedTo,
              interval,
            );
            if (candles.length) candlesBySymbol.set(symbol, candles);
            else skipped += 1;
          } catch {
            skipped += 1;
          } finally {
            this.progress.update((p) => ({ ...p, done: p.done + 1 }));
          }
        },
        FETCH_BATCH_DELAY_MS,
      );

      if (!candlesBySymbol.size) {
        this.error.set('No intraday candles came back — check the Kite session and date range.');
        return;
      }

      const generateSignal =
        strategyId === 'exhaustion-fade'
          ? (symbol: string, dayCandles: Candle[]) => generateExhaustionFadeSignal(symbol, dayCandles)
          : strategyId === 'orb'
          ? (symbol: string, dayCandles: Candle[]) => generateOrbSignal(symbol, dayCandles)
          : (symbol: string, dayCandles: Candle[], prevDayCandles: Candle[] | null) =>
              generatePivotSrSignal(symbol, dayCandles, prevDayCandles);

      const computed: IntradayBacktestResult = runIntradayBacktest({
        candlesBySymbol,
        capitalRs,
        maxPositions,
        generateSignal,
      });

      // The warm-up days exist only to give the first real day its prior session — drop
      // them, then rebuild cumulative P&L and summary stats from the requested window.
      const inWindow = computed.days.filter((d) => d.date >= requestedFrom && d.date <= requestedTo);
      let cumulative = 0;
      let peak = 0;
      let maxDrawdown = 0;
      const rebased: IntradayDayResult[] = inWindow.map((d) => {
        cumulative += d.dayPnlRs;
        peak = Math.max(peak, cumulative);
        maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
        return { ...d, cumulativePnlRs: cumulative };
      });

      const allTrades = rebased.flatMap((d) => d.trades);
      const wins = allTrades.filter((t) => t.win);
      const activeDays = rebased.filter((d) => d.trades.length > 0);
      const greenDays = activeDays.filter((d) => d.dayPnlRs > 0);
      const redDays = activeDays.filter((d) => d.dayPnlRs < 0);

      const summary: IntradaySummary = {
        days: rebased.length,
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
        bestDayRs: rebased.length ? Math.max(...rebased.map((d) => d.dayPnlRs)) : 0,
        worstDayRs: rebased.length ? Math.min(...rebased.map((d) => d.dayPnlRs)) : 0,
        maxDrawdownRs: maxDrawdown,
        byExitReason: {
          TARGET: allTrades.filter((t) => t.exitReason === 'TARGET').length,
          STOP: allTrades.filter((t) => t.exitReason === 'STOP').length,
          SQUARE_OFF: allTrades.filter((t) => t.exitReason === 'SQUARE_OFF').length,
        },
      };

      const plan = planIntradayCapital(capitalRs, maxPositions);
      const option = INTRADAY_STRATEGY_OPTIONS.find((o) => o.id === strategyId);

      this.result.set({
        days: [...rebased].reverse().slice(0, MAX_DAY_ROWS),
        summary,
        totalDaysFound: rebased.length,
        strategyId,
        strategyLabel: option?.label ?? strategyId,
        capitalRs,
        positions: plan.positions,
        perPositionRs: plan.perPositionRs,
        interval,
        symbolsScanned: universe.length - skipped,
        symbolsSkipped: skipped,
        fromDate: requestedFrom,
        toDate: requestedTo,
        ranAt: new Date().toISOString(),
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Intraday backtest failed.');
    } finally {
      this.busy.set(false);
    }
  }
}

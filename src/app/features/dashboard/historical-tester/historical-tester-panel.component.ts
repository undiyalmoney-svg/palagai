import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DecimalPipe, JsonPipe } from '@angular/common';
import { HistoricalTrade, StrategyTestResult } from '../../../core/models/historical-test.model';
import { ReplayEngineService } from '../../../core/services/replay-engine.service';
import { SignalAction } from '../../../core/strategy-engine/models/module-result.model';
import { HistoricalTesterSessionService } from '../../../core/services/historical-tester-session.service';
import { InstrumentStoreService } from '../../../core/services/instrument-store.service';
import { getTesterInstrument } from '../../../core/constants/instruments.const';
import {
  isCrudeOilInstrumentId,
  isBankNiftyInstrumentId,
  isNifty50InstrumentId,
  resolveCrudeOilFuturesToken,
} from '../../../core/utils/instrument-resolver.util';
import {
  extractTradeDate,
  formatDayOfWeek,
  formatDisplayDate,
  formatTradeTime,
  listDatesInRange,
} from '../../../core/utils/trade-date.util';
import { STRATEGY_IDS, ACTIVE_STRATEGY_IDS } from '../../../core/config/strategy-ids.config';
import { StrategyEngineService } from '../../../core/strategies/registry/strategy-engine.service';

interface PriceActionDisplay {
  tradingDay?: string;
  trend?: string;
  trend30m?: string;
  support?: number;
  resistance?: number;
  breakout?: number | null;
  retest?: number | null;
  confirmationCandle?: string;
  qualityScore?: number;
  entry?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  target3?: number;
  riskReward?: number;
  tradeTaken?: string;
  reason?: string;
  finalDecision?: string;
}

interface PdhlOpeningRangeOutputDisplay {
  tradingDate?: string;
  time?: string;
  strategy?: string;
  bias?: string;
  swingHigh?: number;
  swingLow?: number;
  orHigh?: number;
  orLow?: number;
  riskPts?: number;
  targetPts?: number;
  dayNetPts?: number;
  finalDecision?: string;
  reason?: string;
}

interface SignalDebugDisplay {
  marketRegime?: string;
  strategyStatus?: string;
  currentStep?: string;
  blockingRule?: string;
  expectedValue?: string;
  actualValue?: string;
  nextConditionRequired?: string;
  steps?: { name: string; status: string; expectedValue?: string; actualValue?: string }[];
  entryQuality?: {
    trendAlignment: number;
    breakoutStrength: number;
    structureQuality: number;
    confirmationCandle: number;
    riskReward: number;
    total: number;
  };
}

interface SparDisplay {
  tradingDate?: string;
  finalDecision?: string;
  trend60m?: string;
  trend30m?: string;
  pullbackDetected?: string;
  breakOfStructure?: string;
  retest?: string;
  confirmationCandle?: string;
  qualityScore?: number;
  entryPrice?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  target3?: number;
  riskRewardRatio?: number;
  tradeTaken?: string;
  reason?: string;
}

interface MomentumFilterDisplay {
  currentOhlc?: { open: number; high: number; low: number; close: number };
  momentumScore?: { bullish: number; bearish: number; winning: number };
  marketState?: string;
  sidewaysScore?: number;
  priceCompression?: boolean;
  structureWeakness?: boolean;
  overlapCount?: number;
  failedBreakouts?: number;
  currentTrend?: string;
  tradeAllowed?: string;
  reason?: string;
  finalDecision?: string;
  earlyExitStatus?: string;
}

@Component({
  selector: 'app-historical-tester-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    DecimalPipe,
    JsonPipe,
  ],
  templateUrl: './historical-tester-panel.component.html',
  styleUrl: './historical-tester.component.css',
})
export class HistoricalTesterPanelComponent implements OnInit {
  readonly instrumentId = input.required<string>();

  private readonly formBuilder = inject(FormBuilder);
  private readonly replayEngine = inject(ReplayEngineService);
  private readonly session = inject(HistoricalTesterSessionService);
  private readonly instrumentStore = inject(InstrumentStoreService);
  private readonly strategyEngine = inject(StrategyEngineService);

  protected readonly activeStrategies = computed(() => this.strategyEngine.getActiveStrategyInfo());

  protected readonly instrument = computed(() => getTesterInstrument(this.instrumentId()));
  protected readonly resolvedContract = signal<{ tradingSymbol: string; instrumentToken: number } | null>(
    null,
  );

  protected readonly isRunning = this.replayEngine.isRunning;
  protected readonly status = this.replayEngine.status;
  protected readonly progress = this.replayEngine.progress;
  protected readonly debugSnapshot = this.replayEngine.debugSnapshot;
  protected readonly lossPatternAnalysis = this.replayEngine.lossPatternAnalysis;
  protected readonly comparisonResults = signal<StrategyTestResult[]>([]);
  protected readonly tradeHistory = signal<HistoricalTrade[]>([]);
  protected readonly bestStrategyId = signal('');
  protected readonly errorMessage = signal('');
  protected readonly backtestCompleted = signal(false);
  protected readonly testFromDate = signal('');
  protected readonly testToDate = signal('');
  protected readonly marketRegimeSummary = signal<
    import('../../../core/reporting/utils/market-regime-report.util').MarketRegimeSummary | null
  >(null);

  protected readonly showLiveOutput = computed(
    () => this.session.lastRunInstrumentId() === this.instrumentId(),
  );

  protected readonly dailyTradeGroups = computed(() => {
    const trades = this.tradeHistory();
    const fromDate = this.testFromDate();
    const toDate = this.testToDate();
    if (!fromDate || !toDate) {
      return [];
    }

    const tradesByDate = new Map<string, HistoricalTrade[]>();
    for (const trade of trades) {
      const date = extractTradeDate(trade.entryTime);
      const list = tradesByDate.get(date) ?? [];
      list.push(trade);
      tradesByDate.set(date, list);
    }

    return listDatesInRange(fromDate, toDate).map((date) => {
      const dayTrades = (tradesByDate.get(date) ?? []).sort((a, b) =>
        a.entryTime.localeCompare(b.entryTime),
      );
      return {
        date,
        displayDate: formatDisplayDate(date),
        trades: dayTrades,
        netPoints: dayTrades.reduce((sum, trade) => sum + trade.points, 0),
        wins: dayTrades.filter((trade) => trade.outcome === 'WIN').length,
        losses: dayTrades.filter((trade) => trade.outcome === 'LOSS').length,
      };
    });
  });

  protected readonly profitOnlyList = computed(() =>
    this.tradeHistory()
      .filter((trade) => trade.profitLoss > 0)
      .map((trade) => {
        const date = extractTradeDate(trade.exitTime);
        return {
          day: formatDayOfWeek(date),
          date,
          displayDate: formatDisplayDate(date),
          time: formatTradeTime(trade.exitTime),
          netProfit: trade.profitLoss,
        };
      })
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)),
  );

  /** Combined wins + losses across all strategies in this backtest. */
  protected readonly overallTradeSummary = computed(() => {
    const trades = this.tradeHistory();
    let grossProfit = 0;
    let grossLoss = 0;
    let wins = 0;
    let losses = 0;

    for (const trade of trades) {
      if (trade.points > 0) {
        grossProfit += trade.points;
        wins += 1;
      } else if (trade.points < 0) {
        grossLoss += trade.points;
        losses += 1;
      }
    }

    const netPoints = grossProfit + grossLoss;
    const rupeesPerPoint = isCrudeOilInstrumentId(this.instrumentId()) ? 100 : 65;

    return {
      totalTrades: trades.length,
      wins,
      losses,
      grossProfit,
      grossLoss,
      netPoints,
      netRupees: netPoints * rupeesPerPoint,
      rupeesPerPoint,
    };
  });

  protected readonly totalWinningPoints = computed(() => this.overallTradeSummary().grossProfit);

  protected readonly totalNetProfit = computed(() => this.overallTradeSummary().netPoints);

  protected readonly monthlyTradeGroups = computed(() => {
    const trades = this.tradeHistory();
    const byMonth = new Map<string, { month: string; trades: HistoricalTrade[]; netPoints: number }>();

    for (const trade of trades) {
      const date = extractTradeDate(trade.entryTime);
      const month = date.slice(0, 7);
      const entry = byMonth.get(month) ?? { month, trades: [], netPoints: 0 };
      entry.trades.push(trade);
      entry.netPoints += trade.points;
      byMonth.set(month, entry);
    }

    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  });

  protected readonly totalTradingDays = computed(() => this.dailyTradeGroups().length);

  protected readonly timelinePhases = ['Trend', 'Structure', 'Entry', 'Trade', 'Exit'];
  protected readonly strategyIds = STRATEGY_IDS;

  protected readonly form = this.formBuilder.nonNullable.group({
    fromDate: ['2026-06-01', Validators.required],
    fromTime: ['09:15', Validators.required],
    toDate: ['2026-06-30', Validators.required],
    toTime: ['15:30', Validators.required],
  });

  ngOnInit(): void {
    if (isCrudeOilInstrumentId(this.instrumentId())) {
      this.form.patchValue({
        fromTime: '09:00',
        toTime: '23:15',
      });
    }
  }

  protected async runBacktest(): Promise<void> {
    const instrument = this.instrument();
    if (!instrument || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const values = this.form.getRawValue();
    this.errorMessage.set('');
    this.backtestCompleted.set(false);
    this.comparisonResults.set([]);
    this.tradeHistory.set([]);
    this.marketRegimeSummary.set(null);
    this.testFromDate.set(values.fromDate);
    this.testToDate.set(values.toDate);
    this.session.markRun(instrument.id);

    try {
      const { instrumentToken, instrumentSymbol } = await this.resolveInstrumentForRun(instrument);

      const test = await this.replayEngine.run({
        instrumentToken,
        instrumentSymbol,
        instrumentId: instrument.id,
        exchange: instrument.exchange,
        fromDateTime: this.toDateTime(values.fromDate, values.fromTime),
        toDateTime: this.toDateTime(values.toDate, values.toTime),
      });

      const activeResults = test.strategyResults.filter((r) => ACTIVE_STRATEGY_IDS.has(r.strategyId));
      const activeTrades = test.trades.filter((t) => ACTIVE_STRATEGY_IDS.has(t.strategyId));

      if (activeResults.length !== test.strategyResults.length) {
        this.errorMessage.set(
          'Legacy strategies were filtered out. Hard-refresh the page (Cmd+Shift+R) if you still see Strategy 1/2/3.',
        );
      }

      this.comparisonResults.set(activeResults);
      this.tradeHistory.set(activeTrades);
      this.marketRegimeSummary.set(test.marketRegimeSummary ?? null);
      this.bestStrategyId.set(activeResults[0]?.strategyId ?? '');
      this.backtestCompleted.set(true);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Backtest failed.');
    }
  }

  protected tradesForStrategy(strategyId: string): HistoricalTrade[] {
    return this.tradeHistory().filter((t) => t.strategyId === strategyId);
  }

  protected formatTime(timestamp: string): string {
    return formatTradeTime(timestamp);
  }

  protected isBuySignal(type: SignalAction): boolean {
    return type.includes('BUY');
  }

  protected isSellSignal(type: SignalAction): boolean {
    return type.includes('SELL');
  }

  protected momentumFilters(signal: { analysis: Record<string, unknown> }): MomentumFilterDisplay | null {
    const filters = signal.analysis['momentumFilters'];
    return filters && typeof filters === 'object' ? (filters as MomentumFilterDisplay) : null;
  }

  protected priceActionOutput(signal: { analysis: Record<string, unknown> }): PriceActionDisplay | null {
    if (!signal.analysis['tradingDay']) {
      return null;
    }
    return signal.analysis as PriceActionDisplay;
  }

  protected sparOutput(signal: { analysis: Record<string, unknown> }): SparDisplay | null {
    if (!signal.analysis['tradingDate']) {
      return null;
    }
    return signal.analysis as SparDisplay;
  }

  protected signalDebug(signal: { analysis: Record<string, unknown> }): SignalDebugDisplay | null {
    const debug = signal.analysis['debug'];
    return debug && typeof debug === 'object' ? (debug as SignalDebugDisplay) : null;
  }

  protected pdhlOpeningRangeOutput(
    signal: { analysis: Record<string, unknown> },
  ): PdhlOpeningRangeOutputDisplay {
    return signal.analysis as PdhlOpeningRangeOutputDisplay;
  }

  protected riskPts(entry: number, stopLoss: number): number {
    return Math.abs(entry - stopLoss);
  }

  protected debugStatus(passed: boolean | undefined): string {
    return passed ? 'PASS' : 'FAIL';
  }

  protected tradesForStrategyByMonth(strategyId: string, month: string): HistoricalTrade[] {
    return this.tradesForStrategy(strategyId).filter(
      (t) => extractTradeDate(t.entryTime).slice(0, 7) === month,
    );
  }

  protected isTimelineActive(current: string, phase: string): boolean {
    return current === phase;
  }

  protected isTimelinePast(phases: string[], current: string, phase: string): boolean {
    return phases.indexOf(phase) < phases.indexOf(current);
  }

  private toDateTime(date: string, time: string): string {
    return `${date} ${time}:00`;
  }

  private async resolveInstrumentForRun(
    instrument: NonNullable<ReturnType<typeof getTesterInstrument>>,
  ): Promise<{ instrumentToken: number; instrumentSymbol: string }> {
    if (isCrudeOilInstrumentId(instrument.id)) {
      const resolved = await this.tryResolveCrudeContract();
      if (resolved) {
        return resolved;
      }
      this.resolvedContract.set(null);
      return {
        instrumentToken: instrument.instrumentToken,
        instrumentSymbol: instrument.tradingSymbol,
      };
    }

    // Research DNA was fit on index OHLC (tokens 256265 / 260105), not futures.
    // Futures noise was over-trading and skewing short windows red.
    if (isNifty50InstrumentId(instrument.id) || isBankNiftyInstrumentId(instrument.id)) {
      this.resolvedContract.set(null);
      return {
        instrumentToken: instrument.instrumentToken,
        instrumentSymbol: instrument.tradingSymbol,
      };
    }

    this.resolvedContract.set(null);
    return {
      instrumentToken: instrument.instrumentToken,
      instrumentSymbol: instrument.tradingSymbol,
    };
  }

  private async tryResolveCrudeContract(): Promise<{
    instrumentToken: number;
    instrumentSymbol: string;
  } | null> {
    try {
      await this.instrumentStore.ensureLoaded();
    } catch {
      return null;
    }

    const match = resolveCrudeOilFuturesToken(this.instrumentStore.allInstruments());
    if (!match) {
      return null;
    }

    this.resolvedContract.set({
      tradingSymbol: match.tradingSymbol,
      instrumentToken: match.instrumentToken,
    });

    return {
      instrumentToken: match.instrumentToken,
      instrumentSymbol: match.tradingSymbol,
    };
  }
}

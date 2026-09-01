import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SwingScannerService, SwingScanResult } from '../../../core/services/swing-scanner.service';
import { SwingPositionsService } from '../../../core/services/swing-positions.service';
import {
  SwingBacktestService,
  BACKTEST_DEFAULT_START_MONTH,
  BACKTEST_DEFAULT_END_MONTH,
} from '../../../core/services/swing-backtest.service';
import { SwingWeeklyBacktestService } from '../../../core/services/swing-weekly-backtest.service';
import {
  IntradayBacktestService,
  IntradayStrategyId,
  INTRADAY_STRATEGY_OPTIONS,
} from '../../../core/services/intraday-backtest.service';
import {
  StrategyFinderService,
  FinderCandidate,
} from '../../../core/services/strategy-finder.service';
import {
  FinderUniverse,
  SearchSpace,
  buildRecipes,
  defaultSearchSpace,
  emaPullbackSpace,
  smartPullbackSpace,
} from '../../../core/strategy-engine/strategies/finder/strategy-search-space';
import { StopKind } from '../../../core/strategy-engine/strategies/finder/strategy-recipe';
import { NIFTY_500_UNIVERSE } from '../../../core/services/nifty500-universe';
import { NIFTY_50_UNIVERSE } from '../../../core/services/nifty50-universe';
import { Timeframe } from '../../../core/models/candle.model';
import {
  SWING_CAPITAL_PER_STOCK_RS,
  SWING_MAX_HOLD_TRADING_DAYS,
  SWING_MAX_RISK_PCT,
  qtyForFlatCapital,
} from '../../../core/strategy-engine/strategies/swing-breakout/swing-breakout.evaluator';
import { APP_BUILD_LABEL } from '../../../core/config/app-build';
import { currentMonth, shiftMonth } from '../../../core/utils/month-range.util';

type DeskTab = 'scan' | 'positions' | 'backtest' | 'intraday' | 'finder';
type BacktestView = 'weekly' | 'signals';
const WEEKLY_TOP_N = 3;
const DEFAULT_WEEKLY_CAPITAL_RS = SWING_CAPITAL_PER_STOCK_RS * WEEKLY_TOP_N;

const MONTH_OPTIONS = [
  { value: 1, label: 'Jan' },
  { value: 2, label: 'Feb' },
  { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' },
  { value: 5, label: 'May' },
  { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' },
  { value: 8, label: 'Aug' },
  { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' },
  { value: 11, label: 'Nov' },
  { value: 12, label: 'Dec' },
];

@Component({
  selector: 'app-trade-desk',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatProgressSpinnerModule, RouterLink],
  templateUrl: './trade-desk.component.html',
  styleUrl: './trade-desk.component.css',
})
export class TradeDeskComponent implements OnInit {
  private readonly scanner = inject(SwingScannerService);
  private readonly positionsSvc = inject(SwingPositionsService);
  private readonly backtestSvc = inject(SwingBacktestService);
  private readonly weeklyBacktestSvc = inject(SwingWeeklyBacktestService);
  private readonly intradaySvc = inject(IntradayBacktestService);
  private readonly finderSvc = inject(StrategyFinderService);

  protected readonly appBuildLabel = APP_BUILD_LABEL;
  protected readonly universeCount = NIFTY_500_UNIVERSE.length;
  protected readonly capitalPerStockRs = SWING_CAPITAL_PER_STOCK_RS;
  protected readonly maxHoldDays = SWING_MAX_HOLD_TRADING_DAYS;
  protected readonly maxRiskPct = Math.round(SWING_MAX_RISK_PCT * 1000) / 10;

  protected readonly tab = signal<DeskTab>('scan');

  protected readonly scanResults = this.scanner.results;
  protected readonly scanBusy = this.scanner.busy;
  protected readonly scanError = this.scanner.error;
  protected readonly scanProgress = this.scanner.progress;
  protected readonly lastScanAt = this.scanner.lastScanAt;
  protected readonly skippedUnresolved = this.scanner.skippedUnresolved;
  protected readonly lastScanWasCustom = this.scanner.lastScanWasCustom;

  protected readonly lookupResult = this.scanner.lookupResult;
  protected readonly lookupError = this.scanner.lookupError;
  protected readonly lookupBusy = this.scanner.lookupBusy;

  protected readonly positions = this.positionsSvc.positions;
  protected readonly positionSignals = this.positionsSvc.signals;
  protected readonly checkingPositions = this.positionsSvc.checking;
  protected readonly checkError = this.positionsSvc.checkError;

  protected readonly openPositions = computed(() => this.positions().filter((p) => !p.closedAt));
  protected readonly closedPositions = computed(() => this.positions().filter((p) => !!p.closedAt));

  protected readonly progressPct = computed(() => {
    const p = this.scanProgress();
    if (!p.total) return 0;
    return Math.round((p.done / p.total) * 100);
  });

  protected readonly backtestResult = this.backtestSvc.result;
  protected readonly backtestBusy = this.backtestSvc.busy;
  protected readonly backtestError = this.backtestSvc.error;
  protected readonly backtestProgress = this.backtestSvc.progress;

  // Shared by both backtest views — Start month / End month, stored as "YYYY-MM".
  protected btStartMonth = BACKTEST_DEFAULT_START_MONTH;
  protected btEndMonth = BACKTEST_DEFAULT_END_MONTH;
  protected readonly monthOptions = MONTH_OPTIONS;

  // Plain month-dropdown + year-number editors (sidesteps native <input type="month"> quirks
  // where the year segment can be finicky/uneditable depending on browser/OS).
  protected get startMonthNum(): number {
    return Number(this.btStartMonth.split('-')[1]);
  }
  protected set startMonthNum(v: number) {
    this.btStartMonth = `${this.startYearNum}-${String(v).padStart(2, '0')}`;
  }
  protected get startYearNum(): number {
    return Number(this.btStartMonth.split('-')[0]);
  }
  protected set startYearNum(v: number) {
    const year = Math.max(2000, Math.floor(Number(v)) || this.startYearNum);
    this.btStartMonth = `${year}-${String(this.startMonthNum).padStart(2, '0')}`;
  }

  protected get endMonthNum(): number {
    return Number(this.btEndMonth.split('-')[1]);
  }
  protected set endMonthNum(v: number) {
    this.btEndMonth = `${this.endYearNum}-${String(v).padStart(2, '0')}`;
  }
  protected get endYearNum(): number {
    return Number(this.btEndMonth.split('-')[0]);
  }
  protected set endYearNum(v: number) {
    const year = Math.max(2000, Math.floor(Number(v)) || this.endYearNum);
    this.btEndMonth = `${year}-${String(this.endMonthNum).padStart(2, '0')}`;
  }

  protected readonly backtestProgressPct = computed(() => {
    const p = this.backtestProgress();
    if (!p.total) return 0;
    return Math.round((p.done / p.total) * 100);
  });

  protected readonly backtestView = signal<BacktestView>('weekly');
  protected readonly weeklyTopN = WEEKLY_TOP_N;
  protected weeklyCapitalInput = DEFAULT_WEEKLY_CAPITAL_RS;

  protected readonly weeklyResult = this.weeklyBacktestSvc.result;
  protected readonly weeklyBusy = this.weeklyBacktestSvc.busy;
  protected readonly weeklyError = this.weeklyBacktestSvc.error;
  protected readonly weeklyProgress = this.weeklyBacktestSvc.progress;

  protected readonly weeklyProgressPct = computed(() => {
    const p = this.weeklyProgress();
    if (!p.total) return 0;
    return Math.round((p.done / p.total) * 100);
  });

  protected weeklyPerPickCapital(): number {
    return Math.round((Number(this.weeklyCapitalInput) || 0) / this.weeklyTopN);
  }

  /** Only take long breakouts while Nifty 50 is above its own 50-day average. */
  protected regimeFilterOn = false;

  // --- Intraday ---
  protected readonly intradayResult = this.intradaySvc.result;
  protected readonly intradayBusy = this.intradaySvc.busy;
  protected readonly intradayError = this.intradaySvc.error;
  protected readonly intradayProgress = this.intradaySvc.progress;
  protected readonly intradayStrategies = INTRADAY_STRATEGY_OPTIONS;
  protected readonly intradayUniverseCount = NIFTY_50_UNIVERSE.length;
  protected readonly intervalOptions: Timeframe[] = ['5minute', '15minute', '30minute', '60minute'];

  protected intradayStrategyId: IntradayStrategyId = 'orb';
  protected intradayCapital = 30_000;
  protected intradayInterval: Timeframe = '5minute';
  protected intradayMaxPositions = 10;

  /**
   * Intraday keeps its own window, defaulting to 3 months rather than the swing tab's 24.
   * Fifty stocks of 5-minute candles is roughly 75 bars per stock per day — a two-year
   * pull is hundreds of API calls and millions of candles.
   */
  protected intradayStartMonth = shiftMonth(currentMonth(), -3);
  protected intradayEndMonth = currentMonth();

  protected get intraStartMonthNum(): number {
    return Number(this.intradayStartMonth.split('-')[1]);
  }
  protected set intraStartMonthNum(v: number) {
    this.intradayStartMonth = `${this.intraStartYearNum}-${String(v).padStart(2, '0')}`;
  }
  protected get intraStartYearNum(): number {
    return Number(this.intradayStartMonth.split('-')[0]);
  }
  protected set intraStartYearNum(v: number) {
    const year = Math.max(2000, Math.floor(Number(v)) || this.intraStartYearNum);
    this.intradayStartMonth = `${year}-${String(this.intraStartMonthNum).padStart(2, '0')}`;
  }

  protected get intraEndMonthNum(): number {
    return Number(this.intradayEndMonth.split('-')[1]);
  }
  protected set intraEndMonthNum(v: number) {
    this.intradayEndMonth = `${this.intraEndYearNum}-${String(v).padStart(2, '0')}`;
  }
  protected get intraEndYearNum(): number {
    return Number(this.intradayEndMonth.split('-')[0]);
  }
  protected set intraEndYearNum(v: number) {
    const year = Math.max(2000, Math.floor(Number(v)) || this.intraEndYearNum);
    this.intradayEndMonth = `${year}-${String(this.intraEndMonthNum).padStart(2, '0')}`;
  }

  // --- Strategy finder ---
  protected readonly finderResult = this.finderSvc.result;
  protected readonly finderBusy = this.finderSvc.busy;
  protected readonly finderError = this.finderSvc.error;
  protected readonly finderProgress = this.finderSvc.progress;

  protected finderSpace: SearchSpace = defaultSearchSpace();
  protected finderUniverse: FinderUniverse = 'nifty50';
  protected finderPositionRs = 10_000;
  protected finderStartMonth = shiftMonth(currentMonth(), -36);
  protected finderEndMonth = currentMonth();

  /** Text mirrors of the numeric list fields, so they can be typed as "10, 20, 50". */
  protected finderText = {
    emaFast: '20',
    emaSlow: '50',
    breakoutLookback: '10, 20',
    rsiValue: '30, 40',
    volumeMinRatio: '1.2',
    pullbackMinPct: '3',
    priceEmaPeriod: '50',
    engulfTolerancePct: '0.3, 0.5, 1',
    strongBodyRatio: '0.6',
    emaTouchPeriod: '20, 50',
    notSidewaysRatio: '0.7',
    nearPivotMaxDistPct: '1',
    stopValue: '2',
    maxRiskPct: '5, 7',
    rewardMultiple: '1.5, 2, 3',
    maxHoldBars: '5, 10, 20',
  };

  /** Ready-made spaces, including the ported Pine indicator. */
  protected applyPreset(name: 'default' | 'smartPullback' | 'emaPullback'): void {
    const space =
      name === 'smartPullback' ? smartPullbackSpace()
      : name === 'emaPullback' ? emaPullbackSpace()
      : defaultSearchSpace();
    this.finderSpace = space;
    this.finderStopKind = space.stopKind[0] ?? 'atr';
    const list = (xs: number[]) => xs.join(', ');
    const pct = (xs: number[]) => xs.map((v) => +(v * 100).toFixed(3)).join(', ');
    this.finderText = {
      emaFast: list(space.emaFast),
      emaSlow: list(space.emaSlow),
      breakoutLookback: list(space.breakoutLookback),
      rsiValue: list(space.rsiValue),
      volumeMinRatio: list(space.volumeMinRatio),
      pullbackMinPct: pct(space.pullbackMinPct),
      priceEmaPeriod: list(space.priceEmaPeriod),
      engulfTolerancePct: pct(space.engulfTolerancePct),
      strongBodyRatio: list(space.strongBodyRatio),
      emaTouchPeriod: list(space.emaTouchPeriod),
      notSidewaysRatio: list(space.notSidewaysRatio),
      nearPivotMaxDistPct: pct(space.nearPivotMaxDistPct),
      stopValue: list(space.stopValue),
      maxRiskPct: pct(space.maxRiskPct),
      rewardMultiple: list(space.rewardMultiple),
      maxHoldBars: list(space.maxHoldBars),
    };
  }

  protected readonly stopKindOptions: StopKind[] = ['atr', 'pct', 'swingLow'];
  protected finderStopKind: StopKind = 'atr';

  protected readonly finderProgressPct = computed(() => {
    const p = this.finderProgress();
    if (!p.total) return 0;
    return Math.round((p.done / p.total) * 100);
  });

  /** Applies the typed text fields back onto the search space. */
  private syncFinderSpace(): void {
    const nums = (s: string) =>
      s.split(/[,\s]+/).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
    const t = this.finderText;
    this.finderSpace.emaFast = nums(t.emaFast);
    this.finderSpace.emaSlow = nums(t.emaSlow);
    this.finderSpace.breakoutLookback = nums(t.breakoutLookback);
    this.finderSpace.rsiValue = nums(t.rsiValue);
    this.finderSpace.volumeMinRatio = nums(t.volumeMinRatio);
    this.finderSpace.pullbackMinPct = nums(t.pullbackMinPct).map((v) => v / 100);
    this.finderSpace.stopValue = nums(t.stopValue);
    this.finderSpace.maxRiskPct = nums(t.maxRiskPct).map((v) => v / 100);
    this.finderSpace.rewardMultiple = nums(t.rewardMultiple);
    this.finderSpace.maxHoldBars = nums(t.maxHoldBars);
    this.finderSpace.stopKind = [this.finderStopKind];
    this.finderSpace.priceEmaPeriod = nums(t.priceEmaPeriod);
    this.finderSpace.engulfTolerancePct = nums(t.engulfTolerancePct).map((v) => v / 100);
    this.finderSpace.strongBodyRatio = nums(t.strongBodyRatio);
    this.finderSpace.emaTouchPeriod = nums(t.emaTouchPeriod);
    this.finderSpace.notSidewaysRatio = nums(t.notSidewaysRatio);
    this.finderSpace.nearPivotMaxDistPct = nums(t.nearPivotMaxDistPct).map((v) => v / 100);
  }

  /** Live count so you can see the search exploding before you launch it. */
  protected finderComboCount(): number {
    this.syncFinderSpace();
    try {
      return buildRecipes(this.finderSpace).length;
    } catch {
      return 0;
    }
  }

  protected async runFinder(): Promise<void> {
    this.syncFinderSpace();
    await this.finderSvc.run({
      space: this.finderSpace,
      startMonth: this.finderStartMonth,
      endMonth: this.finderEndMonth,
      universe: this.finderUniverse,
      positionSizeRs: Number(this.finderPositionRs) || 10_000,
    });
  }

  protected verdictLabel(v: FinderCandidate['verdict']): string {
    switch (v) {
      case 'promising': return 'Held up out-of-sample';
      case 'likely-overfit': return 'Fell apart out-of-sample';
      case 'no-edge': return 'No edge in-sample';
      default: return 'Too few trades';
    }
  }

  /** Copies just the recipe — the portable formula, ready to paste back for coding up. */
  protected async copyFormula(c: FinderCandidate, key: string): Promise<void> {
    await this.copyJson(
      {
        recipe: c.recipe,
        measured: { inSample: c.inSample, outOfSample: c.outOfSample },
        verdict: c.verdict,
        costHurdleR: c.costHurdleR,
      },
      key,
    );
  }

  /** Rough call-count warning so a huge window is an informed choice, not a surprise. */
  protected intradayMonthSpan(): number {
    const [sy, sm] = this.intradayStartMonth.split('-').map(Number);
    const [ey, em] = this.intradayEndMonth.split('-').map(Number);
    return Math.max(0, (ey! - sy!) * 12 + (em! - sm!) + 1);
  }

  protected readonly intradayProgressPct = computed(() => {
    const p = this.intradayProgress();
    if (!p.total) return 0;
    return Math.round((p.done / p.total) * 100);
  });

  protected async runIntraday(): Promise<void> {
    await this.intradaySvc.run({
      strategyId: this.intradayStrategyId,
      capitalRs: Number(this.intradayCapital) || 0,
      startMonth: this.intradayStartMonth,
      endMonth: this.intradayEndMonth,
      interval: this.intradayInterval,
      maxPositions: Math.max(1, Math.min(10, Math.floor(Number(this.intradayMaxPositions)) || 10)),
    });
  }

  // Add-position form
  protected addSymbol = '';
  protected addEntryDate = todayIso();
  protected addEntryPrice: number | null = null;
  protected addQty: number | null = null;
  protected addStop: number | null = null;
  protected addTarget: number | null = null;
  protected addQtyManual = false;
  protected addFormError = signal('');

  // Custom-list scan
  protected customSymbolsInput = '';

  // Instrument token lookup
  protected lookupSymbolInput = '';

  ngOnInit(): void {
    if (this.openPositions().length) {
      void this.positionsSvc.refreshSignals();
    }
  }

  protected setTab(tab: DeskTab): void {
    this.tab.set(tab);
  }

  protected hasKiteSession(): boolean {
    return this.scanner.hasKiteSession();
  }

  protected async runScan(): Promise<void> {
    await this.scanner.scan(NIFTY_500_UNIVERSE);
  }

  protected async runCustomScan(): Promise<void> {
    await this.scanner.scanCustom(this.customSymbolsInput);
  }

  protected async lookupToken(): Promise<void> {
    await this.scanner.lookupToken(this.lookupSymbolInput);
  }

  protected async runBacktest(): Promise<void> {
    await this.backtestSvc.run(this.btStartMonth, this.btEndMonth, NIFTY_500_UNIVERSE);
  }

  protected async runWeeklyBacktest(): Promise<void> {
    await this.weeklyBacktestSvc.run(
      Number(this.weeklyCapitalInput) || 0,
      this.btStartMonth,
      this.btEndMonth,
      this.weeklyTopN,
      this.regimeFilterOn,
    );
  }

  protected setBacktestView(view: BacktestView): void {
    this.backtestView.set(view);
  }

  protected trackTrade(s: SwingScanResult): void {
    this.addSymbol = s.symbol;
    this.addEntryDate = todayIso();
    this.addEntryPrice = round2(s.entry);
    this.addQty = s.qty;
    this.addStop = round2(s.stop);
    this.addTarget = round2(s.target);
    this.addQtyManual = false;
    this.addFormError.set('');
    this.tab.set('positions');
  }

  protected onEntryPriceChange(): void {
    if (this.addQtyManual) return;
    const price = Number(this.addEntryPrice);
    if (price > 0) {
      this.addQty = qtyForFlatCapital(price, SWING_CAPITAL_PER_STOCK_RS);
    }
  }

  protected onQtyEdited(): void {
    this.addQtyManual = true;
  }

  protected addPosition(): void {
    this.addFormError.set('');
    const symbol = this.addSymbol.trim().toUpperCase();
    const entryPrice = Number(this.addEntryPrice);
    const qty = Number(this.addQty);
    const stop = Number(this.addStop);
    const target = Number(this.addTarget);
    if (!symbol) {
      this.addFormError.set('Enter a symbol.');
      return;
    }
    if (!(entryPrice > 0)) {
      this.addFormError.set('Enter a valid entry price.');
      return;
    }
    if (!(qty > 0)) {
      this.addFormError.set('Enter a valid quantity.');
      return;
    }
    if (!(stop > 0) || stop >= entryPrice) {
      this.addFormError.set('Stop must be a positive price below entry.');
      return;
    }
    if (!(target > entryPrice)) {
      this.addFormError.set('Target must be above entry.');
      return;
    }
    this.positionsSvc.add({
      symbol,
      entryDate: this.addEntryDate,
      entryPrice,
      qty,
      stop,
      target,
    });
    this.addSymbol = '';
    this.addEntryPrice = null;
    this.addQty = null;
    this.addStop = null;
    this.addTarget = null;
    this.addQtyManual = false;
    this.addEntryDate = todayIso();
  }

  protected async refreshPositions(): Promise<void> {
    await this.positionsSvc.refreshSignals();
  }

  protected removePosition(id: string): void {
    this.positionsSvc.remove(id);
  }

  protected markSold(id: string, reason: 'TARGET' | 'STOP' | 'TIME' | 'HOLD', price: number | null): void {
    if (price == null) return;
    this.positionsSvc.markClosed(id, reason, price);
  }

  protected exitCopy(reason: string): string {
    switch (reason) {
      case 'TARGET':
        return 'Target hit — book the profit.';
      case 'STOP':
        return 'Stop hit — cut the loss.';
      case 'TIME':
        return `Held ${SWING_MAX_HOLD_TRADING_DAYS} trading days without hitting target — close it out.`;
      case 'ERROR':
        return 'Could not fetch fresh candles — try again.';
      default:
        return 'No exit trigger yet — keep holding.';
    }
  }

  protected fmtDate(d: string | null | undefined): string {
    if (!d) return '—';
    return d.slice(0, 10);
  }

  protected fmtR(n: number): string {
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}R`;
  }

  protected signed(n: number): string {
    return n > 0 ? '+' : '';
  }

  protected signalFor(positionId: string) {
    return this.positionSignals().find((s) => s.position.id === positionId) ?? null;
  }

  // Copy-JSON — lets you hand raw result data to anyone/anything (e.g. paste to an AI) without retyping it.
  protected readonly copyFeedbackKey = signal<string | null>(null);
  private copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  protected copyLabel(key: string, defaultLabel = 'Copy JSON'): string {
    const state = this.copyFeedbackKey();
    if (state === key) return 'Copied!';
    if (state === `${key}-error`) return 'Copy failed';
    return defaultLabel;
  }

  protected async copyJson(data: unknown, key: string): Promise<void> {
    if (this.copyFeedbackTimer) {
      clearTimeout(this.copyFeedbackTimer);
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      this.copyFeedbackKey.set(key);
    } catch {
      this.copyFeedbackKey.set(`${key}-error`);
    }
    this.copyFeedbackTimer = setTimeout(() => this.copyFeedbackKey.set(null), 1800);
  }
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

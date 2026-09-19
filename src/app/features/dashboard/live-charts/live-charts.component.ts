/**
 * Charts tab — live candles with support/resistance for Crude Oil Mini,
 * Nifty 50 and Bank Nifty, each on its own interval (15m by default).
 *
 * Each book knows its own session (indices 09:15–15:30, crude 09:00–23:30) and
 * only polls while that session is running: outside it, Kite would keep
 * serving the same closed candles and every read would spend quota for
 * nothing. Polling restarts by itself at the open — the scheduler keeps
 * ticking through the shut hours and simply skips the fetch.
 *
 * Candles are read-only Kite history. The ATM CE/PE buttons are not: they
 * place real market orders through the Kite proxy, outside the live desk and
 * outside its rails. See AtmOrderService for what that does and does not
 * protect. Nothing here touches the desk's own state either way.
 */
import {
  Component,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Candle } from '../../../core/models/candle.model';
import { SrChartModel, SrZone, buildSrChartModel } from '../../../core/charts/sr-chart.util';
import { SrSignal, detectSrSignals } from '../../../core/charts/sr-signals.util';
import {
  ChartStructure,
  canAutoEnter,
  chartStructureKey,
  detectAllChartStructures,
  detectChartStructure,
  optionStopTrigger,
} from '../../../core/charts/chart-structure.util';
import {
  AUTO_BOT_LABELS,
  AUTO_BOT_SHORT,
  CHART_PNL_BOOKS,
  ChartPnlSummary,
  chartCandleAsOf,
  isLiveChartDay,
  istToday,
  structuresOnDay,
  summarizeChartPnl,
} from '../../../core/charts/chart-auto-pnl.util';
import {
  CHART_BOOKS,
  ChartBookDef,
  ChartBookId,
  LiveChartDataService,
} from '../../../core/charts/live-chart-data.service';
import {
  CHART_INTERVALS,
  CHART_INTERVAL_LABELS,
  ChartInterval,
  chartIntervalMinutes,
} from '../../../core/charts/chart-intervals.util';
import { PgIconComponent } from '../../../shared/ui/icon/pg-icon.component';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { CapitalPreferenceService } from '../../../core/services/capital-preference.service';
import { KiteFundsService } from '../../../core/services/kite-funds.service';
import { AtmOrderService } from '../../../core/orders/atm-order.service';
import { AtmOptionSide, AtmOrderTicket, atmOrderCost } from '../../../core/orders/atm-order.util';
import { clampChartLots, lotsForChartBook, maxChartLots, sizingCapitalFromFunds } from '../../../core/charts/chart-lots.util';
import { RS_PER_LOT } from '../../../core/paper-desk/lots-from-funds';
import { TvCandleChartComponent } from './tv-candle-chart.component';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { isKiteAuthError } from '../../../core/utils/kite-auth-error.util';
import { MarketStatus, marketStatusAt } from '../../../core/utils/market-status.util';
import { InstrumentSessionConfig, resolveSessionConfig } from '../../../core/config/session.config';

interface ChartPane {
  def: ChartBookDef;
  symbol: string;
  /** Trading hours for this book's exchange. */
  session: InstrumentSessionConfig;
  /** Each book carries its own timeframe; crude and the indices rarely suit the same one. */
  interval: ChartInterval;
  candles: Candle[];
  model: SrChartModel | null;
  signals: SrSignal[];
  error: string | null;
  loading: boolean;
  updatedAt: string | null;
  /** Outcome of the last manual ATM buy on this book. */
  order: OrderFeedback | null;
  /** Side currently being resolved/placed, so only that button shows busy. */
  ordering: AtmOptionSide | null;
  /** Latest 1:1 measured-move box, or null when no wall has broken. */
  structure: ChartStructure | null;
  /** Every 1:1 break on the selected test date, for paper P&L. */
  dayStructures: ChartStructure[];
}

interface OrderFeedback {
  ok: boolean;
  text: string;
}

const INTERVALS = CHART_INTERVALS;
const DEFAULT_INTERVAL: ChartInterval = '15m';
/**
 * Poll cadence per interval.
 *
 * These are historical-candle reads, not a tick feed, so the only thing that
 * changes between polls is the forming candle. Polling a 1-hour chart every
 * few seconds would burn Kite quota to redraw the same bar, while a 1-minute
 * chart genuinely moves — so the fast intervals poll faster.
 */
const REFRESH_MS: Record<ChartInterval, number> = {
  '1m': 10_000,
  '5m': 15_000,
  '10m': 20_000,
  '15m': 30_000,
  '30m': 30_000,
  '45m': 30_000,
  '1h': 60_000,
};
/** The scheduler ticks at the fastest cadence and each interval skips its turns. */
const TICK_MS = 5_000;
/** Crude is MCX and runs to 23:30; the indices are NSE and stop at 15:30. */
const SESSIONS: Record<ChartBookId, InstrumentSessionConfig> = {
  crude: resolveSessionConfig({ exchange: 'MCX' }),
  nifty: resolveSessionConfig({ exchange: 'NSE' }),
  bank: resolveSessionConfig({ exchange: 'NSE' }),
};
/** Kite historical allows 3 req/s; keep a gap so three books never trip it. */
const BOOK_STAGGER_MS = 350;

@Component({
  selector: 'app-live-charts',
  standalone: true,
  imports: [TvCandleChartComponent, PgIconComponent, RouterLink],
  templateUrl: './live-charts.component.html',
  styleUrl: './live-charts.component.css',
})
export class LiveChartsComponent implements OnInit, OnDestroy {
  private readonly data = inject(LiveChartDataService);
  private readonly orders = inject(AtmOrderService);
  private readonly kiteFunds = inject(KiteFundsService);
  private readonly capitalPref = inject(CapitalPreferenceService);
  private readonly uiDialog = inject(UiDialogService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly intervals = INTERVALS;
  protected readonly intervalLabels = CHART_INTERVAL_LABELS;

  protected readonly autoRefresh = signal(true);
  /**
   * Per-book auto bot. When on for a live session, a fresh 1:1 break buys the
   * ATM CE/PE and rests an SL. Off by default; Charts-tab only.
   */
  protected readonly autoBots = signal<Record<ChartBookId, boolean>>({
    crude: false,
    nifty: false,
    bank: false,
  });
  /** One calendar day. Start and end are the same — live when it is today. */
  protected readonly testDate = signal(istToday());
  protected readonly botBooks = CHART_PNL_BOOKS;
  protected readonly botLabels = AUTO_BOT_LABELS;
  protected readonly botShort = AUTO_BOT_SHORT;
  protected readonly refreshing = signal(false);
  protected readonly panes = signal<ChartPane[]>(
    CHART_BOOKS.map((def) => ({
      def,
      symbol: def.label,
      session: SESSIONS[def.id],
      interval: DEFAULT_INTERVAL,
      candles: [],
      model: null,
      signals: [],
      error: null,
      loading: true,
      updatedAt: null,
      order: null,
      ordering: null,
      structure: null,
      dayStructures: [],
    })),
  );

  protected readonly anyError = computed(() => this.panes().some((p) => p.error));

  /**
   * Re-read on every scheduler tick so the badges cross the open and the close
   * on their own rather than waiting for the next candle to land.
   */
  private readonly clock = signal(Date.now());

  protected readonly todayIst = computed(() => istToday(new Date(this.clock())));

  /** Today is live; any earlier date is a paper test of that session. */
  protected readonly liveDay = computed(() => isLiveChartDay(this.testDate(), new Date(this.clock())));

  protected readonly pnl = computed<ChartPnlSummary>(() =>
    summarizeChartPnl({
      crude: this.pnlInput('crude'),
      nifty: this.pnlInput('nifty'),
      bank: this.pnlInput('bank'),
    }),
  );

  protected readonly marketStatus = computed<Record<ChartBookId, MarketStatus>>(() => {
    const now = new Date(this.clock());
    return {
      crude: marketStatusAt(SESSIONS.crude, now),
      nifty: marketStatusAt(SESSIONS.nifty, now),
      bank: marketStatusAt(SESSIONS.bank, now),
    };
  });

  /** Drives the header badge: the page is only "live" while something trades. */
  protected readonly anyMarketOpen = computed(() =>
    Object.values(this.marketStatus()).some((status) => status.open),
  );

  /**
   * Kite tokens expire daily and the app has no refresh flow, so a dead
   * session is the most likely reason every book fails at once. Say that
   * plainly instead of repeating a Kite error string three times.
   */
  protected readonly sessionExpired = signal(false);

  /** 45m is folded from 15m bars because Kite serves no 45-minute candle. */
  protected readonly derivedInterval = computed(() =>
    this.panes().some((pane) => this.data.isDerived(pane.interval)),
  );

  /**
   * Fastest cadence in play, for the Live button. Each book polls on its own
   * timeframe, so one number cannot describe all three — the quickest is the
   * one that says how live the page feels.
   */
  protected readonly refreshSeconds = computed(() =>
    Math.min(...this.panes().map((pane) => REFRESH_MS[pane.interval])) / 1000,
  );

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Guards against a slow poll overlapping the next tick. */
  private inFlight = false;
  /** Date/interval change while a sweep is in the air. */
  private pendingAll = false;
  private readonly lastPollAt = new Map<ChartBookId, number>();
  /** Last seen session state per book, so the close can be caught as it happens. */
  private readonly wasOpen = new Map<ChartBookId, boolean>();
  /** Once a reader taps +/−, that book keeps their count instead of following funds. */
  private readonly lotsOverride = signal<Partial<Record<ChartBookId, number>>>({});
  /** Structure keys already sent so Auto Trade cannot double-fire one break. */
  private readonly tradedKeys = new Set<string>();

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    // One load regardless of the clock: a shut market should still show the
    // session that just ended rather than an empty frame.
    void this.kiteFunds.refresh();
    void this.refreshAll();
    this.timer = setInterval(() => {
      this.clock.set(Date.now());
      if (!this.autoRefresh()) return;
      // Nothing to show a hidden tab; skip the Kite call entirely.
      if (typeof document !== 'undefined' && document.hidden) return;
      const due = this.duePanes();
      if (due.length) {
        void this.refreshPanes(due);
      }
    }, TICK_MS);
  }

  /**
   * Books worth polling on this tick.
   *
   * A shut book is skipped — its candles cannot change. The one exception is
   * the tick that notices the close: the final bar completes exactly at the
   * closing bell, so each book gets one last read on the way out.
   */
  private duePanes(): ChartBookId[] {
    if (!this.liveDay()) return [];
    const now = Date.now();
    const status = this.marketStatus();
    const due: ChartBookId[] = [];
    for (const pane of this.panes()) {
      const id = pane.def.id;
      const open = status[id].open;
      const justClosed = !open && this.wasOpen.get(id) === true;
      this.wasOpen.set(id, open);
      if (justClosed) {
        due.push(id);
        continue;
      }
      if (!open) continue;
      if (now - (this.lastPollAt.get(id) ?? 0) >= REFRESH_MS[pane.interval]) {
        due.push(id);
      }
    }
    return due;
  }

  ngOnDestroy(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
    }
  }

  protected setPaneInterval(id: ChartBookId, next: ChartInterval): void {
    const pane = this.paneById(id);
    if (!pane || pane.interval === next) return;
    this.patch(id, { interval: next, loading: true });
    void this.refreshPanes([id]);
  }

  protected toggleAutoRefresh(): void {
    this.autoRefresh.update((on) => !on);
  }

  protected refreshAll(): Promise<void> {
    return this.refreshPanes(CHART_BOOKS.map((def) => def.id));
  }

  /**
   * Sweep the given books one at a time.
   *
   * Sequential with a gap because Kite historical allows 3 requests a second,
   * and three books firing together would trip it.
   */
  private async refreshPanes(ids: ChartBookId[]): Promise<void> {
    if (!ids.length) return;
    if (this.inFlight) {
      if (ids.length === CHART_BOOKS.length) {
        this.pendingAll = true;
      }
      return;
    }
    this.inFlight = true;
    this.refreshing.set(true);
    let authFailures = 0;
    try {
      for (const id of ids) {
        const pane = this.paneById(id);
        if (!pane) continue;
        this.lastPollAt.set(id, Date.now());
        if (!(await this.refreshBook(id, pane.interval))) {
          authFailures += 1;
        }
        await delay(BOOK_STAGGER_MS);
      }
      // One book failing on auth could be a fluke; all of them is the session.
      // Only a full sweep can say that, so a single-book refresh may clear the
      // banner but never raise it.
      if (ids.length === CHART_BOOKS.length) {
        this.sessionExpired.set(authFailures === CHART_BOOKS.length);
      } else if (!authFailures) {
        this.sessionExpired.set(false);
      }
    } finally {
      this.inFlight = false;
      this.refreshing.set(false);
      if (this.pendingAll) {
        this.pendingAll = false;
        void this.refreshAll();
      }
    }
  }

  /** Resolves false when the book failed because Kite rejected the session. */
  private async refreshBook(id: ChartBookId, interval: ChartInterval): Promise<boolean> {
    const day = this.testDate();
    try {
      const instrument = await this.data.resolveInstrument(id);
      const asOf = chartCandleAsOf(day);
      const candles = await this.data.loadCandles({
        token: instrument.token,
        interval,
        now: asOf,
      });
      // The timeframe or test date can change while the request is in the air.
      if (this.paneById(id)?.interval !== interval || this.testDate() !== day) {
        return true;
      }
      if (!candles.length) {
        this.patch(id, {
          error: `Kite returned no ${this.intervalLabels[interval]} candles.`,
          loading: false,
        });
        return true;
      }
      const model = buildSrChartModel(candles);
      const intervalMinutes = chartIntervalMinutes(interval);
      const detectOpts = { intervalMinutes, now: asOf };
      const structure = detectChartStructure(candles, model.zones, model.atr, detectOpts);
      const dayStructures = structuresOnDay(
        detectAllChartStructures(candles, model.zones, model.atr, detectOpts),
        day,
      );
      this.patch(id, {
        symbol: instrument.symbol,
        candles,
        model,
        signals: detectSrSignals(candles, model.zones, model.atr, { intervalMinutes, now: asOf }),
        structure,
        dayStructures,
        error: null,
        loading: false,
        updatedAt: new Date().toLocaleTimeString('en-IN', { hour12: false }),
      });
      void this.maybeAutoTrade(id);
      return true;
    } catch (error) {
      if (this.paneById(id)?.interval !== interval || this.testDate() !== day) {
        return true;
      }
      this.patch(id, { error: formatUnknownError(error, 'Charts'), loading: false });
      return !isKiteAuthError(error);
    }
  }

  private paneById(id: ChartBookId): ChartPane | undefined {
    return this.panes().find((pane) => pane.def.id === id);
  }

  /**
   * Buy the ATM CE or PE on one book.
   *
   * Resolve the exact contract and its live premium first, then show both and
   * the rupee cost in a confirmation before anything is sent. A manual buy
   * runs outside the desk's rails, so the only protection is the reader
   * knowing precisely what they are about to pay for.
   *
   * Auto Trade skips the dialog, buys the side the 1:1 box names, and rests
   * an SL on that option after the fill.
   */
  protected async buyAtm(
    id: ChartBookId,
    side: AtmOptionSide,
    opts: { auto?: boolean; structure?: ChartStructure | null } = {},
  ): Promise<boolean> {
    const pane = this.paneById(id);
    if (!pane || pane.ordering) return false;

    // The broker would reject it anyway, but saying so here names the session
    // instead of returning a Kite error code.
    if (!this.liveDay()) {
      this.patch(id, {
        order: {
          ok: false,
          text: `Viewing ${this.testDate()} — switch the calendar to today to place a live order.`,
        },
      });
      return false;
    }

    const status = this.marketStatus()[id];
    if (!status.open) {
      this.patch(id, {
        order: {
          ok: false,
          text: `${pane.def.label} is closed — trades ${pane.session.marketOpen}–${pane.session.marketClose} IST.`,
        },
      });
      return false;
    }

    const spot = pane.model?.last?.price;
    if (spot == null) {
      this.patch(id, { order: { ok: false, text: 'No live price yet — wait for candles.' } });
      return false;
    }

    this.patch(id, { ordering: side, order: null });
    try {
      await this.kiteFunds.refresh();
      const lots = this.lotsFor(id);
      const plan = await this.orders.plan({ book: id, side, spot, lots });
      if (!plan.ok) {
        this.patch(id, { order: { ok: false, text: plan.reason } });
        return false;
      }

      const ticket = plan.ticket;
      const premium = await this.orders.premium(ticket);
      if (!opts.auto && !(await this.confirmBuy(pane, ticket, premium))) {
        return false;
      }

      const result = await this.orders.place(ticket);
      if (!result.ok) {
        this.patch(id, { order: { ok: false, text: result.message } });
        return false;
      }

      let text = `${opts.auto ? 'Auto · ' : ''}${shortSymbol(ticket)} · ${result.message}`;
      const box = opts.structure ?? pane.structure;
      if (opts.auto && box) {
        const fill = await this.orders.fillPrice(result.orderId, premium);
        const trigger = fill != null ? optionStopTrigger(fill, box.height) : null;
        if (trigger == null) {
          text += ' · SL not rested — no fill premium yet. Manage the exit.';
        } else {
          const sl = await this.orders.placeStop(ticket, trigger);
          text += sl.ok ? ` · ${sl.message}` : ` · entry sent, SL failed: ${sl.message}`;
        }
      }

      this.patch(id, { order: { ok: true, text } });
      return true;
    } finally {
      this.patch(id, { ordering: null });
    }
  }

  protected autoBotOn(id: ChartBookId): boolean {
    return this.autoBots()[id];
  }

  protected async toggleAutoBot(id: ChartBookId): Promise<void> {
    if (this.autoBots()[id]) {
      this.autoBots.update((current) => ({ ...current, [id]: false }));
      return;
    }
    const label = AUTO_BOT_LABELS[id];
    const live = this.liveDay();
    const ok = await this.uiDialog.confirm({
      title: `Enable ${label}?`,
      message: live
        ? [
            `When a 1:1 box prints on a just-closed ${this.paneById(id)?.def.label ?? label} candle,`,
            'Charts will buy the ATM CE (breakout) or PE (breakdown) at market and rest an SL.',
            '',
            'This is the Charts tab only. The other two auto bots stay as they are.',
            'Trade Bot is not involved, and the desk rails do not apply.',
          ].join('\n')
        : [
            `Test date ${this.testDate()} — start and end are the same day.`,
            `${label} will not place live orders on a past session.`,
            'Profit below is paper P&L from that day’s 1:1 boxes.',
          ].join('\n'),
      confirmLabel: `Enable ${label}`,
      cancelLabel: 'Cancel',
      tone: live ? 'danger' : 'default',
    });
    if (!ok) return;
    this.autoBots.update((current) => ({ ...current, [id]: true }));
    if (live) {
      void this.maybeAutoTrade(id);
    }
  }

  protected setTestDate(value: string): void {
    const today = this.todayIst();
    const next = value && value <= today ? value : today;
    if (next === this.testDate()) return;
    this.testDate.set(next);
    this.tradedKeys.clear();
    this.panes.update((list) =>
      list.map((pane) => ({ ...pane, loading: true, dayStructures: [], order: null })),
    );
    void this.refreshAll();
  }

  protected jumpToToday(): void {
    this.setTestDate(this.todayIst());
  }

  protected onTestDateInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    this.setTestDate(value);
  }

  private pnlInput(id: ChartBookId): {
    boxes: ChartStructure[];
    lots: number;
    lastPrice?: number | null;
  } {
    const pane = this.paneById(id);
    return {
      boxes: pane?.dayStructures ?? [],
      lots: this.lotsFor(id),
      lastPrice: pane?.model?.last?.price,
    };
  }

  private async maybeAutoTrade(id: ChartBookId): Promise<void> {
    if (!this.liveDay() || !this.autoBots()[id]) return;
    const pane = this.paneById(id);
    if (!pane || pane.ordering) return;
    const box = pane.structure;
    if (!canAutoEnter(box)) return;
    const key = chartStructureKey(id, box);
    if (this.tradedKeys.has(key)) return;
    this.tradedKeys.add(key);
    const sent = await this.buyAtm(id, box.option, { auto: true, structure: box });
    if (!sent) {
      this.tradedKeys.delete(key);
    }
  }

  private confirmBuy(
    pane: ChartPane,
    ticket: AtmOrderTicket,
    premium: number | null,
  ): Promise<boolean> {
    const cost = premium != null ? atmOrderCost(ticket, premium) : null;
    const lines = [
      `${ticket.tradingSymbol}`,
      `${ticket.lots} lot${ticket.lots > 1 ? 's' : ''} from ${this.fundsLabel()} ₹${this.fmt(this.sizingCapitalRs(), 0)} (₹${this.fmt(RS_PER_LOT, 0)} per index lot)`,
      `qty ${ticket.quantity} · ${ticket.product} · MARKET`,
      premium != null
        ? `Premium ₹${this.fmt(premium, 2)}${cost != null ? ` · about ₹${this.fmt(cost, 0)} to buy` : ''}`
        : 'Live premium unavailable — cost unknown.',
      '',
      'This is a real order at market price. No stop-loss is attached and the',
      "desk's daily limits do not apply to it — you manage the exit.",
    ];

    return this.uiDialog.confirm({
      title: `Buy ${pane.def.label} ATM ${ticket.side}?`,
      message: lines.join('\n'),
      confirmLabel: `Buy ${ticket.side}`,
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
  }

  protected sizingCapitalRs(): number {
    return sizingCapitalFromFunds(this.kiteFunds.equityAvailable(), this.capitalPref.get());
  }

  /** Same ladder as Trade Bot: ₹40,000 per index lot, Crude 3× that band. */
  protected autoLotsFor(id: ChartBookId): number {
    return lotsForChartBook(id, this.kiteFunds.equityAvailable(), this.capitalPref.get());
  }

  protected lotsFor(id: ChartBookId): number {
    const override = this.lotsOverride()[id];
    if (override != null) return clampChartLots(id, override);
    return this.autoLotsFor(id);
  }

  protected maxLots(id: ChartBookId): number {
    return maxChartLots(id);
  }

  protected bumpLots(id: ChartBookId, step: number): void {
    const next = clampChartLots(id, this.lotsFor(id) + step);
    this.lotsOverride.update((current) => ({ ...current, [id]: next }));
  }

  protected fundsLabel(): string {
    const actual = this.kiteFunds.equityAvailable();
    return actual != null && actual > 0 ? 'Kite funds' : 'saved capital';
  }

  protected statusOf(pane: ChartPane): MarketStatus {
    return this.marketStatus()[pane.def.id];
  }

  private patch(id: ChartBookId, patch: Partial<ChartPane>): void {
    this.panes.update((list) =>
      list.map((pane) => (pane.def.id === id ? { ...pane, ...patch } : pane)),
    );
  }

  protected canPlaceOrders(pane: ChartPane): boolean {
    return this.liveDay() && !!pane.model?.last && this.statusOf(pane).open;
  }

  protected orderHintFor(pane: ChartPane): string {
    if (!this.liveDay()) {
      return `Viewing ${this.testDate()} — switch to today to trade`;
    }
    return this.statusOf(pane).open ? '' : this.statusOf(pane).detail;
  }

  protected pnlTone(amount: number): 'up' | 'down' | 'flat' {
    if (amount > 0.5) return 'up';
    if (amount < -0.5) return 'down';
    return 'flat';
  }

  protected trackPane = (_: number, pane: ChartPane) => pane.def.id;

  protected fmt(value: number | null | undefined, decimals: number): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  protected signed(value: number | null | undefined, decimals: number): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return `${value >= 0 ? '+' : ''}${this.fmt(value, decimals)}`;
  }

  /** Tightest resistance above price / support below, for the pane header. */
  protected nearestZone(pane: ChartPane, kind: 'support' | 'resistance'): SrZone | null {
    const last = pane.model?.last?.price;
    const zones = pane.model?.zones ?? [];
    if (last == null || !zones.length) return null;
    const side = zones.filter((z) => z.kind === kind);
    if (!side.length) return null;
    return side.reduce((best, z) =>
      Math.abs(z.mid - last) < Math.abs(best.mid - last) ? z : best,
    );
  }

  protected zoneLabel(zone: SrZone | null, decimals: number): string {
    if (!zone) return '—';
    // Spaced dash: both bounds already carry commas and a decimal point, and
    // "24,969.98–24,971.48" runs together without it.
    return `${this.fmt(zone.lo, decimals)} – ${this.fmt(zone.hi, decimals)}`;
  }

  protected barCount(pane: ChartPane): number {
    return pane.candles.length;
  }

  /** Newest marker on the book — the one a reader is actually looking at. */
  protected latestSignal(pane: ChartPane): SrSignal | null {
    return pane.signals.length ? pane.signals[pane.signals.length - 1]! : null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strike and side are what identify the trade in a one-line result. */
function shortSymbol(ticket: AtmOrderTicket): string {
  return `${ticket.strike}${ticket.side}`;
}

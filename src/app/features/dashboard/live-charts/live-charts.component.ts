/**
 * Charts tab — Smart Money Concepts on Crude Oil Mini, Nifty 50 and Bank Nifty.
 *
 * One deterministic engine (core/charts/smc) reads the closed candles of every
 * book. History, the live session and a replayed test date all go through the
 * same `analyzeSmc` call, so a signal on the chart is the signal the engine
 * would have produced in real time and it never changes afterwards.
 *
 * Each book knows its own session (indices 09:15–15:30, crude 09:00–23:30) and
 * only polls while that session is running: outside it, Kite would keep
 * serving the same closed candles and every read would spend quota for
 * nothing. Polling restarts by itself at the open — the scheduler keeps
 * ticking through the shut hours and simply skips the fetch.
 *
 * Candles are read-only Kite history. Buy / Sell / Auto on every book place
 * real ATM option orders through the Kite proxy, outside the live desk rails.
 * Auto is per book: Nifty on does not arm Bank Nifty or Crude. Auto buys the
 * ATM call on a confirmed BUY and the ATM put on a confirmed SELL, then rests
 * a 25% premium stop and a 0.5R target. See AtmOrderService.
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
import { chartCandleAsOf, isLiveChartDay, istToday } from '../../../core/charts/chart-day.util';
import { ChartQuote, chartQuote } from '../../../core/charts/chart-quote.util';
import { analyzeSmc } from '../../../core/charts/smc/smc-analyze';
import { SmcAlertTracker } from '../../../core/charts/smc/smc-alerts';
import { DEFAULT_SMC_CONFIG, SmcConfig } from '../../../core/charts/smc/smc.config';
import {
  SMC_ALERT_LABELS,
  SMC_ALERT_TYPES,
  SmcAlertEvent,
  SmcAlertType,
  SmcAnalysis,
} from '../../../core/charts/smc/smc.types';
import {
  SmcLayers,
  SmcSettings,
  defaultSmcSettings,
  effectiveHtf,
  enabledAlertTypes,
  isAutoTradeOn,
  loadSmcSettings,
  saveSmcSettings,
} from '../../../core/charts/smc/smc-settings';
import { PgIconComponent } from '../../../shared/ui/icon/pg-icon.component';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { CapitalPreferenceService } from '../../../core/services/capital-preference.service';
import { KiteFundsService } from '../../../core/services/kite-funds.service';
import { AtmOrderService } from '../../../core/orders/atm-order.service';
import { AtmOptionSide, AtmOrderTicket, atmOrderCost } from '../../../core/orders/atm-order.util';
import { clampChartLots, lotsForChartBook, maxChartLots, sizingCapitalFromFunds } from '../../../core/charts/chart-lots.util';
import {
  chartProtectiveLevels,
  optionSideForAlert,
  shouldAutoTrade,
} from '../../../core/charts/chart-auto-trade.util';
import { RS_PER_LOT } from '../../../core/paper-desk/lots-from-funds';
import { TvCandleChartComponent } from './tv-candle-chart.component';
import { SmcPanelComponent } from './smc-panel.component';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { isKiteAuthError } from '../../../core/utils/kite-auth-error.util';
import { MarketStatus, marketStatusAt } from '../../../core/utils/market-status.util';
import { InstrumentSessionConfig, resolveSessionConfig } from '../../../core/config/session.config';

/** Higher-timeframe candles kept beside a book so the trend filter costs one fetch per bar. */
interface HtfCache {
  interval: ChartInterval;
  day: string;
  candles: Candle[];
  /** The `asOf` clock the candles were read at. */
  asOf: number;
}

interface ChartPane {
  def: ChartBookDef;
  symbol: string;
  /** Trading hours for this book's exchange. */
  session: InstrumentSessionConfig;
  token: number | null;
  candles: Candle[];
  /** Clock the candles were read at; re-analysis must not move it forward. */
  asOf: Date | null;
  htf: HtfCache | null;
  smc: SmcAnalysis | null;
  quote: ChartQuote | null;
  error: string | null;
  loading: boolean;
  updatedAt: string | null;
  /** Outcome of the last manual ATM buy on this book. */
  order: OrderFeedback | null;
  /** Side currently being resolved/placed, so only that button shows busy. */
  ordering: AtmOptionSide | null;
}

interface OrderFeedback {
  ok: boolean;
  text: string;
}

export interface SmcFeedItem extends SmcAlertEvent {
  book: ChartBookId;
  bookLabel: string;
  /** Wall-clock time the alert reached the tab. */
  at: string;
}

interface NumericField {
  key: keyof SmcConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}

const INTERVALS = CHART_INTERVALS;
/**
 * Poll cadence per entry timeframe.
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
const FEED_LIMIT = 40;

const NUMERIC_FIELDS: readonly NumericField[] = [
  { key: 'riskPerTradePct', label: 'Risk per trade %', min: 0.05, max: 100, step: 0.1, hint: 'Share of equity risked to the stop' },
  { key: 'minRR', label: 'Minimum RR', min: 0.5, max: 20, step: 0.5, hint: 'Setups below 1 : RR are rejected' },
  { key: 'targetMultiplier', label: 'Target multiplier', min: 0.5, max: 10, step: 0.25, hint: 'Final TP = minimum RR × this' },
  { key: 'maxOpenPositions', label: 'Max open positions', min: 1, max: 10, step: 1, hint: 'Per market' },
  { key: 'swingLength', label: 'Swing length', min: 1, max: 20, step: 1, hint: 'Bars each side of a pivot' },
];

@Component({
  selector: 'app-live-charts',
  standalone: true,
  imports: [TvCandleChartComponent, SmcPanelComponent, PgIconComponent, RouterLink],
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
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly alertTracker = new SmcAlertTracker();

  protected readonly intervals = INTERVALS;
  protected readonly intervalLabels = CHART_INTERVAL_LABELS;
  protected readonly numericFields = NUMERIC_FIELDS;
  protected readonly alertTypes = SMC_ALERT_TYPES;
  protected readonly alertLabels = SMC_ALERT_LABELS;
  protected readonly layerOptions: readonly { key: keyof SmcLayers; label: string }[] = [
    { key: 'session', label: 'Day High / Low, IDM, SL–PE–TG, zones' },
    { key: 'structure', label: 'BOS / CHoCH' },
    { key: 'swings', label: 'Swings HH HL LH LL' },
    { key: 'orderBlocks', label: 'Order blocks' },
    { key: 'fvg', label: 'Fair value gaps' },
    { key: 'liquidity', label: 'Liquidity & equal H/L' },
    { key: 'premiumDiscount', label: 'Premium / discount' },
    { key: 'fib', label: 'Fibonacci & golden zone' },
    { key: 'levels', label: 'Entry, SL & TP levels' },
  ];
  protected readonly chartBooks = CHART_BOOKS;

  protected readonly settings = signal<SmcSettings>(
    loadSmcSettings(this.isBrowser ? safeStorage() : null),
  );
  protected readonly ltf = computed(() => this.settings().ltf);
  protected readonly htf = computed(() => effectiveHtf(this.settings().ltf, this.settings().htf));
  protected readonly layers = computed(() => this.settings().layers);
  protected readonly entryMinutes = computed(() => chartIntervalMinutes(this.ltf()));

  /** Newest first; only alerts that fired while the tab was watching. */
  protected readonly feed = signal<SmcFeedItem[]>([]);
  protected readonly autoRefresh = signal(true);
  /** One calendar day. Start and end are the same — live when it is today. */
  protected readonly testDate = signal(istToday());
  protected readonly refreshing = signal(false);
  protected readonly panes = signal<ChartPane[]>(
    CHART_BOOKS.map((def) => ({
      def,
      symbol: def.label,
      session: SESSIONS[def.id],
      token: null,
      candles: [],
      asOf: null,
      htf: null,
      smc: null,
      quote: null,
      error: null,
      loading: true,
      updatedAt: null,
      order: null,
      ordering: null,
    })),
  );

  protected readonly anyError = computed(() => this.panes().some((p) => p.error));

  /**
   * Re-read on every scheduler tick so the badges cross the open and the close
   * on their own rather than waiting for the next candle to land.
   */
  private readonly clock = signal(Date.now());

  protected readonly todayIst = computed(() => istToday(new Date(this.clock())));

  /** Today is live; any earlier date is a replayed session (backtest only). */
  protected readonly liveDay = computed(() => isLiveChartDay(this.testDate(), new Date(this.clock())));

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
  protected readonly derivedInterval = computed(
    () => this.data.isDerived(this.ltf()) || this.data.isDerived(this.htf()),
  );

  protected readonly refreshSeconds = computed(() => REFRESH_MS[this.ltf()] / 1000);

  protected readonly notificationsSupported = this.isBrowser && typeof Notification !== 'undefined';

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

  ngOnInit(): void {
    if (!this.isBrowser) {
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

  ngOnDestroy(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
    }
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
      if (now - (this.lastPollAt.get(id) ?? 0) >= REFRESH_MS[this.ltf()]) {
        due.push(id);
      }
    }
    return due;
  }

  // ── Settings ────────────────────────────────────────────────────────────

  private commit(next: SmcSettings): void {
    this.settings.set(next);
    saveSmcSettings(this.isBrowser ? safeStorage() : null, next);
  }

  protected setLtf(next: ChartInterval): void {
    const current = this.settings();
    if (current.ltf === next) return;
    this.commit({ ...current, ltf: next });
    this.reloadAll();
  }

  protected setHtf(next: ChartInterval): void {
    const current = this.settings();
    if (current.htf === next) return;
    this.commit({ ...current, htf: next });
    this.reloadAll();
  }

  protected configValue<K extends keyof SmcConfig>(key: K): SmcConfig[K] {
    const override = this.settings().config[key];
    return (override ?? DEFAULT_SMC_CONFIG[key]) as SmcConfig[K];
  }

  protected setConfigNumber(field: NumericField, event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    const value = Math.min(field.max, Math.max(field.min, raw));
    this.patchConfig({ [field.key]: value } as Partial<SmcConfig>);
  }

  protected setSlMethod(event: Event): void {
    this.patchConfig({ slMethod: (event.target as HTMLSelectElement).value as SmcConfig['slMethod'] });
  }

  protected setTpMethod(event: Event): void {
    this.patchConfig({ tpMethod: (event.target as HTMLSelectElement).value as SmcConfig['tpMethod'] });
  }

  protected toggleHtfFilter(event: Event): void {
    this.patchConfig({ requireHtfTrend: (event.target as HTMLInputElement).checked });
  }

  private patchConfig(patch: Partial<SmcConfig>): void {
    const current = this.settings();
    this.commit({ ...current, config: { ...current.config, ...patch } });
    this.reanalyzeAll();
  }

  protected toggleLayer(key: keyof SmcLayers): void {
    const current = this.settings();
    this.commit({ ...current, layers: { ...current.layers, [key]: !current.layers[key] } });
  }

  protected toggleAlert(type: SmcAlertType): void {
    const current = this.settings();
    this.commit({ ...current, alerts: { ...current.alerts, [type]: !current.alerts[type] } });
  }

  protected async toggleBrowserNotifications(): Promise<void> {
    const current = this.settings();
    if (current.browserNotifications) {
      this.commit({ ...current, browserNotifications: false });
      return;
    }
    if (!this.notificationsSupported) return;
    const permission =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
    this.commit({ ...this.settings(), browserNotifications: permission === 'granted' });
  }

  protected resetSettings(): void {
    const before = this.settings();
    const next = defaultSmcSettings();
    next.browserNotifications = before.browserNotifications;
    this.commit(next);
    if (before.ltf !== next.ltf || before.htf !== next.htf) {
      this.reloadAll();
    } else {
      this.reanalyzeAll();
    }
  }

  protected isAlertOn(type: SmcAlertType): boolean {
    return this.settings().alerts[type];
  }

  protected clearFeed(): void {
    this.feed.set([]);
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  protected toggleAutoRefresh(): void {
    this.autoRefresh.update((on) => !on);
  }

  protected refreshAll(): Promise<void> {
    return this.refreshPanes(CHART_BOOKS.map((def) => def.id));
  }

  /** Drop everything shown and read it again: timeframe or date changed. */
  private reloadAll(): void {
    this.alertTracker.reset();
    this.panes.update((list) =>
      list.map((pane) => ({
        ...pane,
        loading: true,
        candles: [],
        asOf: null,
        htf: null,
        smc: null,
        quote: null,
        order: null,
        error: null,
      })),
    );
    void this.refreshAll();
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
        this.lastPollAt.set(id, Date.now());
        if (!(await this.refreshBook(id))) {
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
  private async refreshBook(id: ChartBookId): Promise<boolean> {
    const day = this.testDate();
    const ltf = this.ltf();
    const htf = this.htf();
    try {
      const asOf = chartCandleAsOf(day);
      const instrument = await this.data.resolveInstrument(id, asOf);
      const candles = await this.data.loadCandles({
        token: instrument.token,
        interval: ltf,
        now: asOf,
      });
      if (this.superseded(ltf, htf, day)) {
        return true;
      }
      if (!candles.length) {
        this.patch(id, {
          error:
            id === 'crude'
              ? `No Crude candles on ${day} — that day's CRUDEOILM contract has expired out of the instrument list.`
              : `Kite returned no ${this.intervalLabels[ltf]} candles for ${day}.`,
          loading: false,
          candles: [],
          asOf: null,
          smc: null,
          quote: null,
          symbol: instrument.symbol,
        });
        return true;
      }

      const htfCache = await this.ensureHtf(id, instrument.token, ltf, htf, day, asOf);
      if (this.superseded(ltf, htf, day)) {
        return true;
      }
      const smc = this.analyze(id, candles, htfCache, asOf);
      this.patch(id, {
        symbol: instrument.symbol,
        token: instrument.token,
        candles,
        asOf,
        htf: htfCache,
        smc,
        quote: chartQuote(candles),
        error: null,
        loading: false,
        updatedAt: new Date().toLocaleTimeString('en-IN', { hour12: false }),
      });
      this.announce(id, smc, false);
      return true;
    } catch (error) {
      if (this.superseded(ltf, htf, day)) {
        return true;
      }
      this.patch(id, {
        error: formatUnknownError(error, 'Charts'),
        loading: false,
        candles: [],
        asOf: null,
        smc: null,
        quote: null,
      });
      return !isKiteAuthError(error);
    }
  }

  private superseded(ltf: ChartInterval, htf: ChartInterval, day: string): boolean {
    return this.ltf() !== ltf || this.htf() !== htf || this.testDate() !== day;
  }

  /**
   * Higher-timeframe candles for the trend filter.
   *
   * Read again only when the timeframe or date changed, or when the newest
   * cached bar has closed since it was read (so its final high/low is in).
   * Any failure falls back to a trend derived from the entry candles rather
   * than losing the chart.
   */
  private async ensureHtf(
    id: ChartBookId,
    token: number,
    ltf: ChartInterval,
    htf: ChartInterval,
    day: string,
    asOf: Date,
  ): Promise<HtfCache | null> {
    if (chartIntervalMinutes(htf) <= chartIntervalMinutes(ltf)) {
      return null;
    }
    const cached = this.paneById(id)?.htf ?? null;
    if (cached && cached.interval === htf && cached.day === day && !this.htfStale(cached, htf, asOf)) {
      return cached;
    }
    try {
      await delay(BOOK_STAGGER_MS);
      const candles = await this.data.loadCandles({ token, interval: htf, now: asOf });
      return candles.length ? { interval: htf, day, candles, asOf: asOf.getTime() } : null;
    } catch {
      return cached && cached.interval === htf && cached.day === day ? cached : null;
    }
  }

  private htfStale(cache: HtfCache, htf: ChartInterval, asOf: Date): boolean {
    const last = cache.candles[cache.candles.length - 1];
    if (!last) return true;
    const end = Date.parse(last.date) + chartIntervalMinutes(htf) * 60_000;
    return Number.isFinite(end) && end <= asOf.getTime() && cache.asOf < end;
  }

  private analyze(
    id: ChartBookId,
    candles: Candle[],
    htf: HtfCache | null,
    asOf: Date,
  ): SmcAnalysis {
    const ltf = this.ltf();
    const htfInterval = this.htf();
    return analyzeSmc({
      market: id,
      candles,
      intervalMinutes: chartIntervalMinutes(ltf),
      htf: htf ? { candles: htf.candles, minutes: chartIntervalMinutes(htf.interval) } : null,
      htfMinutes: chartIntervalMinutes(htfInterval),
      now: asOf,
      live: this.liveDay(),
      config: this.settings().config,
    });
  }

  /** Settings changed: recompute from the candles already held, no refetch. */
  private reanalyzeAll(): void {
    this.panes.update((list) =>
      list.map((pane) =>
        pane.candles.length && pane.asOf
          ? { ...pane, smc: this.analyze(pane.def.id, pane.candles, pane.htf, pane.asOf) }
          : pane,
      ),
    );
    // New parameters mean a different history; it is a baseline, not news.
    for (const pane of this.panes()) {
      if (pane.smc) this.announce(pane.def.id, pane.smc, true);
    }
  }

  // ── Alerts ──────────────────────────────────────────────────────────────

  private alertScope(id: ChartBookId): string {
    return `${id}|${this.ltf()}|${this.htf()}|${this.testDate()}`;
  }

  /**
   * Feed newly confirmed events to the alert list. A replayed date never
   * alerts, and the first batch a stream sees — or the first after a settings
   * change — is history, remembered silently.
   */
  private announce(id: ChartBookId, smc: SmcAnalysis, rebaseline: boolean): void {
    const scope = this.alertScope(id);
    if (!this.liveDay()) {
      this.alertTracker.reset(scope);
      return;
    }
    if (rebaseline) {
      this.alertTracker.reset(scope);
    }
    const fresh = this.alertTracker.ingest(scope, smc.alerts, enabledAlertTypes(this.settings()));
    if (!fresh.length) return;
    const def = CHART_BOOKS.find((book) => book.id === id);
    const at = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const items: SmcFeedItem[] = fresh
      .map((event) => ({ ...event, book: id, bookLabel: def?.label ?? id, at }))
      .reverse();
    this.feed.update((list) => [...items, ...list].slice(0, FEED_LIMIT));
    if (this.settings().browserNotifications) {
      for (const item of items.slice().reverse()) this.notify(item);
    }
    for (const item of items.slice().reverse()) {
      void this.fireAuto(id, item.type);
    }
  }

  private notify(item: SmcFeedItem): void {
    if (!this.notificationsSupported || Notification.permission !== 'granted') return;
    try {
      new Notification(`${item.bookLabel} · ${SMC_ALERT_LABELS[item.type]}`, {
        body: item.message,
        tag: item.id,
      });
    } catch {
      // Some browsers only allow notifications from a service worker.
    }
  }

  // ── Date ────────────────────────────────────────────────────────────────

  protected setTestDate(value: string): void {
    const today = this.todayIst();
    const next = value && value <= today ? value : today;
    if (next === this.testDate()) return;
    this.testDate.set(next);
    this.reloadAll();
  }

  protected jumpToToday(): void {
    this.setTestDate(this.todayIst());
  }

  protected onTestDateInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    this.setTestDate(value);
  }

  // ── Manual ATM orders ───────────────────────────────────────────────────

  private paneById(id: ChartBookId): ChartPane | undefined {
    return this.panes().find((pane) => pane.def.id === id);
  }

  protected toggleAutoTrade(id: ChartBookId): void {
    const current = this.settings();
    this.commit({
      ...current,
      autoTrade: { ...current.autoTrade, [id]: !current.autoTrade[id] },
    });
  }

  protected autoOn(id: ChartBookId): boolean {
    return isAutoTradeOn(this.settings(), id);
  }

  private async fireAuto(id: ChartBookId, type: SmcAlertType): Promise<void> {
    const pane = this.paneById(id);
    if (!pane) return;
    if (
      !shouldAutoTrade({
        autoTrade: isAutoTradeOn(this.settings(), id),
        liveDay: this.liveDay(),
        marketOpen: this.statusOf(pane).open,
        busy: !!pane.ordering,
        type,
      })
    ) {
      return;
    }
    const side = optionSideForAlert(type);
    if (!side) return;
    await this.buyAtm(id, side, { silent: true });
  }

  /**
   * Buy the ATM CE or PE on one book.
   *
   * Resolve the exact contract and its live premium first, then show both and
   * the rupee cost in a confirmation before anything is sent — unless Auto
   * fired the same path, in which case the confirmation is skipped because
   * the reader already armed it. A 25% premium stop and 0.5R target rest
   * after the fill on both routes.
   */
  protected async buyAtm(
    id: ChartBookId,
    side: AtmOptionSide,
    opts: { silent?: boolean } = {},
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

    const spot = pane.quote?.price;
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
      if (!opts.silent && !(await this.confirmBuy(pane, ticket, premium))) {
        return false;
      }

      const result = await this.orders.place(ticket);
      if (!result.ok) {
        this.patch(id, { order: { ok: false, text: result.message } });
        return false;
      }

      const fill = await this.orders.fillPrice(result.orderId, premium);
      const levels = fill != null ? chartProtectiveLevels(fill) : null;
      const extras: string[] = [];
      if (levels) {
        const sl = await this.orders.placeStop(ticket, levels.stop);
        extras.push(sl.message);
        const tp = await this.orders.placeTarget(ticket, levels.target);
        extras.push(tp.message);
      }
      const tag = opts.silent ? 'Auto · ' : '';
      this.patch(id, {
        order: {
          ok: true,
          text: `${tag}${shortSymbol(ticket)} · ${result.message}${extras.length ? ' · ' + extras.join(' ') : ''}`,
        },
      });
      return true;
    } finally {
      this.patch(id, { ordering: null });
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
      'This is a real order at market price. A 25% premium stop and a 0.5R',
      "target rest after the fill. The desk's daily limits do not apply.",
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

  /** Funds ladder: ₹40,000 per index lot, Crude 3× that band. */
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
    return this.liveDay() && !!pane.quote && this.statusOf(pane).open;
  }

  protected orderHintFor(pane: ChartPane): string {
    if (!this.liveDay()) {
      return `Viewing ${this.testDate()} — switch to today to trade`;
    }
    return this.statusOf(pane).open ? '' : this.statusOf(pane).detail;
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

  protected barCount(pane: ChartPane): number {
    return pane.candles.length;
  }

  protected tradeCount(pane: ChartPane): number {
    return pane.smc?.trades.length ?? 0;
  }

  protected trackFeed = (_: number, item: SmcFeedItem) => `${item.book}|${item.id}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Strike and side are what identify the trade in a one-line result. */
function shortSymbol(ticket: AtmOrderTicket): string {
  return `${ticket.strike}${ticket.side}`;
}

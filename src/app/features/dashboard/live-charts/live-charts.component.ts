/**
 * Charts tab — trend cards for Nifty 50, Bank Nifty, Sensex and Crude.
 * Uptrend, downtrend or sideways comes from the same SMC trend that gates entries.
 * Sensex is display-only: it never places an order.
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
 * Auto is per book unless Protect is on: then the droplet is the brain — lots
 * from funds, one book, first fill then stand down. This tab only places if
 * the droplet is unreachable. Auto buys the ATM call on a confirmed BUY and
 * the ATM put on a confirmed SELL. On Nifty, Bank Nifty and Crude the stop
 * rests at Kite; the target is watched on the droplet (and this tab as backup)
 * and the stop is cancelled before any sell. See AtmOrderService.
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
  ChartBookId,
  LiveChartDataService,
  TREND_BOOKS,
  TrendBookDef,
  TrendBookId,
  isTradableChartBook,
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
  isProtectOn,
  loadSmcSettings,
  saveSmcSettings,
} from '../../../core/charts/smc/smc-settings';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { CapitalPreferenceService } from '../../../core/services/capital-preference.service';
import { KiteFundsService } from '../../../core/services/kite-funds.service';
import { AtmOrderService } from '../../../core/orders/atm-order.service';
import { AtmOptionSide, AtmOrderTicket, atmOrderCost, atmRupeePerPoint } from '../../../core/orders/atm-order.util';
import { ChartsProtectApiService, ChartsProtectView } from '../../../core/charts/charts-protect-api.service';
import { clampChartLots, lotsForChartBook, maxChartLots, sizingCapitalFromFunds } from '../../../core/charts/chart-lots.util';
import {
  chartProtectiveLevels,
  desiredProtectiveLevels,
  fillsHittingPlannedLevels,
  fillsNeedingProtectiveSync,
  optionSideForAlert,
  shouldAutoTrade,
} from '../../../core/charts/chart-auto-trade.util';
import {
  applyProtectCloses,
  decideProtectAuto,
  loadProtectDay,
  markProtectPlaced,
  openProtectBooks,
  protectBookArmed,
  protectStatusLine,
  saveProtectDay,
} from '../../../core/charts/chart-protect.util';
import {
  anyCapSet,
  capDraftFromCaps,
  capsEqual,
  capsFromDraft,
  fillsToFlatten,
} from '../../../core/charts/chart-pnl-cap';
import {
  ChartLiveStatus,
  ChartLiveTrade,
  TRADE_STATUS_LABELS,
  localChartTrade,
  mergeChartLiveTrades,
} from '../../../core/charts/chart-live-trades';
import { RS_PER_LOT } from '../../../core/paper-desk/lots-from-funds';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { isKiteAuthError } from '../../../core/utils/kite-auth-error.util';
import { MarketStatus, istClockParts, marketStatusAt } from '../../../core/utils/market-status.util';
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
  def: TrendBookDef;
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
/** Trend cards always poll on this cadence. The hint on the page names it. */
const TREND_POLL_MS = 15_000;
/** The scheduler ticks at the fastest cadence and each interval skips its turns. */
const TICK_MS = 5_000;
/** Crude is MCX and runs to 23:30. NSE and BSE cash stop at 15:30. */
const SESSIONS: Record<ChartBookId, InstrumentSessionConfig> = {
  crude: resolveSessionConfig({ exchange: 'MCX' }),
  nifty: resolveSessionConfig({ exchange: 'NSE' }),
  bank: resolveSessionConfig({ exchange: 'NSE' }),
};
const TREND_SESSIONS: Record<TrendBookId, InstrumentSessionConfig> = {
  ...SESSIONS,
  sensex: resolveSessionConfig({ exchange: 'BSE' }),
};
/** Kite historical allows 3 req/s; keep a gap so the four trend books never trip it. */
const BOOK_STAGGER_MS = 350;
const FEED_LIMIT = 40;
/** Orders/positions for the live-trades board — slower than candle polls. */
const TRADE_POLL_MS = 15_000;
/** When a rupee cap is set, watch fills at the scheduler tick so a gap is not 15s late. */
const CAP_POLL_MS = 5_000;
/** How often to ask the droplet whether it is placing and what it last did. */
const DROPLET_POLL_MS = 15_000;

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
  imports: [RouterLink],
  templateUrl: './live-charts.component.html',
  styleUrl: './live-charts.component.css',
})
export class LiveChartsComponent implements OnInit, OnDestroy {
  private readonly data = inject(LiveChartDataService);
  private readonly orders = inject(AtmOrderService);
  private readonly kiteFunds = inject(KiteFundsService);
  private readonly protectApi = inject(ChartsProtectApiService);
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
  protected readonly capDraft = signal(capDraftFromCaps(this.settings().pnlCaps));
  protected readonly capsDirty = computed(
    () => !capsEqual(capsFromDraft(this.capDraft()), this.settings().pnlCaps),
  );
  protected readonly capsSavedNote = signal<string | null>(null);
  protected readonly ltf = computed(() => this.settings().ltf);
  protected readonly htf = computed(() => effectiveHtf(this.settings().ltf, this.settings().htf));
  protected readonly layers = computed(() => this.settings().layers);
  protected readonly entryMinutes = computed(() => chartIntervalMinutes(this.ltf()));

  /** Newest first; only alerts that fired while the tab was watching. */
  protected readonly feed = signal<SmcFeedItem[]>([]);
  /** Charts ATM fills with instrument, stop and target — from Kite, plus a local row just after a send. */
  protected readonly liveTrades = signal<ChartLiveTrade[]>([]);
  protected readonly liveTradesReady = signal(false);
  protected readonly liveTradesError = signal<string | null>(null);
  protected readonly autoRefresh = signal(true);
  /** One calendar day. Start and end are the same — live when it is today. */
  protected readonly testDate = signal(istToday());
  protected readonly refreshing = signal(false);
  protected readonly panes = signal<ChartPane[]>(
    TREND_BOOKS.map((def) => ({
      def,
      symbol: def.label,
      session: TREND_SESSIONS[def.id],
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

  protected readonly openTradeCount = computed(
    () => this.liveTrades().filter((t) => t.status === 'OPEN' || t.status === 'WORKING').length,
  );

  protected readonly anyCapWatching = computed(() => anyCapSet(this.settings().pnlCaps));

  /**
   * Re-read on every scheduler tick so the badges cross the open and the close
   * on their own rather than waiting for the next candle to land.
   */
  private readonly clock = signal(Date.now());

  /** Today's Protect lock — survives refresh so a win is not given back. */
  protected readonly protectDay = signal(
    loadProtectDay(this.isBrowser ? safeStorage() : null, istToday()),
  );

  protected readonly protectOn = computed(() => isProtectOn(this.settings()));
  protected readonly protectDroplet = signal<ChartsProtectView | null>(null);
  private wakeLock: WakeLockSentinel | null = null;

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

  protected readonly refreshSeconds = computed(() => TREND_POLL_MS / 1000);

  protected readonly notificationsSupported = this.isBrowser && typeof Notification !== 'undefined';

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Guards against a slow poll overlapping the next tick. */
  private inFlight = false;
  /** Date/interval change while a sweep is in the air. */
  private pendingAll = false;
  private readonly lastPollAt = new Map<TrendBookId, number>();
  /** Last seen session state per book, so the close can be caught as it happens. */
  private readonly wasOpen = new Map<TrendBookId, boolean>();
  /** Once a reader taps +/−, that book keeps their count instead of following funds. */
  private readonly lotsOverride = signal<Partial<Record<ChartBookId, number>>>({});
  private lastTradePollAt = 0;
  private tradesInFlight = false;
  /** Just-sent fills held until Kite lists that contract. */
  private readonly pendingLocal = new Map<string, ChartLiveTrade>();
  /** Fill ids currently being flattened so a cap cannot double-sell the same fill. */
  private readonly flattenInFlight = new Set<string>();
  /** Protect only sends one ATM at a time, even if two books alert on the same tick. */
  private protectBusy = false;
  private lastDropletPoll = 0;
  /** Fill ids whose SL/TP are being moved to a newly edited cap. */
  private readonly protectSyncInFlight = new Set<string>();
  /** Last cap fingerprint successfully applied to an open fill, so Kite lag does not rest a second SL. */
  private readonly syncedProtectives = new Map<string, string>();
  /** Instruments that just got a broker SL — do not rest a second SELL while Kite catches up. */
  private readonly slPlacedAt = new Map<string, number>();

  /** Higher-timeframe trend when it exists, otherwise the entry-timeframe trend. */
  protected lamp(pane: ChartPane): 'up' | 'down' | 'side' | 'wait' {
    if (!pane.smc) return 'wait';
    const trend = pane.smc.snapshot.trend;
    if (trend === 'bullish') return 'up';
    if (trend === 'bearish') return 'down';
    return 'side';
  }

  protected lampLabel(pane: ChartPane): string {
    const lamp = this.lamp(pane);
    if (lamp === 'up') return 'Uptrend';
    if (lamp === 'down') return 'Downtrend';
    if (lamp === 'side') return 'Sideways';
    return pane.error ? 'Unavailable' : 'Reading';
  }

  /**
   * Short read of whether the printed trend still agrees with itself.
   * Agreement means continue. Sideways, a split between timeframes, or a
   * change-of-character against the trend means wait.
   */
  protected signalLabel(pane: ChartPane): string {
    const snap = pane.smc?.snapshot;
    if (!snap) return pane.error ? 'Unavailable' : 'Reading';
    const trend = snap.trend;
    if (trend !== 'bullish' && trend !== 'bearish') return 'Wait, it may change';
    if (snap.htfTrend && snap.ltfTrend && snap.htfTrend !== snap.ltfTrend) {
      return 'Wait, it may change';
    }
    if (trend === 'bullish' && snap.lastChoch === 'Bearish') return 'Wait, it may change';
    if (trend === 'bearish' && snap.lastChoch === 'Bullish') return 'Wait, it may change';
    return 'Trend will continue';
  }

  ngOnInit(): void {
    if (!this.isBrowser) {
      return;
    }
    // One load regardless of the clock: a shut market should still show the
    // session that just ended rather than an empty frame.
    void this.kiteFunds.refresh();
    void this.refreshAll();
    void this.refreshLiveTrades();
    if (this.protectOn()) void this.syncProtectToDroplet(true);
    if (this.isBrowser) {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    this.timer = setInterval(() => {
      this.clock.set(Date.now());
      this.rollProtectDay();
      if (!this.autoRefresh()) return;
      // Protect must keep polling in a background tab — that is how 0.5R
      // entries fire without someone staring at the chart. Hidden skip stays
      // only when Protect is off (display-only).
      if (typeof document !== 'undefined' && document.hidden && !this.protectOn()) return;
      const due = this.duePanes();
      if (due.length) {
        void this.refreshPanes(due);
      }
      if (this.liveDay()) {
        void this.refreshLiveTrades();
      }
      if (this.protectOn() && Date.now() - this.lastDropletPoll >= DROPLET_POLL_MS) {
        this.lastDropletPoll = Date.now();
        void this.refreshProtectDroplet();
      }
    }, TICK_MS);
  }

  ngOnDestroy(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
    }
    if (this.isBrowser) {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    void this.wakeLock?.release();
    this.wakeLock = null;
  }

  /**
   * Books worth polling on this tick.
   *
   * A shut book is skipped — its candles cannot change. The one exception is
   * the tick that notices the close: the final bar completes exactly at the
   * closing bell, so each book gets one last read on the way out.
   */
  private duePanes(): TrendBookId[] {
    if (!this.liveDay()) return [];
    const now = Date.now();
    const clock = new Date(this.clock());
    const due: TrendBookId[] = [];
    for (const pane of this.panes()) {
      const id = pane.def.id;
      const open = marketStatusAt(pane.session, clock).open;
      const justClosed = !open && this.wasOpen.get(id) === true;
      this.wasOpen.set(id, open);
      if (justClosed) {
        due.push(id);
        continue;
      }
      if (!open) continue;
      if (now - (this.lastPollAt.get(id) ?? 0) >= TREND_POLL_MS) {
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
    this.capDraft.set(capDraftFromCaps(next.pnlCaps));
    this.capsSavedNote.set(null);
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
    return this.refreshPanes(TREND_BOOKS.map((def) => def.id));
  }

  /**
   * Rebuild the Live trades board from today's Kite orders and positions.
   * Throttled to TRADE_POLL_MS so candle ticks do not burn order-book quota.
   */
  protected async refreshLiveTrades(force = false): Promise<void> {
    if (this.tradesInFlight) return;
    const now = Date.now();
    if (!force && now - this.lastTradePollAt < this.tradePollMs()) return;
    this.tradesInFlight = true;
    this.lastTradePollAt = now;
    try {
      const remote = await this.orders.chartLiveTrades();
      if (remote == null) {
        this.liveTradesError.set('Connect Kite to see live fills.');
        this.liveTradesReady.set(true);
        return;
      }
      this.liveTradesError.set(null);
      for (const trade of remote) this.pendingLocal.delete(trade.instrument);
      this.liveTrades.set(
        this.withPlannedTargets(mergeChartLiveTrades(remote, [...this.pendingLocal.values()])),
      );
      this.liveTradesReady.set(true);
    } catch {
      this.liveTradesError.set("Could not read today's Charts fills.");
      this.liveTradesReady.set(true);
    } finally {
      this.tradesInFlight = false;
    }
    if (!this.liveTradesError()) {
      void this.afterLiveTrades(this.liveTrades());
    }
  }

  private noteLocalTrade(input: {
    book: ChartBookId;
    instrument: string;
    exchange: string;
    side: AtmOptionSide;
    qty: number;
    entry: number | null;
    sl: number | null;
    tp: number | null;
  }): void {
    const trade = localChartTrade(input);
    this.pendingLocal.set(trade.instrument, trade);
    this.liveTrades.update((list) =>
      this.withPlannedTargets(
        mergeChartLiveTrades(
          list.filter((row) => row.instrument !== trade.instrument),
          [trade],
        ),
      ),
    );
  }

  protected statusLabel(status: ChartLiveStatus): string {
    return TRADE_STATUS_LABELS[status];
  }

  private tradePollMs(): number {
    return anyCapSet(this.settings().pnlCaps) ? CAP_POLL_MS : TRADE_POLL_MS;
  }

  protected capValue(id: ChartBookId, key: 'maxProfitRs' | 'maxLossRs'): string {
    return this.capDraft()[id][key];
  }

  protected setCap(id: ChartBookId, key: 'maxProfitRs' | 'maxLossRs', event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.capsSavedNote.set(null);
    this.capDraft.update((draft) => ({
      ...draft,
      [id]: { ...draft[id], [key]: raw },
    }));
  }

  /** Persist the six boxes. Typing is a draft until this runs. */
  protected saveCaps(): void {
    const pnlCaps = capsFromDraft(this.capDraft());
    this.commit({ ...this.settings(), pnlCaps });
    this.capDraft.set(capDraftFromCaps(pnlCaps));
    const bits = this.chartBooks.map((book) => {
      const cap = pnlCaps[book.id];
      const profit = cap.maxProfitRs == null ? 'system' : `₹${cap.maxProfitRs}`;
      const loss = cap.maxLossRs == null ? 'system' : `₹${cap.maxLossRs}`;
      return `${book.label} ${profit} / ${loss}`;
    });
    this.capsSavedNote.set(`Saved. ${bits.join(' · ')}`);
    if (this.liveDay()) {
      void this.refreshLiveTrades(true);
    }
  }

  protected onCapKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.saveCaps();
  }

  private async afterLiveTrades(trades: ChartLiveTrade[]): Promise<void> {
    this.syncProtectFromTrades(trades);
    const flattened = await this.enforcePnlCaps(trades);
    if (flattened) {
      void this.refreshLiveTrades(true);
      return;
    }
    const synced = await this.syncOpenProtectives(this.liveTrades());
    if (synced) void this.refreshLiveTrades(true);
  }

  /**
   * If this book's rupee cap is set and THIS open fill has crossed it, cancel
   * the resting SL/TP and market-exit that contract. The next fill on the
   * same chart (new id) is watched again with the same cap.
   */
  private async enforcePnlCaps(trades: ChartLiveTrade[]): Promise<boolean> {
    const caps = this.settings().pnlCaps;
    const openIds = new Set(trades.filter((t) => t.status === 'OPEN').map((t) => t.id));
    for (const id of [...this.flattenInFlight]) {
      if (!openIds.has(id)) this.flattenInFlight.delete(id);
    }
    for (const id of [...this.syncedProtectives.keys()]) {
      if (!openIds.has(id)) this.syncedProtectives.delete(id);
    }
    const capHits = fillsToFlatten(trades, caps, this.flattenInFlight);
    const levelHits = fillsHittingPlannedLevels(trades, caps, [
      ...this.flattenInFlight,
      ...capHits.map((h) => h.id),
    ]);
    const hits = [...capHits];
    for (const hit of levelHits) {
      if (!hits.some((row) => row.id === hit.id)) hits.push(hit);
    }
    if (!hits.length) return false;
    const byId = new Map(trades.map((t) => [t.id, t]));
    let anyOk = false;
    for (const hit of hits) {
      const trade = byId.get(hit.id);
      if (!trade) continue;
      if (this.slPlacedRecently(trade.instrument)) continue;
      this.flattenInFlight.add(trade.id);
      const result = await this.orders.flattenChartTrade(trade, hit.reason);
      if (trade.book) this.patch(trade.book, { order: { ok: result.ok, text: result.message } });
      if (result.ok) anyOk = true;
      else this.flattenInFlight.delete(trade.id);
    }
    return anyOk;
  }

  /**
   * After a cap edit (or the first time we see an already-open fill with caps
   * set), move that fill's resting stop and target to the amount now in
   * settings. Unchanged amounts that already match are left alone.
   */
  private async syncOpenProtectives(trades: ChartLiveTrade[]): Promise<boolean> {
    const caps = this.settings().pnlCaps;
    const busy = [...this.flattenInFlight, ...this.protectSyncInFlight];
    const hits = fillsNeedingProtectiveSync(trades, caps, busy).filter((hit) => {
      const fp = this.capFingerprint(hit);
      return this.syncedProtectives.get(hit.id) !== fp;
    });
    if (!hits.length) return false;
    const byId = new Map(trades.map((t) => [t.id, t]));
    let started = false;
    for (const hit of hits) {
      const trade = byId.get(hit.id);
      if (!trade) continue;
      if (this.slPlacedRecently(trade.instrument)) continue;
      this.protectSyncInFlight.add(trade.id);
      const result = await this.orders.replaceChartProtectives(trade, {
        stop: hit.stop,
        target: hit.target,
      });
      if (trade.book) this.patch(trade.book, { order: { ok: result.ok, text: result.message } });
      if (result.ok) {
        this.syncedProtectives.set(trade.id, this.capFingerprint(hit));
        started = true;
      }
      this.protectSyncInFlight.delete(trade.id);
    }
    return started;
  }

  private capFingerprint(hit: { stop: number; target: number }): string {
    return `${hit.stop}|${hit.target}`;
  }

  private slPlacedRecently(instrument: string): boolean {
    const at = this.slPlacedAt.get(instrument);
    return at != null && Date.now() - at < 15_000;
  }

  /** Show the planned target even though it is not rested at Kite. */
  private withPlannedTargets(trades: ChartLiveTrade[]): ChartLiveTrade[] {
    const caps = this.settings().pnlCaps;
    return trades.map((trade) => {
      if (trade.status !== 'OPEN' || !trade.book || trade.tp != null) return trade;
      const levels = desiredProtectiveLevels(trade, caps[trade.book]);
      return levels ? { ...trade, tp: levels.target, tpState: trade.tpState === '—' ? 'WATCH' : trade.tpState } : trade;
    });
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
  private async refreshPanes(ids: TrendBookId[]): Promise<void> {
    if (!ids.length) return;
    if (this.inFlight) {
      if (ids.length === TREND_BOOKS.length) {
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
      if (ids.length === TREND_BOOKS.length) {
        this.sessionExpired.set(authFailures === TREND_BOOKS.length);
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
  private async refreshBook(id: TrendBookId): Promise<boolean> {
    const day = this.testDate();
    const ltf = this.ltf();
    const htf = this.htf();
    try {
      const asOf = chartCandleAsOf(day);
      const instrument = await this.data.resolveTrendInstrument(id, asOf);
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
      if (isTradableChartBook(id)) this.announce(id, smc, false);
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
    id: TrendBookId,
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
    id: TrendBookId,
    candles: Candle[],
    htf: HtfCache | null,
    asOf: Date,
  ): SmcAnalysis {
    const ltf = this.ltf();
    const htfInterval = this.htf();
    return analyzeSmc({
      market: id === 'sensex' ? 'nifty' : id,
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
      if (pane.smc && isTradableChartBook(pane.def.id)) this.announce(pane.def.id, pane.smc, true);
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

  private paneById(id: TrendBookId): ChartPane | undefined {
    return this.panes().find((pane) => pane.def.id === id);
  }

  protected toggleAutoTrade(id: ChartBookId): void {
    if (this.protectOn()) return;
    const current = this.settings();
    this.commit({
      ...current,
      autoTrade: { ...current.autoTrade, [id]: !current.autoTrade[id] },
    });
  }

  protected toggleProtect(): void {
    const on = !this.protectOn();
    this.commit({ ...this.settings(), protectCapital: on });
    if (on) this.lotsOverride.set({});
    this.rollProtectDay();
    this.syncProtectFromTrades(this.liveTrades());
    void this.syncProtectToDroplet(on);
    void this.syncWakeLock();
  }

  protected protectStatus(): string {
    const now = new Date(this.clock());
    const trends: Partial<Record<ChartBookId, 'bullish' | 'bearish' | 'sideways' | null>> = {};
    for (const pane of this.panes()) {
      if (!isTradableChartBook(pane.def.id)) continue;
      trends[pane.def.id] = pane.smc?.snapshot.htfTrend ?? pane.smc?.snapshot.trend ?? null;
    }
    return protectStatusLine({
      on: this.protectOn(),
      liveDay: this.liveDay(),
      istTime: istClockParts(now).time,
      day: this.protectDay(),
      openBooks: openProtectBooks(this.liveTrades()),
      trends,
    }) + this.protectDropletNote();
  }

  private protectDropletNote(): string {
    const drop = this.protectDroplet();
    if (!this.protectOn()) return '';
    if (drop?.lastError) return ` · droplet: ${drop.lastError}`;
    if (drop?.dropletPlacing) return ' · droplet placing and watching exits';
    if (drop?.dropletWatching) return ' · droplet watching exits — this tab still places';
    return ' · droplet not reached — this tab still places and exits';
  }

  protected autoOn(id: ChartBookId): boolean {
    if (this.protectOn()) {
      return protectBookArmed(id, this.protectDay(), istClockParts(new Date(this.clock())).time);
    }
    return isAutoTradeOn(this.settings(), id);
  }

  protected autoLocked(): boolean {
    return this.protectOn();
  }

  protected autoLabel(id: ChartBookId): string {
    if (!this.protectOn()) return this.autoOn(id) ? 'Auto on' : 'Auto';
    if (this.protectDay().done[id]) return 'Done';
    if (this.protectDay().placed[id]) return 'In fill';
    return this.autoOn(id) ? 'Protect' : 'Wait';
  }

  private async fireAuto(id: ChartBookId, type: SmcAlertType): Promise<void> {
    const pane = this.paneById(id);
    if (!pane) return;
    const side = optionSideForAlert(type);
    if (!side) return;
    if (this.protectOn()) {
      if (this.protectDroplet()?.dropletPlacing) return;
      if (this.protectBusy) return;
      const now = new Date(this.clock());
      const decision = decideProtectAuto({
        book: id,
        type,
        liveDay: this.liveDay(),
        marketOpen: this.statusOf(pane).open,
        busy: !!pane.ordering || this.flatteningBook(id),
        htfTrend: pane.smc?.snapshot.htfTrend ?? pane.smc?.snapshot.trend ?? null,
        istTime: istClockParts(now).time,
        day: this.protectDay(),
        openBooks: openProtectBooks(this.liveTrades()),
      });
      if (!decision.allow) return;
      this.protectBusy = true;
      try {
        await this.buyAtm(id, side, { silent: true });
      } finally {
        this.protectBusy = false;
      }
      return;
    }
    if (
      !shouldAutoTrade({
        autoTrade: isAutoTradeOn(this.settings(), id),
        liveDay: this.liveDay(),
        marketOpen: this.statusOf(pane).open,
        busy: !!pane.ordering || this.flatteningBook(id),
        type,
      })
    ) {
      return;
    }
    await this.buyAtm(id, side, { silent: true });
  }

  private flatteningBook(id: ChartBookId): boolean {
    return this.liveTrades().some((trade) => trade.book === id && this.flattenInFlight.has(trade.id));
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
      const cap = this.settings().pnlCaps[id];
      const levels =
        fill != null
          ? chartProtectiveLevels(fill, 0.05, {
              maxProfitRs: cap.maxProfitRs,
              maxLossRs: cap.maxLossRs,
              rupeePerPoint: atmRupeePerPoint(ticket),
            })
          : null;
      const extras: string[] = [];
      if (levels) {
        extras.push(...(await this.orders.cancelRestingSells(ticket.tradingSymbol)).messages);
        const sl = await this.orders.placeStop(ticket, levels.stop);
        extras.push(sl.message);
        if (sl.ok) this.slPlacedAt.set(ticket.tradingSymbol, Date.now());
      }
      const tag = opts.silent ? 'Auto · ' : '';
      this.patch(id, {
        order: {
          ok: true,
          text: `${tag}${shortSymbol(ticket)} · ${result.message}${extras.length ? ' · ' + extras.join(' ') : ''}`,
        },
      });
      this.noteLocalTrade({
        book: id,
        instrument: ticket.tradingSymbol,
        exchange: ticket.exchange,
        side: ticket.side,
        qty: ticket.quantity,
        entry: fill,
        sl: levels?.stop ?? null,
        tp: levels?.target ?? null,
      });
      void this.refreshLiveTrades(true);
      if (this.protectOn()) this.noteProtectPlaced(id);
      if (this.protectOn() && fill != null && ticket) {
        void this.protectApi.registerFill({
          instrument: ticket.tradingSymbol,
          exchange: ticket.exchange,
          book: id,
          qty: ticket.quantity,
          entry: fill,
          stop: levels?.stop ?? null,
          target: levels?.target ?? null,
        });
      }
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
      'This is a real order at market price. A 25% premium (or rupee-cap) stop',
      'rests after the fill. The target is watched on this tab and the stop is',
      'cancelled before any exit — Kite rejects a second sell while the stop',
      'is live. A hit sells this fill. The next fill on this chart is watched',
      "again with the same cap. The desk's daily limits do not apply.",
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
    if (this.protectOn()) return this.autoLotsFor(id);
    const override = this.lotsOverride()[id];
    if (override != null) return clampChartLots(id, override);
    return this.autoLotsFor(id);
  }

  protected maxLots(id: ChartBookId): number {
    return maxChartLots(id);
  }

  protected bumpLots(id: ChartBookId, step: number): void {
    if (this.protectOn()) return;
    const next = clampChartLots(id, this.lotsFor(id) + step);
    this.lotsOverride.update((current) => ({ ...current, [id]: next }));
  }

  protected fundsLabel(): string {
    const actual = this.kiteFunds.equityAvailable();
    return actual != null && actual > 0 ? 'Kite funds' : 'saved capital';
  }

  protected statusOf(pane: ChartPane): MarketStatus {
    if (isTradableChartBook(pane.def.id)) return this.marketStatus()[pane.def.id];
    return marketStatusAt(pane.session, new Date(this.clock()));
  }

  private patch(id: TrendBookId, patch: Partial<ChartPane>): void {
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

  private rollProtectDay(): void {
    const today = istToday(new Date(this.clock()));
    if (this.protectDay().date === today) return;
    this.persistProtectDay(loadProtectDay(this.isBrowser ? safeStorage() : null, today));
  }

  private noteProtectPlaced(book: ChartBookId): void {
    this.persistProtectDay(markProtectPlaced(this.protectDay(), book));
  }

  private syncProtectFromTrades(trades: ChartLiveTrade[]): void {
    if (!this.protectOn()) return;
    const next = applyProtectCloses(this.protectDay(), trades);
    if (
      next.done.nifty === this.protectDay().done.nifty &&
      next.done.bank === this.protectDay().done.bank &&
      next.done.crude === this.protectDay().done.crude
    ) {
      return;
    }
    this.persistProtectDay(next);
  }

  private persistProtectDay(day: ReturnType<typeof loadProtectDay>): void {
    this.protectDay.set(day);
    saveProtectDay(this.isBrowser ? safeStorage() : null, day);
  }

  private readonly onVisibility = (): void => {
    if (this.protectOn()) void this.syncWakeLock();
  };

  private async syncProtectToDroplet(enabled: boolean): Promise<void> {
    await this.kiteFunds.refresh();
    const view = await this.protectApi.setEnabled(enabled);
    this.protectDroplet.set(view);
    this.lastDropletPoll = Date.now();
  }

  private async refreshProtectDroplet(): Promise<void> {
    const view = await this.protectApi.get();
    if (view) this.protectDroplet.set(view);
  }

  private async syncWakeLock(): Promise<void> {
    if (!this.isBrowser) return;
    try {
      if (this.protectOn() && 'wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } else {
        await this.wakeLock?.release();
        this.wakeLock = null;
      }
    } catch {
      this.wakeLock = null;
    }
  }
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

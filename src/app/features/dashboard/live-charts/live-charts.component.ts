/**
 * Charts tab — live candles with support/resistance for Crude Oil Mini,
 * Nifty 50 and Bank Nifty, at a switchable interval (15m by default).
 *
 * Read-only: this tab only reads Kite historical candles. It places no order
 * and does not touch the live desk.
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
} from '../../../core/charts/chart-intervals.util';
import { PgIconComponent } from '../../../shared/ui/icon/pg-icon.component';
import { TvCandleChartComponent } from './tv-candle-chart.component';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { isKiteAuthError } from '../../../core/utils/kite-auth-error.util';

interface ChartPane {
  def: ChartBookDef;
  symbol: string;
  candles: Candle[];
  model: SrChartModel | null;
  error: string | null;
  loading: boolean;
  updatedAt: string | null;
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
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly intervals = INTERVALS;
  protected readonly intervalLabels = CHART_INTERVAL_LABELS;

  protected readonly interval = signal<ChartInterval>(DEFAULT_INTERVAL);
  protected readonly autoRefresh = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly panes = signal<ChartPane[]>(
    CHART_BOOKS.map((def) => ({
      def,
      symbol: def.label,
      candles: [],
      model: null,
      error: null,
      loading: true,
      updatedAt: null,
    })),
  );

  protected readonly anyError = computed(() => this.panes().some((p) => p.error));

  /**
   * Kite tokens expire daily and the app has no refresh flow, so a dead
   * session is the most likely reason every book fails at once. Say that
   * plainly instead of repeating a Kite error string three times.
   */
  protected readonly sessionExpired = signal(false);

  /** 45m is folded from 15m bars because Kite serves no 45-minute candle. */
  protected readonly derivedInterval = computed(() => this.data.isDerived(this.interval()));

  /** Seconds between polls at the current interval, for the Live button label. */
  protected readonly refreshSeconds = computed(() => REFRESH_MS[this.interval()] / 1000);

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Guards against a slow poll overlapping the next tick. */
  private inFlight = false;
  private lastPollAt = 0;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    void this.refreshAll();
    this.timer = setInterval(() => {
      if (!this.autoRefresh()) return;
      // Nothing to show a hidden tab; skip the Kite call entirely.
      if (typeof document !== 'undefined' && document.hidden) return;
      if (Date.now() - this.lastPollAt < REFRESH_MS[this.interval()]) return;
      void this.refreshAll();
    }, TICK_MS);
  }

  ngOnDestroy(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
    }
  }

  protected setInterval_(next: ChartInterval): void {
    if (next === this.interval()) return;
    this.interval.set(next);
    this.panes.update((list) => list.map((p) => ({ ...p, loading: true })));
    void this.refreshAll();
  }

  protected toggleAutoRefresh(): void {
    this.autoRefresh.update((on) => !on);
  }

  protected async refreshAll(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.lastPollAt = Date.now();
    this.refreshing.set(true);
    const interval = this.interval();
    let authFailures = 0;
    try {
      for (const def of CHART_BOOKS) {
        if (!(await this.refreshBook(def.id, interval))) {
          authFailures += 1;
        }
        if (interval !== this.interval()) {
          // Interval changed mid-sweep; the new sweep owns the panes now.
          return;
        }
        await delay(BOOK_STAGGER_MS);
      }
      // One book failing on auth could be a fluke; all of them is the session.
      this.sessionExpired.set(authFailures === CHART_BOOKS.length);
    } finally {
      this.inFlight = false;
      this.refreshing.set(false);
    }
  }

  /** Resolves false when the book failed because Kite rejected the session. */
  private async refreshBook(id: ChartBookId, interval: ChartInterval): Promise<boolean> {
    try {
      const instrument = await this.data.resolveInstrument(id);
      const candles = await this.data.loadCandles({ token: instrument.token, interval });
      if (!candles.length) {
        this.patch(id, {
          error: `Kite returned no ${this.intervalLabels[interval]} candles.`,
          loading: false,
        });
        return true;
      }
      this.patch(id, {
        symbol: instrument.symbol,
        candles,
        model: buildSrChartModel(candles),
        error: null,
        loading: false,
        updatedAt: new Date().toLocaleTimeString('en-IN', { hour12: false }),
      });
      return true;
    } catch (error) {
      this.patch(id, { error: formatUnknownError(error, 'Charts'), loading: false });
      return !isKiteAuthError(error);
    }
  }

  private patch(id: ChartBookId, patch: Partial<ChartPane>): void {
    this.panes.update((list) =>
      list.map((pane) => (pane.def.id === id ? { ...pane, ...patch } : pane)),
    );
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
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

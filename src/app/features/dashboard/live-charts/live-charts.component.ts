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
import { Candle } from '../../../core/models/candle.model';
import { SrChartModel, SrZone, buildSrChartModel } from '../../../core/charts/sr-chart.util';
import {
  CHART_BOOKS,
  CHART_INTERVAL_LABELS,
  ChartBookDef,
  ChartBookId,
  ChartInterval,
  LiveChartDataService,
} from '../../../core/charts/live-chart-data.service';
import { PgIconComponent } from '../../../shared/ui/icon/pg-icon.component';
import { TvCandleChartComponent } from './tv-candle-chart.component';
import { formatUnknownError } from '../../../core/utils/kite-error.util';

interface ChartPane {
  def: ChartBookDef;
  symbol: string;
  candles: Candle[];
  model: SrChartModel | null;
  error: string | null;
  loading: boolean;
  updatedAt: string | null;
}

const INTERVALS: readonly ChartInterval[] = ['5minute', '15minute', '30minute', '60minute'];
const DEFAULT_INTERVAL: ChartInterval = '15minute';
const REFRESH_MS = 30_000;
/** Kite historical allows 3 req/s; keep a gap so three books never trip it. */
const BOOK_STAGGER_MS = 350;

@Component({
  selector: 'app-live-charts',
  standalone: true,
  imports: [TvCandleChartComponent, PgIconComponent],
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

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Guards against a slow poll overlapping the next tick. */
  private inFlight = false;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    void this.refreshAll();
    this.timer = setInterval(() => {
      if (!this.autoRefresh()) return;
      // Nothing to show a hidden tab; skip the Kite call entirely.
      if (typeof document !== 'undefined' && document.hidden) return;
      void this.refreshAll();
    }, REFRESH_MS);
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
    this.refreshing.set(true);
    const interval = this.interval();
    try {
      for (const def of CHART_BOOKS) {
        await this.refreshBook(def.id, interval);
        if (interval !== this.interval()) {
          // Interval changed mid-sweep; the new sweep owns the panes now.
          return;
        }
        await delay(BOOK_STAGGER_MS);
      }
    } finally {
      this.inFlight = false;
      this.refreshing.set(false);
    }
  }

  private async refreshBook(id: ChartBookId, interval: ChartInterval): Promise<void> {
    try {
      const instrument = await this.data.resolveInstrument(id);
      const candles = await this.data.loadCandles({ token: instrument.token, interval });
      if (!candles.length) {
        this.patch(id, {
          error: `Kite returned no ${this.intervalLabels[interval]} candles.`,
          loading: false,
        });
        return;
      }
      this.patch(id, {
        symbol: instrument.symbol,
        candles,
        model: buildSrChartModel(candles),
        error: null,
        loading: false,
        updatedAt: new Date().toLocaleTimeString('en-IN', { hour12: false }),
      });
    } catch (error) {
      this.patch(id, { error: formatUnknownError(error, 'Charts'), loading: false });
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

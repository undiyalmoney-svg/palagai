import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { PgIconComponent } from '../../shared/ui/icon/pg-icon.component';
import { HeatmapApiService } from './heatmap-api.service';
import {
  HeatmapBucketId,
  HeatmapCompany,
  HeatmapSortMode,
  HeatmapIndexOption,
  HeatmapSnapshot,
  HeatmapTableCol,
  HeatmapTrendId,
} from './heatmap.models';
import {
  filterTiles,
  formatIstTime,
  formatPct,
  formatPx,
  sortTable,
  sortTiles,
  strongTrends,
} from './heatmap.util';

@Component({
  selector: 'app-heatmap-page',
  standalone: true,
  imports: [DecimalPipe, RouterLink, PgIconComponent],
  templateUrl: './heatmap-page.component.html',
  styleUrl: './heatmap-page.component.css',
})
export class HeatmapPageComponent implements OnDestroy {
  private readonly api = inject(HeatmapApiService);
  private readonly auth = inject(AuthService);
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly snap = signal<HeatmapSnapshot | null>(null);
  protected readonly error = signal('');
  protected readonly loading = signal(true);
  protected readonly layout = signal<HeatmapSortMode>('mcap');
  protected readonly bucket = signal<HeatmapBucketId | null>(null);
  protected readonly trend = signal<HeatmapTrendId | null>(null);
  protected readonly tableCol = signal<HeatmapTableCol>('ltp');
  protected readonly tableDir = signal<'asc' | 'desc'>('desc');
  protected readonly signedIn = signal(false);
  protected readonly indexId = signal('NIFTY50');
  private readonly fallbackIndices: HeatmapIndexOption[] = [
    { id: 'NIFTY50', name: 'NIFTY 50' },
    { id: 'BANKNIFTY', name: 'NIFTY BANK' },
    { id: 'SENSEX', name: 'SENSEX' },
  ];

  protected readonly formatPx = formatPx;
  protected readonly formatPct = formatPct;
  protected readonly formatIstTime = formatIstTime;

  protected readonly companies = computed(() => this.snap()?.companies ?? []);
  protected readonly tiles = computed(() =>
    sortTiles(filterTiles(this.companies(), this.bucket(), this.trend()), this.layout()),
  );
  protected readonly tableRows = computed(() =>
    sortTable(this.companies(), this.tableCol(), this.tableDir()),
  );
  protected readonly finder = computed(() => strongTrends(this.companies()));
  protected readonly indexOptions = computed(
    () => (this.snap()?.indices?.length ? this.snap()!.indices! : this.fallbackIndices),
  );
  protected readonly sourceLabel = computed(() => {
    const src = this.snap()?.session?.source || '';
    if (src.includes('groww') || src.includes('yahoo')) return 'Public feed (Yahoo / Groww)';
    if (src === 'kite') return 'Kite fallback · rate-limited';
    return src ? src : 'Public feed';
  });
  protected readonly indexTone = computed(() => {
    const pct = this.snap()?.index.changePct;
    if (!Number.isFinite(pct as number)) return 'flat';
    return (pct as number) > 0 ? 'up' : (pct as number) < 0 ? 'down' : 'flat';
  });

  constructor() {
    this.auth.ensureHydratedFromStorage();
    this.signedIn.set(this.auth.isAuthenticated());
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 25_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  protected setLayout(mode: HeatmapSortMode): void {
    this.layout.set(mode);
  }

  protected setIndex(id: string): void {
    const next = String(id || 'NIFTY50');
    if (this.indexId() === next) return;
    this.indexId.set(next);
    this.bucket.set(null);
    this.trend.set(null);
    this.loading.set(true);
    void this.refresh();
  }

  protected toggleBucket(id: HeatmapBucketId): void {
    this.bucket.update((cur) => (cur === id ? null : id));
  }

  protected toggleTrend(id: HeatmapTrendId): void {
    this.trend.update((cur) => (cur === id ? null : id));
  }

  protected sortBy(col: HeatmapTableCol): void {
    if (this.tableCol() === col) {
      this.tableDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.tableCol.set(col);
    this.tableDir.set(col === 'symbol' || col === 'trend' ? 'asc' : 'desc');
  }

  protected tileTone(row: HeatmapCompany): string {
    return row.bucket;
  }

  private async refresh(): Promise<void> {
    try {
      const next = await this.api.snapshot(this.indexId());
      this.snap.set(next);
      this.error.set('');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'Heatmap is unavailable.';
      if (!this.snap()) this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }
}

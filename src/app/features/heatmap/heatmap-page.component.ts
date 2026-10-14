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
      const next = await this.api.snapshot();
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

import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MarketDeskApiService } from '../../../core/market-desk/market-desk-api.service';
import {
  DEFAULT_DESK_SETTINGS,
  MarketDeskAlert,
  MarketDeskCandles,
  MarketDeskSettings,
  MarketDeskSnapshot,
  MarketIndexCard,
} from '../../../core/market-desk/market-desk.models';
import { DeskCandleChartComponent } from './desk-candle-chart.component';

type DeskFilter =
  | 'all'
  | 'bullish'
  | 'bearish'
  | 'sideways'
  | 'break15'
  | 'break60'
  | 'agree';

const SETTINGS_KEY = 'palagai.market-desk.settings';
const ALERT_KEY = 'palagai.market-desk.alerts';

@Component({
  selector: 'app-market-heat-board',
  standalone: true,
  imports: [DecimalPipe, RouterLink, DeskCandleChartComponent],
  templateUrl: './market-heat-board.component.html',
  styleUrl: './market-heat-board.component.css',
})
export class MarketHeatBoardComponent implements OnInit {
  private readonly api = inject(MarketDeskApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  protected readonly snap = signal<MarketDeskSnapshot | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly clock = signal('');
  protected readonly query = signal('');
  protected readonly sortPct = signal(false);
  protected readonly filter = signal<DeskFilter>('all');
  protected readonly showSettings = signal(false);
  protected readonly settings = signal<MarketDeskSettings>(this.loadSettings());
  protected readonly selected = signal<string | null>(null);
  protected readonly chartIv = signal<'5minute' | '15minute' | '60minute' | 'day'>('15minute');
  protected readonly chart = signal<MarketDeskCandles | null>(null);
  protected readonly chartLoading = signal(false);
  protected readonly feed = signal<MarketDeskAlert[]>([]);

  protected readonly tiles = computed(() => {
    const snap = this.snap();
    if (!snap) return [];
    let rows = [...snap.stocks];
    const q = this.query().trim().toUpperCase();
    if (q) rows = rows.filter((r) => r.symbol.includes(q) || r.name.toUpperCase().includes(q));
    const f = this.filter();
    if (f === 'bullish') rows = rows.filter((r) => r.bias === 'bullish' || r.bias === 'mild-bull');
    if (f === 'bearish') rows = rows.filter((r) => r.bias === 'bearish' || r.bias === 'mild-bear');
    if (f === 'sideways') rows = rows.filter((r) => r.bias === 'sideways');
    if (f === 'break15') rows = rows.filter((r) => r.breakout15?.status === 'confirmed' || r.breakout15?.status === 'potential');
    if (f === 'break60') rows = rows.filter((r) => r.breakout60?.status === 'confirmed' || r.breakout60?.status === 'potential');
    if (f === 'agree') rows = rows.filter((r) => r.breakoutAgree);
    if (this.sortPct()) {
      rows.sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999));
    }
    return rows;
  });

  private poll: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private lastRender = 0;

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
    void this.refresh();
    this.armPoll();
    this.destroyRef.onDestroy(() => {
      if (this.poll) clearInterval(this.poll);
      if (this.clockTimer) clearInterval(this.clockTimer);
    });
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const snap = await this.api.snapshot(this.settings());
      this.snap.set(snap);
      this.error.set(null);
      this.mergeAlerts(snap.alerts || []);
      if (this.selected()) void this.loadChart();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'Market desk is unavailable.';
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  protected setFilter(id: DeskFilter): void {
    this.filter.set(this.filter() === id ? 'all' : id);
  }

  protected openChart(symbol: string): void {
    this.selected.set(symbol);
    void this.loadChart();
  }

  protected setInterval(iv: '5minute' | '15minute' | '60minute' | 'day'): void {
    this.chartIv.set(iv);
    void this.loadChart();
  }

  protected closeChart(): void {
    this.selected.set(null);
    this.chart.set(null);
  }

  protected patchSetting<K extends keyof MarketDeskSettings>(key: K, value: MarketDeskSettings[K]): void {
    const next = { ...this.settings(), [key]: value };
    this.settings.set(next);
    this.saveSettings(next);
    this.armPoll();
    void this.refresh();
  }

  protected tone(pct: number | null | undefined): string {
    if (!Number.isFinite(pct)) return 'na';
    const n = pct as number;
    if (Math.abs(n) < 0.08) return 'flat';
    const mag = Math.abs(n) >= 3 ? '3' : Math.abs(n) >= 1 ? '2' : '1';
    return `${n > 0 ? 'up' : 'down'}${mag}`;
  }

  protected fmtPct(n: number | null | undefined): string {
    if (!Number.isFinite(n)) return '—';
    const v = n as number;
    return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
  }

  protected brLabel(row: { status?: string; direction?: string | null }): string {
    if (!row?.status || row.status === 'none') return 'No breakout';
    if (row.status === 'insufficient') return 'Insufficient data';
    const dir = row.direction === 'bull' ? 'bullish' : row.direction === 'bear' ? 'bearish' : '';
    if (row.status === 'potential') return `Potential ${dir}`.trim();
    if (row.status === 'confirmed') return `Confirmed ${dir}`.trim();
    if (row.status === 'retest') return 'Retest in progress';
    if (row.status === 'failed') return 'Failed breakout';
    return row.status;
  }

  protected agreeLabel(card: MarketIndexCard): string {
    const d = card.dayTrend || 'insufficient';
    const h = card.h1Trend || 'insufficient';
    const m = card.m15Trend || 'insufficient';
    if (d === 'insufficient' && h === 'insufficient') return 'Insufficient data';
    if (h === 'bullish' && m === 'bullish' && (d === 'bullish' || d === 'insufficient')) return 'Daily / 1h / 15m bullish';
    if (h === 'bearish' && m === 'bearish' && (d === 'bearish' || d === 'insufficient')) return 'Daily / 1h / 15m bearish';
    if (h === 'bullish' && m === 'bearish') return 'Hourly bullish but 15-minute bearish';
    if (h === 'bearish' && m === 'bullish') return 'Hourly bearish but 15-minute bullish';
    return `${d} · ${h} · ${m}`;
  }

  protected freshnessLabel(s: string): string {
    if (s === 'fresh') return 'Fresh';
    if (s === 'stale') return 'Stale';
    return 'Missing';
  }

  protected fmtIst(iso: string | null | undefined, withSeconds = true): string {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined,
      hourCycle: 'h23',
    }).format(new Date(iso));
  }

  private async loadChart(): Promise<void> {
    const symbol = this.selected();
    if (!symbol) return;
    this.chartLoading.set(true);
    try {
      this.chart.set(await this.api.candles(symbol, this.chartIv()));
    } catch {
      this.chart.set({ candles: [], message: 'Historical access failed or is restricted.' });
    } finally {
      this.chartLoading.set(false);
    }
  }

  private armPoll(): void {
    if (this.poll) clearInterval(this.poll);
    const ms = Math.max(1000, this.settings().uiRefreshMs || 5000);
    this.poll = setInterval(() => {
      const now = Date.now();
      if (now - this.lastRender < 900) return;
      this.lastRender = now;
      void this.refresh();
    }, ms);
  }

  private tickClock(): void {
    this.clock.set(
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()) + ' IST',
    );
  }

  private mergeAlerts(incoming: MarketDeskAlert[]): void {
    if (!incoming.length) return;
    const prev = this.feed();
    const seen = new Set(prev.map((a) => `${a.symbol}:${a.type}:${a.closeTime || ''}`));
    const next = incoming.filter((a) => !seen.has(`${a.symbol}:${a.type}:${a.closeTime || ''}`));
    if (!next.length) return;
    this.feed.set([...next, ...prev].slice(0, 30));
    if (this.isBrowser) {
      try {
        localStorage.setItem(ALERT_KEY, JSON.stringify(this.feed().slice(0, 20)));
      } catch {
        // ignore
      }
    }
  }

  private loadSettings(): MarketDeskSettings {
    if (!this.isBrowser) return { ...DEFAULT_DESK_SETTINGS };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_DESK_SETTINGS };
      return { ...DEFAULT_DESK_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_DESK_SETTINGS };
    }
  }

  private saveSettings(s: MarketDeskSettings): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      // ignore
    }
  }
}

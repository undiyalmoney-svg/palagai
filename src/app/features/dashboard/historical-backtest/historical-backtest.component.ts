import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HistoricalBacktestApiService } from './historical-backtest-api.service';
import {
  BacktestCross,
  BacktestJob,
  BacktestResult,
  BacktestSnapshot,
  BacktestStockRow,
  BacktestTrade,
  DiscoverCandidateDetail,
  DiscoverExperimentRow,
  DiscoverJob,
  DiscoverLeaderRow,
  DiscoverResult,
  DiscoverSpace,
  DailyProfitJob,
  DailyProfitResult,
} from './historical-backtest.models';
import { daysBefore, inr, lastCompletedSession, pct } from './historical-backtest.util';

type RangeMode = 'day' | 'range';
type SideFilter = 'all' | 'L' | 'S';
type ResultFilter = 'all' | 'win' | 'loss';
type TakenFilter = 'all' | 'taken' | 'skipped';
type PageTab = 'book' | 'discover' | 'profit';
type DeskPreset = 'winner' | 'original';
type RankBy = 'stopPct' | 'time' | 'orWidth';
type CrowdFilter = 'skipShort' | 'follow' | 'skipLong' | '';
type BoardSortKey =
  | 'rank'
  | 'id'
  | 'entryRule'
  | 'cutoff'
  | 'exitRule'
  | 'stopLoss'
  | 'target'
  | 'stockCount'
  | 'sizing'
  | 'netPnl'
  | 'maxDrawdown'
  | 'profitFactor'
  | 'profitableWeekPct'
  | 'oosNet'
  | 'validationStatus';

@Component({
  selector: 'app-historical-backtest',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink],
  templateUrl: './historical-backtest.component.html',
  styleUrl: './historical-backtest.component.css',
})
export class HistoricalBacktestComponent implements OnDestroy {
  private readonly api = inject(HistoricalBacktestApiService);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private discoverPollTimer: ReturnType<typeof setTimeout> | null = null;
  private profitPollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollFailures = 0;
  private discoverPollFailures = 0;
  private profitPollFailures = 0;

  protected readonly pageTab = signal<PageTab>('book');
  protected readonly rangeMode = signal<RangeMode>('day');
  protected date = lastCompletedSession();
  protected from = lastCompletedSession();
  protected to = lastCompletedSession();
  protected deskPreset: DeskPreset = 'winner';
  protected capital = 10000;
  protected maxStocksPerDay = 5;
  protected rankBy: RankBy = 'stopPct';
  protected crowdFilter: CrowdFilter = 'skipShort';

  protected discoverFrom = daysBefore(lastCompletedSession(), 35);
  protected discoverTo = lastCompletedSession();
  protected discoverCapital = 40000;
  protected discoverBudget = 24;

  protected profitFrom = daysBefore(lastCompletedSession(), 45);
  protected profitTo = lastCompletedSession();
  protected profitCapital = 10000;
  protected profitBudget = 20;

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly job = signal<BacktestJob | null>(null);
  protected readonly result = signal<BacktestResult | null>(null);

  protected readonly discoverBusy = signal(false);
  protected readonly discoverError = signal('');
  protected readonly discoverJob = signal<DiscoverJob | null>(null);
  protected readonly discoverResult = signal<DiscoverResult | null>(null);
  protected readonly space = signal<DiscoverSpace | null>(null);
  protected readonly experiments = signal<DiscoverExperimentRow[]>([]);
  protected readonly inspect = signal<DiscoverCandidateDetail | null>(null);
  protected readonly inspectBusy = signal(false);

  protected readonly profitBusy = signal(false);
  protected readonly profitError = signal('');
  protected readonly profitJob = signal<DailyProfitJob | null>(null);
  protected readonly profitResult = signal<DailyProfitResult | null>(null);
  protected readonly profitFamilies = signal<string[]>([]);
  protected readonly sortKey = signal<BoardSortKey>('rank');
  protected readonly sortDir = signal<1 | -1>(1);

  protected symbolFilter = '';
  protected sideFilter: SideFilter = 'all';
  protected resultFilter: ResultFilter = 'all';
  protected takenFilter: TakenFilter = 'all';

  protected readonly inr = inr;
  protected readonly pct = pct;

  protected readonly anyBusy = computed(() => this.busy() || this.discoverBusy() || this.profitBusy());

  protected readonly progressPct = computed(() => {
    const p = this.job()?.progress;
    if (!p || !p.total) return 0;
    return Math.min(100, Math.round((p.done / p.total) * 100));
  });

  protected readonly progressLabel = computed(() => {
    const job = this.job();
    const p = job?.progress;
    if (!p) return '';
    const phase =
      p.phase === 'instruments'
        ? 'Resolving Nifty 500 tokens'
        : p.phase === 'candles'
          ? 'Fetching Kite 5-minute candles'
          : p.phase === 'simulate'
            ? 'Simulating the ORB book'
            : p.phase === 'done'
              ? 'Done'
              : 'Queued';
    const sym = p.symbol ? ` · ${p.symbol}` : '';
    return `${phase} ${p.done}/${p.total}${sym}`;
  });

  protected readonly discoverProgressPct = computed(() => {
    const p = this.discoverJob()?.progress;
    if (!p || !p.total) return 0;
    return Math.min(100, Math.round((p.done / p.total) * 100));
  });

  protected readonly discoverProgressLabel = computed(() => {
    const job = this.discoverJob();
    const p = job?.progress;
    if (!p) return '';
    const phase =
      p.phase === 'instruments'
        ? 'Resolving Nifty 500 tokens'
        : p.phase === 'candles'
          ? 'Fetching and caching Kite 5-minute candles'
          : p.phase === 'simulate'
            ? 'Simulating strategy candidates'
            : p.phase === 'sensitivity'
              ? 'Capital and cost sensitivity'
              : p.phase === 'done'
                ? 'Done'
                : 'Queued';
    const sym = p.symbol ? ` · ${p.symbol}` : '';
    return `${phase} ${p.done}/${p.total}${sym}`;
  });

  protected readonly profitProgressPct = computed(() => {
    const p = this.profitJob()?.progress;
    if (!p || !p.total) return 0;
    return Math.min(100, Math.round((p.done / p.total) * 100));
  });

  protected readonly profitProgressLabel = computed(() => {
    const job = this.profitJob();
    const p = job?.progress;
    if (!p) return '';
    const phase =
      p.phase === 'instruments'
        ? 'Resolving Nifty 500 tokens'
        : p.phase === 'candles'
          ? 'Fetching and caching Kite 5-minute candles'
          : p.phase === 'simulate'
            ? 'Testing entry families and portfolio sizes'
            : p.phase === 'done'
              ? 'Done'
              : 'Queued';
    const sym = p.symbol ? ` · ${p.symbol}` : '';
    return `${phase} ${p.done}/${p.total}${sym}`;
  });

  protected filteredTrades(): BacktestTrade[] {
    const trades = this.result()?.trades || [];
    const q = this.symbolFilter.trim().toUpperCase();
    return trades.filter((t) => {
      if (q && !t.symbol.includes(q)) return false;
      if (this.sideFilter !== 'all' && t.side !== this.sideFilter) return false;
      if (this.resultFilter === 'win' && !(t.netRs > 0)) return false;
      if (this.resultFilter === 'loss' && !(t.netRs < 0)) return false;
      return true;
    });
  }

  protected filteredStocks(): BacktestStockRow[] {
    const stocks = this.result()?.summary.stocks || [];
    const q = this.symbolFilter.trim().toUpperCase();
    if (!q) return stocks;
    return stocks.filter((s) => s.symbol.includes(q));
  }

  protected snapshots(): BacktestSnapshot[] {
    const view = this.result();
    return view?.summary.snapshots || view?.snapshots || [];
  }

  protected filteredCrosses(): BacktestCross[] {
    const rows = this.result()?.crosses || [];
    const q = this.symbolFilter.trim().toUpperCase();
    return rows.filter((c) => {
      if (q && !c.symbol.includes(q)) return false;
      if (this.sideFilter !== 'all' && c.side !== this.sideFilter) return false;
      if (this.takenFilter === 'taken' && !c.taken) return false;
      if (this.takenFilter === 'skipped' && c.taken) return false;
      return true;
    });
  }

  protected readonly curvePoints = computed(() => this.polyline(this.result()?.summary.equityCurve || []));

  protected readonly discoverCurvePoints = computed(() => {
    const rec = this.discoverResult()?.recommended;
    const curve = rec?.equityCurve || rec?.oos?.equityCurve || [];
    return this.polyline(curve);
  });

  protected readonly sortedBoard = computed(() => {
    const rows = this.discoverResult()?.leaderboard || [];
    const key = this.sortKey();
    const dir = this.sortDir();
    return [...rows].sort((a, b) => {
      const av = this.boardCell(a, key);
      const bv = this.boardCell(b, key);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  });

  protected readonly weeklyCompareIds = computed(() => {
    const view = this.discoverResult();
    if (!view) return [] as string[];
    const rec = view.recommended?.id;
    const base = view.baseline?.id;
    const top = (view.leaderboard || []).slice(0, 4).map((r) => r.id);
    return [...new Set([base, rec, ...top].filter((id): id is string => !!id))];
  });

  protected readonly weeklyCompareNames = computed(() => {
    const view = this.discoverResult();
    const ids = this.weeklyCompareIds();
    const names = new Map((view?.leaderboard || []).map((r) => [r.id, r.name]));
    return ids.map((id) => ({ id, name: names.get(id) || id }));
  });

  ngOnDestroy(): void {
    this.clearPoll();
    this.clearDiscoverPoll();
    this.clearProfitPoll();
  }

  protected setMode(mode: RangeMode): void {
    this.rangeMode.set(mode);
    if (mode === 'day') {
      this.from = this.date;
      this.to = this.date;
    }
  }

  protected applyDesk(preset: DeskPreset): void {
    this.deskPreset = preset;
    if (preset === 'winner') {
      this.capital = 10000;
      this.maxStocksPerDay = 5;
      this.rankBy = 'stopPct';
      this.crowdFilter = 'skipShort';
      return;
    }
    this.capital = 40000;
    this.maxStocksPerDay = 3;
    this.rankBy = 'time';
    this.crowdFilter = '';
  }

  protected rankLabel(rank: string | undefined | null): string {
    if (rank === 'stopPct') return '5 widest signal-candle stops';
    if (rank === 'orWidth') return 'widest opening range first';
    return 'first eligible by entry time';
  }

  protected crowdLabel(filter: string | undefined | null): string {
    if (filter === 'skipShort') return 'skip 09:45 short-crowd (≤40% long)';
    if (filter === 'skipLong') return 'skip 09:45 long-crowd (≥60% long)';
    if (filter === 'follow') return 'follow 09:45 majority side';
    return 'take every session';
  }

  protected deskLabel(): string {
    if (this.deskPreset === 'winner') return '₹10k winner desk';
    return 'Original 3-name ₹40k';
  }

  protected async setPage(tab: PageTab): Promise<void> {
    this.pageTab.set(tab);
    if (tab === 'profit' && !this.profitFamilies().length) {
      try {
        const space = await this.api.dailyProfitSpace();
        this.profitFamilies.set(space.families || []);
      } catch {
        /* space is optional until a run */
      }
    }
    if (tab !== 'discover') return;
    if (!this.space()) {
      try {
        this.space.set(await this.api.discoverSpace());
      } catch {
        /* space is optional until a run */
      }
    }
    try {
      const list = await this.api.listDiscoveries();
      this.experiments.set(list.experiments || []);
    } catch {
      /* previous runs are optional */
    }
  }

  protected pnlClass(n: number): string {
    if (n > 0) return 'mp-up';
    if (n < 0) return 'mp-down';
    return 'mp-flat';
  }

  protected stockWidth(row: BacktestStockRow): number {
    return Math.max(4, Math.round((Math.abs(row.netRs) / this.maxAbsStock()) * 100));
  }

  protected maxAbsStock(): number {
    return this.filteredStocks().reduce((m, s) => Math.max(m, Math.abs(s.netRs)), 0) || 1;
  }

  protected discoverStockWidth(net: number): number {
    const stocks = this.discoverResult()?.recommended?.stocks || [];
    const max = stocks.reduce((m, s) => Math.max(m, Math.abs(s.netRs)), 0) || 1;
    return Math.max(4, Math.round((Math.abs(net) / max) * 100));
  }

  protected async run(): Promise<void> {
    this.error.set('');
    const from = this.rangeMode() === 'day' ? this.date : this.from;
    const to = this.rangeMode() === 'day' ? this.date : this.to;
    this.busy.set(true);
    this.pollFailures = 0;
    this.result.set(null);
    this.job.set({
      status: 'running',
      progress: { phase: 'queued', done: 0, total: 500, symbol: null },
    });
    try {
      const started = await this.api.start({
        from,
        to,
        capital: Number(this.capital) || (this.deskPreset === 'winner' ? 10000 : 40000),
        maxStocksPerDay: Number(this.maxStocksPerDay) || (this.deskPreset === 'winner' ? 5 : 3),
        rankBy: this.rankBy,
        crowdFilter: this.crowdFilter || null,
        preset: this.deskPreset === 'winner' ? 'winner' : undefined,
      });
      this.job.set(started);
      if (started.id) {
        this.poll(started.id);
      } else if (started.result) {
        this.result.set(started.result);
        this.busy.set(false);
      }
    } catch (err) {
      this.busy.set(false);
      this.job.set(null);
      this.error.set(this.fmtErr(err));
    }
  }

  protected async runDiscover(): Promise<void> {
    this.discoverError.set('');
    this.inspect.set(null);
    this.discoverBusy.set(true);
    this.discoverPollFailures = 0;
    this.discoverResult.set(null);
    this.discoverJob.set({
      status: 'running',
      liveOrders: false,
      progress: { phase: 'queued', done: 0, total: 500, symbol: null },
    });
    try {
      const started = await this.api.startDiscover({
        from: this.discoverFrom,
        to: this.discoverTo,
        capital: Number(this.discoverCapital) || 40000,
        budget: Number(this.discoverBudget) || 24,
      });
      this.discoverJob.set(started);
      if (started.id) {
        this.pollDiscover(started.id);
      } else if (started.result) {
        this.discoverResult.set(started.result);
        this.discoverBusy.set(false);
      }
    } catch (err) {
      this.discoverBusy.set(false);
      this.discoverJob.set(null);
      this.discoverError.set(this.fmtErr(err));
    }
  }

  protected async runProfit(): Promise<void> {
    this.profitError.set('');
    this.profitBusy.set(true);
    this.profitPollFailures = 0;
    this.profitResult.set(null);
    this.profitJob.set({
      status: 'running',
      liveOrders: false,
      progress: { phase: 'queued', done: 0, total: 500, symbol: null },
    });
    try {
      const started = await this.api.startDailyProfit({
        from: this.profitFrom,
        to: this.profitTo,
        capital: Number(this.profitCapital) || 10000,
        budget: Number(this.profitBudget) || 20,
      });
      this.profitJob.set(started);
      if (started.id) {
        this.pollProfit(started.id);
      } else if (started.result) {
        this.profitResult.set(started.result);
        this.profitBusy.set(false);
      }
    } catch (err) {
      this.profitBusy.set(false);
      this.profitJob.set(null);
      this.profitError.set(this.fmtErr(err));
    }
  }

  protected async openExperiment(id: string): Promise<void> {
    this.discoverError.set('');
    this.inspect.set(null);
    try {
      const job = await this.api.discoverJob(id);
      this.discoverJob.set(job);
      if (job.status === 'done') {
        this.discoverResult.set(job.result || null);
        this.discoverBusy.set(false);
      } else if (job.status === 'running') {
        this.discoverBusy.set(true);
        this.pollDiscover(id);
      } else if (job.status === 'error') {
        this.discoverBusy.set(false);
        this.discoverError.set(job.error || 'Discovery failed.');
      }
    } catch (err) {
      this.discoverError.set(this.fmtErr(err));
    }
  }

  protected async openCandidate(id: string | null | undefined): Promise<void> {
    const jobId = this.discoverJob()?.id;
    if (!id || !jobId) return;
    this.inspectBusy.set(true);
    try {
      const detail = await this.api.discoverCandidate(jobId, id);
      this.inspect.set(detail);
    } catch (err) {
      this.discoverError.set(this.fmtErr(err));
    } finally {
      this.inspectBusy.set(false);
    }
  }

  protected sortBy(key: BoardSortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 1 ? -1 : 1) as 1 | -1);
      return;
    }
    this.sortKey.set(key);
    this.sortDir.set(key === 'rank' || key === 'id' ? 1 : -1);
  }

  protected sortMark(key: BoardSortKey): string {
    if (this.sortKey() !== key) return '';
    return this.sortDir() === 1 ? ' ↑' : ' ↓';
  }

  protected statusLabel(status: string | undefined): string {
    switch (status) {
      case 'in_sample':
        return 'In-sample only — not a robust recommendation';
      case 'oos_positive':
        return 'Out-of-sample positive';
      case 'oos_reported':
        return 'Out-of-sample reported';
      case 'insufficient_oos':
        return 'Insufficient out-of-sample';
      default:
        return status || '—';
    }
  }

  protected candidateName(id: string | null | undefined): string {
    if (!id) return '—';
    const row = (this.discoverResult()?.leaderboard || []).find((r) => r.id === id);
    return row?.name || id;
  }

  protected weeklyNet(week: DiscoverResult['weeklyWinners'][number], id: string): number | null {
    const hit = week.perCandidate.find((c) => c.id === id);
    return hit ? hit.netPnl : null;
  }

  protected topStockNames(week: DiscoverResult['weeklyWinners'][number]): string {
    return (week.stocks || [])
      .slice(0, 3)
      .map((s) => s.symbol)
      .join(', ') || '—';
  }

  protected labTrack(id: string, value: unknown): string {
    return `${id}:${value == null ? '' : String(value)}`;
  }

  protected coverage(): DiscoverJob['coverage'] {
    return this.discoverJob()?.coverage || this.discoverResult()?.coverage || null;
  }

  private poll(id: string): void {
    this.clearPoll();
    const wait = this.pollFailures ? Math.min(8000, 1500 * this.pollFailures) : 1500;
    this.pollTimer = setTimeout(async () => {
      try {
        const job = await this.api.job(id);
        this.pollFailures = 0;
        this.job.set(job);
        if (job.status === 'done') {
          this.result.set(job.result || null);
          this.busy.set(false);
          this.error.set('');
          return;
        }
        if (job.status === 'error') {
          this.busy.set(false);
          this.error.set(job.error || 'Backtest failed.');
          return;
        }
        this.poll(id);
      } catch (err) {
        this.pollFailures += 1;
        if (this.pollFailures < 6) {
          this.error.set('Waiting for the backtest server… retrying.');
          this.poll(id);
          return;
        }
        this.busy.set(false);
        this.error.set(this.fmtErr(err));
      }
    }, wait);
  }

  private pollDiscover(id: string): void {
    this.clearDiscoverPoll();
    const wait = this.discoverPollFailures ? Math.min(12000, 1500 * this.discoverPollFailures) : 1500;
    this.discoverPollTimer = setTimeout(async () => {
      try {
        const job = await this.api.discoverJob(id);
        this.discoverPollFailures = 0;
        this.discoverJob.set(job);
        if (job.status === 'done') {
          this.discoverResult.set(job.result || null);
          this.discoverBusy.set(false);
          this.discoverError.set('');
          return;
        }
        if (job.status === 'error') {
          this.discoverBusy.set(false);
          this.discoverError.set(job.error || 'Discovery failed.');
          return;
        }
        this.pollDiscover(id);
      } catch (err) {
        this.discoverPollFailures += 1;
        if (this.discoverPollFailures < 80) {
          this.discoverError.set('Waiting for the discovery server… retrying. The search keeps running; numbers stay blank until it finishes.');
          this.pollDiscover(id);
          return;
        }
        this.discoverBusy.set(false);
        this.discoverError.set(this.fmtErr(err));
      }
    }, wait);
  }

  private clearPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private clearDiscoverPoll(): void {
    if (this.discoverPollTimer) {
      clearTimeout(this.discoverPollTimer);
      this.discoverPollTimer = null;
    }
  }

  private pollProfit(id: string): void {
    this.clearProfitPoll();
    const wait = this.profitPollFailures ? Math.min(12000, 1500 * this.profitPollFailures) : 1500;
    this.profitPollTimer = setTimeout(async () => {
      try {
        const job = await this.api.dailyProfitJob(id);
        this.profitPollFailures = 0;
        this.profitJob.set(job);
        if (job.status === 'done') {
          this.profitResult.set(job.result || null);
          this.profitBusy.set(false);
          this.profitError.set('');
          return;
        }
        if (job.status === 'error') {
          this.profitBusy.set(false);
          this.profitError.set(job.error || 'Daily profit search failed.');
          return;
        }
        this.pollProfit(id);
      } catch (err) {
        this.profitPollFailures += 1;
        if (this.profitPollFailures < 80) {
          this.profitError.set('Waiting for the research server… retrying. The search keeps running.');
          this.pollProfit(id);
          return;
        }
        this.profitBusy.set(false);
        this.profitError.set(this.fmtErr(err));
      }
    }, wait);
  }

  private clearProfitPoll(): void {
    if (this.profitPollTimer) {
      clearTimeout(this.profitPollTimer);
      this.profitPollTimer = null;
    }
  }

  private boardCell(row: DiscoverLeaderRow, key: BoardSortKey): string | number {
    const value = row[key];
    if (value == null) return '';
    return value as string | number;
  }

  private polyline(curve: Array<{ day: string; equity: number }>): string {
    if (curve.length < 2) return '';
    const ys = curve.map((p) => p.equity);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const span = max - min || 1;
    return curve
      .map((p, i) => {
        const x = (i / (curve.length - 1)) * 100;
        const y = 36 - ((p.equity - min) / span) * 32;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }

  private fmtErr(err: unknown): string {
    const http = err as { status?: number; error?: { message?: string }; message?: string };
    const msg = String(http?.error?.message || http?.message || err || 'Request failed');
    if (http?.status === 409) return msg;
    if (/token|session|connect kite|authorization/i.test(msg)) {
      return `${msg} Open Token, complete Kite login, then run again.`;
    }
    return msg;
  }

  protected trackTrade(_i: number, t: BacktestTrade): string {
    return `${t.day}-${t.symbol}-${t.entryT}-${t.exitT}`;
  }

  protected trackCross(_i: number, c: BacktestCross): string {
    return `${c.day}-${c.symbol}-${c.t}-${c.side}`;
  }
}

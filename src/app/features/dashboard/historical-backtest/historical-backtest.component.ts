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
} from './historical-backtest.models';
import { inr, lastCompletedSession, pct } from './historical-backtest.util';

type RangeMode = 'day' | 'range';
type SideFilter = 'all' | 'L' | 'S';
type ResultFilter = 'all' | 'win' | 'loss';
type TakenFilter = 'all' | 'taken' | 'skipped';

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
  private pollFailures = 0;

  protected readonly rangeMode = signal<RangeMode>('day');
  protected date = lastCompletedSession();
  protected from = lastCompletedSession();
  protected to = lastCompletedSession();
  protected capital = 40000;
  protected maxStocksPerDay = 3;

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly job = signal<BacktestJob | null>(null);
  protected readonly result = signal<BacktestResult | null>(null);

  protected symbolFilter = '';
  protected sideFilter: SideFilter = 'all';
  protected resultFilter: ResultFilter = 'all';
  protected takenFilter: TakenFilter = 'all';

  protected readonly inr = inr;
  protected readonly pct = pct;

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

  protected readonly curvePoints = computed(() => {
    const curve = this.result()?.summary.equityCurve || [];
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
  });

  protected maxAbsStock(): number {
    return this.filteredStocks().reduce((m, s) => Math.max(m, Math.abs(s.netRs)), 0) || 1;
  }

  ngOnDestroy(): void {
    this.clearPoll();
  }

  protected setMode(mode: RangeMode): void {
    this.rangeMode.set(mode);
    if (mode === 'day') {
      this.from = this.date;
      this.to = this.date;
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
        capital: Number(this.capital) || 40000,
        maxStocksPerDay: Number(this.maxStocksPerDay) || 3,
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

  private clearPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
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

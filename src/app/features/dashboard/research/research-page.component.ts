import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ResearchApiService, TradeQuery } from './research-api.service';
import {
  ReadinessCheck,
  ResearchCandidate,
  ResearchPosition,
  ResearchStatus,
  ResearchStrategy,
  ResearchSummary,
  ResearchTrade,
  SystemEvent,
  WeeklyRow,
} from './research.models';

type Section = 'overview' | 'picker' | 'positions' | 'comparison' | 'ledger' | 'weekly' | 'settings';

@Component({
  selector: 'app-research-page',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './research-page.component.html',
})
export class ResearchPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ResearchApiService);
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly sections: Array<{ id: Section; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'picker', label: 'Stock picker' },
    { id: 'positions', label: 'Positions' },
    { id: 'comparison', label: 'Comparison' },
    { id: 'ledger', label: 'Ledger' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'settings', label: 'Settings' },
  ];

  protected readonly section = signal<Section>('overview');
  protected readonly status = signal<ResearchStatus | null>(null);
  protected readonly checks = signal<ReadinessCheck[]>([]);
  protected readonly ready = signal(false);
  protected readonly strategies = signal<ResearchStrategy[]>([]);
  protected readonly candidates = signal<ResearchCandidate[]>([]);
  protected readonly positions = signal<ResearchPosition[]>([]);
  protected readonly trades = signal<ResearchTrade[]>([]);
  protected readonly tradeTotal = signal(0);
  protected readonly summary = signal<ResearchSummary | null>(null);
  protected readonly weeks = signal<WeeklyRow[]>([]);
  protected readonly events = signal<SystemEvent[]>([]);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);

  protected confirmPhrase = '';
  protected from = '';
  protected to = '';
  protected symbol = '';
  protected strategyId = '';
  protected direction = '';
  protected tradeStatus = '';
  protected riskPct = 0.5;
  protected dailyLossPct = 2;
  protected maxTrades = 5;
  protected maxPositions = 3;
  protected notionalPct = 95;
  protected minRewardRisk = 1.5;
  protected slippageBps = 5;
  protected openingRangeMinutes = 15;
  private configLoaded = false;

  ngOnInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 20_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  protected show(id: Section): void {
    this.section.set(id);
    void this.refreshSection().catch((err) => this.error.set(this.messageOf(err)));
  }

  protected async refresh(): Promise<void> {
    try {
      const [status, readiness, strategies] = await Promise.all([
        this.api.status(),
        this.api.readiness(),
        this.api.strategies(),
      ]);
      this.status.set(status);
      this.checks.set(readiness.checks);
      this.ready.set(readiness.ready);
      this.strategies.set(strategies);
      if (!this.configLoaded && status.experiment?.configuration) {
        const c = status.experiment.configuration;
        this.riskPct = c.riskPerTrade * 100;
        this.dailyLossPct = c.maxDailyLoss * 100;
        this.maxTrades = c.maxTradesPerDay;
        this.maxPositions = c.maxOpenPositions;
        this.notionalPct = c.maxNotionalPct * 100;
        this.minRewardRisk = c.minRewardRisk;
        this.slippageBps = c.slippageBps;
        this.openingRangeMinutes = c.openingRangeMinutes;
        this.configLoaded = true;
      }
      this.error.set('');
      await this.refreshSection();
    } catch (err) {
      this.error.set(this.messageOf(err));
    }
  }

  private async refreshSection(): Promise<void> {
    const q = this.query();
    const section = this.section();
    if (section === 'picker') this.candidates.set(await this.api.candidates(q));
    if (section === 'positions') this.positions.set(await this.api.positions());
    if (section === 'comparison' || section === 'weekly') {
      this.summary.set(await this.api.summary(q));
      this.weeks.set(await this.api.weekly(q));
    }
    if (section === 'ledger') {
      const page = await this.api.trades(q);
      this.trades.set(page.trades);
      this.tradeTotal.set(page.total);
    }
    if (section === 'overview') this.events.set(await this.api.events());
  }

  protected async applyFilters(): Promise<void> {
    await this.refreshSection().catch((err) => this.error.set(this.messageOf(err)));
  }

  protected async start(): Promise<void> {
    this.busy.set(true);
    this.notice.set('');
    try {
      await this.api.start(this.confirmPhrase.trim());
      this.notice.set('Paper experiment started. No real orders will be placed.');
      await this.refresh();
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async stop(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.stop();
      this.notice.set('Paper experiment stopped. History was kept.');
      await this.refresh();
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveConfig(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.saveConfig({
        riskPerTrade: this.riskPct / 100,
        maxDailyLoss: this.dailyLossPct / 100,
        maxTradesPerDay: this.maxTrades,
        maxOpenPositions: this.maxPositions,
        maxNotionalPct: this.notionalPct / 100,
        minRewardRisk: this.minRewardRisk,
        slippageBps: this.slippageBps,
        openingRangeMinutes: this.openingRangeMinutes,
      });
      this.notice.set('Configuration saved. Accounts and history were not reset.');
      this.configLoaded = false;
      await this.refresh();
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(strategy: ResearchStrategy): Promise<void> {
    try {
      await this.api.setEnabled(strategy.strategyId, !strategy.enabled, strategy.version);
      await this.refresh();
    } catch (err) {
      this.error.set(this.messageOf(err));
    }
  }

  protected async optimize(strategyId: string): Promise<void> {
    this.busy.set(true);
    try {
      const out = await this.api.optimize(strategyId);
      this.notice.set(out.candidate?.optimizationNotes || 'Candidate version stored. Baseline was left running.');
      await this.refresh();
    } catch (err) {
      this.error.set(this.messageOf(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async download(kind: 'csv' | 'xlsx'): Promise<void> {
    try {
      const q = this.query();
      if (kind === 'csv') {
        this.saveBlob(new Blob([await this.api.exportCsv(q)], { type: 'text/csv' }), 'research-trades.csv');
      } else {
        this.saveBlob(await this.api.exportXlsx(q), 'research-trades.xlsx');
      }
    } catch (err) {
      this.error.set(this.messageOf(err));
    }
  }

  protected strategyRows(): Array<{ id: string; stats: ResearchSummary['byStrategy'][string] }> {
    const summary = this.summary();
    if (!summary) return [];
    return Object.entries(summary.byStrategy).map(([id, stats]) => ({ id, stats }));
  }

  protected capital(): number {
    return (this.status()?.accounts || []).reduce((s, a) => s + (a.initialCapital || 0), 0);
  }

  protected dayChange(): number | null {
    const accounts = this.status()?.accounts || [];
    if (!accounts.length) return null;
    return accounts.reduce((s, a) => s + (a.currentEquity - (a.startOfDayEquity || a.initialCapital)), 0);
  }

  protected points(n: number | null | undefined): string {
    if (n == null) return '—';
    return `${n.toFixed(2)}%`;
  }

  protected inr(n: number | null | undefined): string {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
  }

  protected rate(n: number | null | undefined): string {
    if (n == null) return '—';
    return `${(n * 100).toFixed(1)}%`;
  }

  protected hold(ms: number | null | undefined): string {
    if (ms == null) return '—';
    return `${Math.round(ms / 60000)} min`;
  }

  protected pnlClass(n: number | null | undefined): string {
    if (n == null || n === 0) return 'mp-flat';
    return n > 0 ? 'mp-up' : 'mp-down';
  }

  private query(): TradeQuery {
    return {
      from: this.from || undefined,
      to: this.to || undefined,
      symbol: this.symbol.trim().toUpperCase() || undefined,
      strategyId: this.strategyId || undefined,
      direction: this.direction || undefined,
      status: this.tradeStatus || undefined,
    };
  }

  private saveBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  private messageOf(err: unknown): string {
    const body = (err as { error?: { message?: string } })?.error;
    return body?.message || 'The research API did not respond.';
  }
}

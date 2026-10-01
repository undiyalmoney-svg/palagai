import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MomentumApiService } from '../momentum-api.service';
import { MomentumStateService } from '../momentum-state.service';
import { JobRun, MomentumConfig } from '../momentum.models';
import { dateTime, errorMessage, humanize, orderTone } from '../format.util';

interface RiskField {
  key: string;
  label: string;
  hint: string;
  percent: boolean;
  step: number;
}

const RISK_FIELDS: RiskField[] = [
  { key: 'maxPositions', label: 'Max positions', hint: 'Upper bound on the number of stocks. The engine may hold fewer.', percent: false, step: 1 },
  { key: 'maxPositionPct', label: 'Max per stock (% of portfolio)', hint: 'Largest weight a single stock may reach.', percent: true, step: 1 },
  { key: 'maxSectorPct', label: 'Max per sector (%)', hint: 'Sector concentration cap.', percent: true, step: 1 },
  { key: 'riskPerTradePct', label: 'Risk per trade (%)', hint: 'Loss if the stop is hit, as % of portfolio. Drives position size.', percent: true, step: 0.05 },
  { key: 'maxOpenRiskPct', label: 'Max total open risk (%)', hint: 'Sum of all stop-loss risks.', percent: true, step: 0.5 },
  { key: 'minCashPct', label: 'Minimum cash (%)', hint: 'Cash reserve kept before regime adjustments.', percent: true, step: 1 },
  { key: 'maxDrawdownHaltPct', label: 'Drawdown halt (%)', hint: 'New buys stop when the portfolio falls this far below its peak.', percent: true, step: 1 },
  { key: 'maxDailyLossPct', label: 'Daily loss halt (%)', hint: 'No new buys after a daily loss of this size.', percent: true, step: 0.5 },
  { key: 'minPositionValue', label: 'Min position value (₹)', hint: 'Smaller positions are not worth the costs.', percent: false, step: 500 },
  { key: 'maxOrderValue', label: 'Max single order value (₹)', hint: 'Orders larger than this are rejected by validation.', percent: false, step: 10000 },
  { key: 'maxSignalAgeDays', label: 'Signal expiry (days)', hint: 'Stale signals are never executed.', percent: false, step: 1 },
  { key: 'maxPriceDeviationPct', label: 'Max price drift (%)', hint: 'Order is rejected if price moved more than this since the decision.', percent: true, step: 0.5 },
];

@Component({
  selector: 'app-momentum-settings-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="mp-page">
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="mp-banner" data-tone="up" role="status">{{ notice() }}</div> }

      @if (cfg(); as c) {
        <div class="mp-grid">
          <div class="mp-card mp-col-6">
            <div class="mp-card-head"><div><h2>Active strategy</h2>
              <p class="mp-sub">Used by Decision Center, paper and live trading and as the default in Backtest. Holding period is a parameter of the strategy, never an automatic exit.</p></div></div>
            <div class="mp-field"><label for="st-strategy">Strategy</label>
              <select id="st-strategy" class="ui-select" [ngModel]="strategyId()" (ngModelChange)="strategyId.set($event)" name="strategy">
                @for (s of c.strategies; track s.id) { <option [value]="s.id">{{ s.name }}</option> }
              </select></div>
            <p class="mp-sub">{{ activeDescription() }}</p>
            <button type="button" class="ui-btn ui-btn-primary" [disabled]="busy() || strategyId() === c.settings.strategyId" (click)="saveStrategyChoice()">Use this strategy</button>
            <p class="mp-small mp-muted">Create and compare custom strategies in the <a class="mp-link" routerLink="../strategy-lab">Strategy Lab</a>.</p>
          </div>

          <div class="mp-card mp-col-6">
            <div class="mp-card-head"><div><h2>Costs &amp; simulation</h2>
              <p class="mp-sub">Applied to backtests, paper fills and decision sizing. Zerodha delivery charges (brokerage, STT, exchange, GST, stamp, SEBI) are modelled; add extra basis points to be conservative.</p></div></div>
            <div class="mp-form">
              <div class="mp-field"><label for="st-slip">Slippage (bps)</label><input id="st-slip" class="ui-input" type="number" min="0" max="200" step="1" name="slip" [(ngModel)]="slippage" /></div>
              <div class="mp-field"><label for="st-extra">Extra cost (bps)</label><input id="st-extra" class="ui-input" type="number" min="0" max="200" step="1" name="extra" [(ngModel)]="extraBps" /></div>
              <div class="mp-field"><label for="st-partial">Paper partial fill (%)</label><input id="st-partial" class="ui-input" type="number" min="10" max="100" step="5" name="partial" [(ngModel)]="partialPct" /></div>
              <label class="ui-check"><input type="checkbox" name="fwc" [(ngModel)]="fillWhenClosed" /> Paper orders may fill while the market is closed</label>
              <label class="ui-check"><input type="checkbox" name="amo" [(ngModel)]="allowAmo" /> Allow after-market (AMO) orders in live mode</label>
            </div>
            <button type="button" class="ui-btn ui-btn-primary" [disabled]="busy()" (click)="saveSimulation()">Save</button>
          </div>
        </div>

        <div class="mp-card">
          <div class="mp-card-head"><div><h2>Risk limits</h2>
            <p class="mp-sub">Enforced server-side by the decision engine and again by order validation. Orders that would breach a limit are clipped or rejected.</p></div></div>
          <div class="mp-form risk">
            @for (f of riskFields; track f.key) {
              <div class="mp-field">
                <label [for]="'risk-' + f.key">{{ f.label }}</label>
                <input [id]="'risk-' + f.key" class="ui-input" type="number" [step]="f.step" [name]="f.key" [ngModel]="riskValues()[f.key]" (ngModelChange)="setRisk(f.key, $event)" />
                <span class="mp-small mp-muted">{{ f.hint }}</span>
              </div>
            }
          </div>
          <button type="button" class="ui-btn ui-btn-primary" [disabled]="busy()" (click)="saveRiskLimits()">Save risk limits</button>
        </div>

        <div class="mp-grid">
          <div class="mp-card mp-col-6">
            <div class="mp-card-head"><h2>Market data</h2></div>
            @if (state.status(); as s) {
              <ul class="mp-list">
                <li><strong>Provider:</strong> {{ s.provider.label }} @if (s.provider.simulated) { <span class="mp-badge" data-tone="warn">simulated</span> } @else { <span class="mp-badge" data-tone="up">real data</span> }</li>
                @if (s.provider.simulatedNotice) { <li class="mp-muted">{{ s.provider.simulatedNotice }}</li> }
                <li><strong>History:</strong> {{ s.data.symbols }} symbols, {{ s.data.rows }} daily bars, {{ s.data.first }} → {{ s.data.last }}</li>
                <li><strong>Market:</strong> {{ s.market.open ? 'open' : 'closed' }} — {{ s.market.reason }}</li>
              </ul>
            }
            <button type="button" class="ui-btn ui-btn-secondary" [disabled]="busy()" (click)="syncData()">Sync market data now</button>
          </div>

          <div class="mp-card mp-col-6">
            <div class="mp-card-head"><h2>Broker</h2></div>
            @if (state.status(); as s) {
              @if (s.broker.configured) {
                <p class="mp-sub">A broker session ({{ s.broker.apiKey }}) is configured. Live Trading is available.</p>
                <a class="ui-btn ui-btn-secondary" routerLink="../live">Open Live</a>
              } @else {
                <p class="mp-sub">No broker session. The Live Trading tab stays hidden until one is configured. Everything else — screening, decisions, backtests and paper trading — works without a broker.</p>
                <a class="ui-btn ui-btn-secondary" routerLink="/dashboard/get-token">Connect broker (Get Token)</a>
              }
            }
          </div>
        </div>

        <div class="mp-card">
          <div class="mp-card-head"><div><h2>Scheduled jobs</h2>
            <p class="mp-sub">Daily: refresh data, indicators, regime, rankings, evaluate holdings, signals. Weekly: full review and rebalance. Monthly: performance and risk review. Each job runs at most once per period, so repeated runs never duplicate signals or orders.</p></div>
            <div class="mp-row">
              @for (j of jobNames; track j) { <button type="button" class="ui-btn ui-btn-secondary mp-btn-sm" [disabled]="busy()" (click)="runJob(j)">Run {{ j }}</button> }
            </div>
          </div>
          <div class="mp-table-wrap">
            <table class="mp-table">
              <thead><tr><th>Job</th><th>Period</th><th>Status</th><th>Started</th><th>Finished</th><th>Result</th></tr></thead>
              <tbody>
                @for (j of jobs(); track j.id) {
                  <tr>
                    <td>{{ humanize(j.job) }}</td><td>{{ j.periodKey }}</td>
                    <td><span class="mp-badge" [attr.data-tone]="orderTone(j.status)">{{ humanize(j.status) }}</span></td>
                    <td>{{ dateTime(j.startedAt) }}</td><td>{{ dateTime(j.finishedAt) }}</td>
                    <td class="mp-small">{{ j.error || summarize(j.result) }}</td>
                  </tr>
                } @empty { <tr><td colspan="6" class="mp-empty">No job has run yet.</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
      } @else if (!error()) {
        <div class="mp-card mp-empty">Loading settings…</div>
      }
    </div>
  `,
  styles: `
    .risk { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); margin-bottom: 1rem; }
  `,
})
export class SettingsTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);
  protected readonly state = inject(MomentumStateService);

  protected readonly cfg = signal<MomentumConfig | null>(null);
  protected readonly jobs = signal<JobRun[]>([]);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  protected readonly strategyId = signal('');
  protected readonly riskValues = signal<Record<string, number>>({});
  protected slippage = 5;
  protected extraBps = 0;
  protected partialPct = 100;
  protected fillWhenClosed = true;
  protected allowAmo = false;

  protected readonly riskFields = RISK_FIELDS;
  protected readonly jobNames = ['daily', 'weekly', 'monthly'] as const;
  protected readonly humanize = humanize;
  protected readonly dateTime = dateTime;
  protected readonly orderTone = orderTone;

  protected readonly activeDescription = computed(() => this.cfg()?.strategies.find((s) => s.id === this.strategyId())?.description ?? '');

  ngOnInit(): void {
    void this.load();
  }

  private apply(c: MomentumConfig): void {
    this.cfg.set(c);
    this.strategyId.set(c.settings.strategyId);
    this.slippage = c.settings.slippageBps;
    this.extraBps = c.settings.costs.extraBps;
    this.partialPct = Math.round(c.settings.paper.partialFillPct * 100);
    this.fillWhenClosed = c.settings.paper.fillWhenClosed;
    this.allowAmo = c.settings.live.allowAmo;
    const rv: Record<string, number> = {};
    for (const f of RISK_FIELDS) {
      const raw = c.risk[f.key];
      rv[f.key] = f.percent ? Math.round(raw * 10000) / 100 : raw;
    }
    this.riskValues.set(rv);
  }

  protected async load(): Promise<void> {
    try {
      const [c, j] = await Promise.all([this.api.config(), this.api.jobs(), this.state.refreshStatus()]);
      this.apply(c);
      this.jobs.set(j.jobs);
      this.error.set('');
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load settings'));
    }
  }

  protected setRisk(key: string, value: number | string): void {
    this.riskValues.update((v) => ({ ...v, [key]: Number(value) }));
  }

  private async act(fn: () => Promise<string>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      this.notice.set(await fn());
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected saveStrategyChoice(): Promise<void> {
    return this.act(async () => {
      this.apply(await this.api.saveSettings({ strategyId: this.strategyId() }));
      await this.state.refreshStatus();
      return 'Active strategy updated.';
    });
  }

  protected saveSimulation(): Promise<void> {
    return this.act(async () => {
      this.apply(
        await this.api.saveSettings({
          slippageBps: Number(this.slippage),
          costs: { extraBps: Number(this.extraBps) },
          paper: { fillWhenClosed: this.fillWhenClosed, partialFillPct: Number(this.partialPct) / 100 },
          live: { allowAmo: this.allowAmo },
        }),
      );
      return 'Costs and simulation settings saved.';
    });
  }

  protected saveRiskLimits(): Promise<void> {
    return this.act(async () => {
      const patch: Record<string, number> = {};
      for (const f of RISK_FIELDS) {
        const v = Number(this.riskValues()[f.key]);
        patch[f.key] = f.percent ? v / 100 : v;
      }
      this.apply(await this.api.saveRisk(patch));
      return 'Risk limits saved.';
    });
  }

  protected syncData(): Promise<void> {
    return this.act(async () => {
      const r = await this.api.syncData();
      await this.state.refreshStatus();
      return `Market data synced: ${r.sync.newRows} new bar(s), latest ${r.sync.last ?? 'n/a'}.`;
    });
  }

  protected runJob(name: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    return this.act(async () => {
      const r = await this.api.runJob(name);
      const j = await this.api.jobs();
      this.jobs.set(j.jobs);
      return r.outcome.skipped ? `${humanize(name)} job already ran for this period (${r.outcome.reason ?? 'skipped'}).` : `${humanize(name)} job ${humanize(r.outcome.status ?? 'done').toLowerCase()}.`;
    });
  }

  protected summarize(result: unknown): string {
    if (!result || typeof result !== 'object') return '';
    const r = result as Record<string, unknown>;
    return Object.entries(r)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      .slice(0, 4)
      .map(([k, v]) => `${humanize(k)}: ${v}`)
      .join(' · ');
  }
}

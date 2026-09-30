import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MomentumApiService } from '../momentum-api.service';
import { CompareRow, ResearchRun, StrategySummary } from '../momentum.models';
import { ChartSeries, LineChartComponent } from '../shared/line-chart.component';
import { dateTime, errorMessage, humanize, inr, num, orderTone, pctNum, tone } from '../format.util';

const COLORS = ['#0f9d58', '#2563eb', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];

@Component({
  selector: 'app-momentum-strategy-lab-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LineChartComponent],
  template: `
    <div class="mp-page">
      <div class="mp-banner" data-tone="info">
        <div><strong>Strategy research is built to resist overfitting.</strong> Parameters are chosen on a <em>train</em> segment, confirmed on <em>validation</em>, and only the finalists are scored once on the untouched <em>out-of-sample</em> segment. Walk-forward repeats “fit on the past, trade the next window”. A good backtest is a hypothesis, not a promise.</div>
      </div>
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="mp-banner" data-tone="up" role="status">{{ notice() }}</div> }

      <div class="mp-card">
        <div class="mp-card-head"><div><h2>Compare strategies</h2><p class="mp-sub">Same data, same costs, same period — only the strategy differs.</p></div></div>
        <div class="mp-row picks">
          @for (s of strategies(); track s.id) {
            <label class="ui-check"><input type="checkbox" [checked]="picked().includes(s.id)" (change)="toggle(s.id)" /> {{ s.name }}</label>
          }
        </div>
        <form class="mp-row" (ngSubmit)="compare()">
          <div class="mp-field"><label for="lab-cap">Capital (₹)</label><input id="lab-cap" class="ui-input" type="number" name="cap" min="10000" step="10000" [(ngModel)]="capital" /></div>
          <div class="mp-field"><label for="lab-from">From</label><input id="lab-from" class="ui-input" type="date" name="from" [(ngModel)]="from" /></div>
          <div class="mp-field"><label for="lab-to">To</label><input id="lab-to" class="ui-input" type="date" name="to" [(ngModel)]="to" /></div>
          <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy() || picked().length < 1">{{ comparing() ? 'Comparing…' : 'Compare' }}</button>
        </form>
        @if (rows().length) {
          <mp-line-chart [series]="compareSeries()" [labels]="compareLabels()" [format]="moneyFmt" ariaLabel="Equity curves of the compared strategies" />
          <div class="mp-table-wrap"><table class="mp-table">
            <thead><tr><th>Strategy</th><th>Review</th><th class="num">Return</th><th class="num">CAGR</th><th class="num">Max DD</th><th class="num">Sharpe</th><th class="num">Win rate</th><th class="num">Trades</th><th class="num">Turnover/yr</th><th class="num">Costs</th></tr></thead>
            <tbody>
              @for (r of rows(); track r.strategyId) {
                <tr>
                  <td>{{ r.name }}</td><td>{{ r.horizon }}</td>
                  @if (r.metrics; as m) {
                    <td class="num" [class]="'mp-' + tone(m.totalReturnPct)">{{ pctNum(m.totalReturnPct, 1, true) }}</td><td class="num">{{ pctNum(m.cagrPct, 1) }}</td><td class="num">{{ pctNum(m.maxDrawdownPct, 1) }}</td>
                    <td class="num">{{ num(m.sharpe, 2) }}</td><td class="num">{{ pctNum(m.winRatePct, 0) }}</td><td class="num">{{ m.trades }}</td><td class="num">{{ num(m.turnoverPerYear, 1) }}×</td><td class="num">{{ inr(m.totalCosts) }}</td>
                  } @else { <td colspan="8" class="mp-muted">{{ r.error }}</td> }
                </tr>
              }
            </tbody></table></div>
        }
      </div>

      <div class="mp-card">
        <div class="mp-card-head"><div><h2>Research runs</h2><p class="mp-sub">Runs execute in the background on the server; you can leave this page and come back.</p></div></div>
        <div class="mp-form">
          <div class="mp-field"><label for="lab-strategy">Base strategy</label>
            <select id="lab-strategy" class="ui-select" name="base" [(ngModel)]="baseStrategy">
              @for (s of strategies(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
            </select></div>
          <div class="mp-field"><label for="lab-cand">Candidates</label><input id="lab-cand" class="ui-input" type="number" name="cand" min="4" max="40" [(ngModel)]="candidates" /></div>
          <div class="mp-field"><label for="lab-train">Walk-forward train (months)</label><input id="lab-train" class="ui-input" type="number" name="train" min="12" max="60" [(ngModel)]="trainMonths" /></div>
          <div class="mp-field"><label for="lab-test">Walk-forward test (months)</label><input id="lab-test" class="ui-input" type="number" name="test" min="3" max="24" [(ngModel)]="testMonths" /></div>
        </div>
        <div class="mp-row">
          <button type="button" class="ui-btn ui-btn-primary" [disabled]="busy()" (click)="start('optimize')">Optimize (train → validate → out-of-sample)</button>
          <button type="button" class="ui-btn ui-btn-secondary" [disabled]="busy()" (click)="start('walk')">Walk-forward test</button>
        </div>

        <div class="mp-table-wrap runs"><table class="mp-table">
          <thead><tr><th>#</th><th>Kind</th><th>Started</th><th>Status</th><th>Progress</th><th></th></tr></thead>
          <tbody>
            @for (r of runs(); track r.id) {
              <tr [class.sel]="selected()?.id === r.id">
                <td>{{ r.id }}</td><td>{{ r.kind === 'OPTIMIZE' ? 'Optimize' : 'Walk-forward' }}</td><td>{{ dateTime(r.createdAt) }}</td>
                <td><span class="mp-badge" [attr.data-tone]="orderTone(r.status)">{{ humanize(r.status) }}</span></td>
                <td><div class="mp-bar"><span [style.width.%]="r.progress * 100"></span></div></td>
                <td class="num">
                  <button type="button" class="ui-btn ui-btn-ghost mp-btn-sm" (click)="select(r.id)">View</button>
                  @if (r.status === 'RUNNING') { <button type="button" class="ui-btn ui-btn-danger mp-btn-sm" (click)="cancel(r.id)">Cancel</button> }
                </td>
              </tr>
            } @empty { <tr><td colspan="6" class="mp-empty">No research runs yet.</td></tr> }
          </tbody></table></div>
      </div>

      @if (selected(); as run) {
        @if (run.status === 'FAILED') {
          <div class="mp-banner" data-tone="down">Run {{ run.id }} failed: {{ run.error }}</div>
        } @else if (run.result; as res) {
          @if (run.kind === 'OPTIMIZE') {
            <div class="mp-card">
              <div class="mp-card-head"><div><h2>Optimization result #{{ run.id }}</h2><p class="mp-sub">{{ res.candidatesTested }} candidates · seed {{ res.seed }} · searched {{ res.space.join(', ') }}</p></div>
                @if (res.best && res.best.label !== 'baseline') {
                  <button type="button" class="ui-btn ui-btn-secondary" [disabled]="busy()" (click)="apply(run.id)">Save best candidate as a strategy</button>
                }</div>
              <div class="mp-callout"><strong>Verdict:</strong> {{ res.verdict }}</div>
              <div class="mp-stats">
                <div class="mp-stat"><span class="mp-stat-label">Train</span><span class="mp-stat-value sm">{{ res.splits.train.from }} → {{ res.splits.train.to }}</span></div>
                <div class="mp-stat"><span class="mp-stat-label">Validation</span><span class="mp-stat-value sm">{{ res.splits.validation.from }} → {{ res.splits.validation.to }}</span></div>
                <div class="mp-stat"><span class="mp-stat-label">Out-of-sample</span><span class="mp-stat-value sm">{{ res.splits.oos.from }} → {{ res.splits.oos.to }}</span></div>
              </div>
              <h3>Finalists</h3>
              <div class="mp-table-wrap"><table class="mp-table">
                <thead><tr><th>Candidate</th><th>Parameters changed</th><th class="num">Train CAGR</th><th class="num">Valid. CAGR</th><th class="num">OOS CAGR</th><th class="num">OOS max DD</th><th class="num">OOS Sharpe</th><th class="num">OOS trades</th><th>Overfitting flags</th></tr></thead>
                <tbody>
                  @for (f of res.finalists; track f.label) {
                    <tr>
                      <td><strong>{{ f.label }}</strong></td><td class="mp-small">{{ describe(f.overrides) }}</td>
                      <td class="num">{{ pct(f.train?.cagrPct) }}</td><td class="num">{{ pct(f.validation?.cagrPct) }}</td><td class="num">{{ pct(f.oos?.cagrPct) }}</td>
                      <td class="num">{{ pct(f.oos?.maxDrawdownPct) }}</td><td class="num">{{ f.oos ? num(f.oos.sharpe, 2) : '—' }}</td><td class="num">{{ f.oos?.roundTrips ?? '—' }}</td>
                      <td class="mp-small">
                        @for (fl of f.overfitFlags; track fl) { <div class="flag">⚠ {{ fl }}</div> } @empty { <span class="mp-up">None</span> }
                      </td>
                    </tr>
                  }
                </tbody></table></div>
              <p class="mp-small mp-muted">{{ res.caveat }}</p>
            </div>
          } @else {
            <div class="mp-card">
              <div class="mp-card-head"><div><h2>Walk-forward result #{{ run.id }}</h2><p class="mp-sub">Train {{ res.trainMonths }} months → trade the next {{ res.testMonths }} months, repeated. Each window only uses data before it.</p></div></div>
              <div class="mp-stats">
                <div class="mp-stat"><span class="mp-stat-label">Stitched out-of-sample return</span><span class="mp-stat-value" [class]="'mp-' + tone(res.summary.stitchedReturnPct)">{{ pctNum(res.summary.stitchedReturnPct, 1, true) }}</span><span class="mp-stat-hint">NIFTY {{ pctNum(res.summary.benchmarkStitchedReturnPct, 1, true) }}</span></div>
                <div class="mp-stat"><span class="mp-stat-label">Stitched CAGR</span><span class="mp-stat-value">{{ pctNum(res.summary.stitchedCagrPct, 1) }}</span></div>
                <div class="mp-stat"><span class="mp-stat-label">Windows beating NIFTY</span><span class="mp-stat-value">{{ res.summary.windowsBeatingBenchmark }} / {{ res.summary.windows }}</span></div>
                <div class="mp-stat"><span class="mp-stat-label">Worst window</span><span class="mp-stat-value mp-down">{{ pctNum(res.summary.worstTestWindowPct, 1) }}</span></div>
              </div>
              <div class="mp-table-wrap"><table class="mp-table">
                <thead><tr><th>Train</th><th>Test</th><th>Chosen</th><th>Parameters</th><th class="num">Test return</th><th class="num">NIFTY</th><th class="num">Max DD</th></tr></thead>
                <tbody>
                  @for (w of res.windows; track w.testFrom) {
                    <tr><td>{{ w.trainFrom }} → {{ w.trainTo }}</td><td>{{ w.testFrom }} → {{ w.testTo }}</td><td>{{ w.chosen }}</td><td class="mp-small">{{ describe(w.overrides) }}</td>
                      <td class="num" [class]="'mp-' + tone(w.test?.totalReturnPct)">{{ pct(w.test?.totalReturnPct, true) }}</td><td class="num">{{ pct(w.benchmarkReturnPct, true) }}</td><td class="num">{{ pct(w.test?.maxDrawdownPct) }}</td></tr>
                  }
                </tbody></table></div>
              <p class="mp-small mp-muted">{{ res.caveat }}</p>
            </div>
          }
        } @else {
          <div class="mp-card mp-empty">Run {{ run.id }} is {{ humanize(run.status).toLowerCase() }}… {{ num(run.progress * 100, 0) }}%</div>
        }
      }

      <div class="mp-card">
        <div class="mp-card-head"><div><h2>Create a custom strategy</h2><p class="mp-sub">Start from a preset and override a few parameters. Activate it from Settings and backtest it above.</p></div></div>
        <div class="mp-form">
          <div class="mp-field"><label for="cs-name">Name</label><input id="cs-name" class="ui-input" name="name" [(ngModel)]="customName" placeholder="My momentum" /></div>
          <div class="mp-field"><label for="cs-base">Based on</label>
            <select id="cs-base" class="ui-select" name="cbase" [(ngModel)]="customBase">
              @for (s of strategies(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
            </select></div>
          <div class="mp-field"><label for="cs-h">Review horizon</label>
            <select id="cs-h" class="ui-select" name="ch" [(ngModel)]="customHorizon">
              <option value="">Keep base</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
            </select></div>
          <div class="mp-field"><label for="cs-score">Minimum score</label><input id="cs-score" class="ui-input" type="number" name="cscore" min="40" max="90" [(ngModel)]="customMinScore" /></div>
          <div class="mp-field"><label for="cs-n">Max positions</label><input id="cs-n" class="ui-input" type="number" name="cn" min="1" max="40" [(ngModel)]="customMax" /></div>
          <div class="mp-field"><label for="cs-stop">Initial stop (× ATR)</label><input id="cs-stop" class="ui-input" type="number" name="cstop" min="1" max="8" step="0.5" [(ngModel)]="customStop" /></div>
          <div class="mp-field"><label for="cs-trail">Trailing stop (× ATR)</label><input id="cs-trail" class="ui-input" type="number" name="ctrail" min="1" max="10" step="0.5" [(ngModel)]="customTrail" /></div>
        </div>
        <div class="mp-row">
          <button type="button" class="ui-btn ui-btn-primary" [disabled]="busy() || !customName.trim()" (click)="saveCustom()">Save strategy</button>
        </div>
        <ul class="mp-list">
          @for (s of customStrategies(); track s.id) {
            <li><strong>{{ s.name }}</strong> <span class="mp-muted">{{ s.description }}</span> <button type="button" class="ui-btn ui-btn-ghost mp-btn-sm" (click)="remove(s.id)">Delete</button></li>
          }
        </ul>
      </div>
    </div>
  `,
  styles: `
    .picks { margin-bottom: 0.75rem; }
    .runs { margin-top: 1rem; }
    .sel { background: var(--mp-hover, rgba(0, 0, 0, 0.04)); }
    .flag { color: #b45309; margin-bottom: 0.2rem; }
    .sm { font-size: 0.85rem; }
    .mp-bar { min-width: 90px; }
  `,
})
export class StrategyLabTabComponent implements OnInit, OnDestroy {
  private readonly api = inject(MomentumApiService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly strategies = signal<StrategySummary[]>([]);
  protected readonly picked = signal<string[]>([]);
  protected readonly rows = signal<CompareRow[]>([]);
  protected readonly runs = signal<ResearchRun[]>([]);
  protected readonly selected = signal<ResearchRun | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  protected readonly comparing = signal(false);

  protected capital = 1000000;
  protected from = '';
  protected to = '';
  protected baseStrategy = '';
  protected candidates = 16;
  protected trainMonths = 24;
  protected testMonths = 6;
  protected customName = '';
  protected customBase = '';
  protected customHorizon = '';
  protected customMinScore: number | null = null;
  protected customMax: number | null = null;
  protected customStop: number | null = null;
  protected customTrail: number | null = null;

  protected readonly inr = inr;
  protected readonly num = num;
  protected readonly pctNum = pctNum;
  protected readonly tone = tone;
  protected readonly humanize = humanize;
  protected readonly dateTime = dateTime;
  protected readonly orderTone = orderTone;
  protected readonly moneyFmt = (v: number) => (Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : `₹${v.toFixed(0)}`);

  protected readonly customStrategies = computed(() => this.strategies().filter((s) => !s.preset));
  protected readonly compareLabels = computed(() => (this.rows().find((r) => r.equity?.length)?.equity ?? []).map((p) => p.date));
  protected readonly compareSeries = computed<ChartSeries[]>(() =>
    this.rows()
      .filter((r) => r.equity?.length)
      .map((r, i) => ({ name: r.name, color: COLORS[i % COLORS.length], values: r.equity!.map((p) => p.equity) })),
  );

  ngOnInit(): void {
    void this.init();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private async init(): Promise<void> {
    try {
      const cfg = await this.api.config();
      this.strategies.set(cfg.strategies);
      this.baseStrategy = cfg.settings.strategyId;
      this.customBase = cfg.settings.strategyId;
      this.picked.set(cfg.strategies.filter((s) => s.preset).slice(0, 3).map((s) => s.id));
      await this.loadRuns();
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load the Strategy Lab'));
    }
  }

  protected pct(v: number | null | undefined, signed = false): string {
    return v == null ? '—' : pctNum(v, 1, signed);
  }

  protected describe(overrides: Record<string, unknown> | undefined): string {
    const e = Object.entries(overrides ?? {});
    return e.length ? e.map(([k, v]) => `${humanize(k)}: ${v}`).join(', ') : 'current parameters';
  }

  protected toggle(id: string): void {
    this.picked.update((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  protected async compare(): Promise<void> {
    this.busy.set(true);
    this.comparing.set(true);
    this.error.set('');
    try {
      const body: { capital: number; from?: string; to?: string; strategyIds: string[] } = { capital: Number(this.capital), strategyIds: this.picked() };
      if (this.from) body.from = this.from;
      if (this.to) body.to = this.to;
      this.rows.set((await this.api.compare(body)).rows);
    } catch (err) {
      this.error.set(errorMessage(err, 'Comparison failed'));
    } finally {
      this.busy.set(false);
      this.comparing.set(false);
    }
  }

  private async loadRuns(): Promise<void> {
    const r = await this.api.runs();
    this.runs.set(r.runs);
    const sel = this.selected();
    if (sel) {
      const fresh = r.runs.find((x) => x.id === sel.id);
      if (fresh && (fresh.status !== sel.status || fresh.progress !== sel.progress)) await this.select(fresh.id);
    }
    if (r.runs.some((x) => x.status === 'RUNNING')) this.startPolling();
    else this.stopPolling();
  }

  private startPolling(): void {
    if (!this.browser || this.timer) return;
    this.timer = setInterval(() => void this.loadRuns().catch(() => undefined), 2500);
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  protected async start(kind: 'optimize' | 'walk'): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const common = { strategyId: this.baseStrategy, capital: Number(this.capital), candidates: Number(this.candidates) };
      const r = kind === 'optimize' ? await this.api.optimize(common) : await this.api.walkForward({ ...common, trainMonths: Number(this.trainMonths), testMonths: Number(this.testMonths) });
      this.notice.set(`Research run #${r.run.id} started.`);
      await this.select(r.run.id);
      await this.loadRuns();
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not start the run'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async select(id: number): Promise<void> {
    try {
      this.selected.set((await this.api.getRun(id)).run);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async cancel(id: number): Promise<void> {
    try {
      await this.api.cancelRun(id);
      await this.loadRuns();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async apply(id: number): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.api.applyRun(id);
      this.notice.set(`Saved “${r.strategy.name}”. Paper trade it before relying on it — activate it in Settings.`);
      this.strategies.set((await this.api.config()).strategies);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveCustom(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    const overrides: Record<string, unknown> = {};
    if (this.customHorizon) overrides['horizon'] = this.customHorizon;
    if (this.customMinScore) overrides['minScore'] = Number(this.customMinScore);
    if (this.customMax) overrides['maxPositions'] = Number(this.customMax);
    if (this.customStop) overrides['stopAtrMult'] = Number(this.customStop);
    if (this.customTrail) overrides['trailAtrMult'] = Number(this.customTrail);
    try {
      const r = await this.api.saveStrategy({ name: this.customName.trim(), basePreset: this.customBase, overrides });
      this.notice.set(`Saved “${r.strategy.name}”.`);
      this.customName = '';
      this.strategies.set((await this.api.config()).strategies);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(id: string): Promise<void> {
    try {
      await this.api.deleteStrategy(id);
      this.strategies.set((await this.api.config()).strategies);
      this.picked.update((p) => p.filter((x) => x !== id));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}

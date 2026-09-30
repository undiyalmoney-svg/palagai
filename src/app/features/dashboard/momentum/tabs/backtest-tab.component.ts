import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BacktestRequest, MomentumApiService } from '../momentum-api.service';
import { Backtest, BacktestListItem, StrategySummary, WhatIfResponse } from '../momentum.models';
import { ChartSeries, LineChartComponent } from '../shared/line-chart.component';
import { DecisionResultComponent } from '../shared/decision-result.component';
import { actionTone, dateTime, errorMessage, humanize, inr, num, pctNum, shortDate, signedInr, tone } from '../format.util';

const PAGE = 100;

@Component({
  selector: 'app-momentum-backtest-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LineChartComponent, DecisionResultComponent],
  template: `
    <div class="mp-page">
      <div class="mp-banner" data-tone="info">
        <div>Backtests run the <strong>same decision engine</strong> used for live signals, bar by bar. At every step the engine sees only data up to that day's close; orders fill at the next open with slippage and Zerodha-style costs.
          @if (simulated()) { <strong>Market data is simulated</strong> — results illustrate behaviour, not real returns. }
        </div>
      </div>
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }

      <div class="mp-card">
        <div class="mp-card-head"><div><h2>Run a backtest</h2></div></div>
        <form (ngSubmit)="run()">
          <div class="mp-form">
            <div class="mp-field"><label for="bt-strategy">Strategy</label>
              <select id="bt-strategy" class="ui-select" name="strategy" [(ngModel)]="strategyId">
                @for (s of strategies(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
              </select></div>
            <div class="mp-field"><label for="bt-cap">Starting capital (₹)</label><input id="bt-cap" class="ui-input" type="number" name="cap" min="10000" step="10000" [(ngModel)]="capital" /></div>
            <div class="mp-field"><label for="bt-from">From</label><input id="bt-from" class="ui-input" type="date" name="from" [(ngModel)]="from" /></div>
            <div class="mp-field"><label for="bt-to">To</label><input id="bt-to" class="ui-input" type="date" name="to" [(ngModel)]="to" /></div>
            <div class="mp-field"><label for="bt-n">Max number of stocks</label><input id="bt-n" class="ui-input" type="number" name="n" min="1" max="40" [(ngModel)]="numStocks" /></div>
            <div class="mp-field"><label for="bt-reb">Rebalance frequency</label>
              <select id="bt-reb" class="ui-select" name="reb" [(ngModel)]="rebalance">
                <option value="">Strategy default</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
              </select></div>
            <div class="mp-field"><label for="bt-slip">Slippage (bps)</label><input id="bt-slip" class="ui-input" type="number" name="slip" min="0" step="1" [(ngModel)]="slippage" /></div>
            <div class="mp-field"><label for="bt-extra">Extra costs (bps)</label><input id="bt-extra" class="ui-input" type="number" name="extra" min="0" step="1" [(ngModel)]="extraBps" /></div>
            <div class="mp-field"><label for="bt-ce-date">Capital added on (optional)</label><input id="bt-ce-date" class="ui-input" type="date" name="cedate" [(ngModel)]="eventDate" /></div>
            <div class="mp-field"><label for="bt-ce-amt">Amount added (₹)</label><input id="bt-ce-amt" class="ui-input" type="number" name="ceamt" step="10000" [(ngModel)]="eventAmount" /></div>
          </div>
          <div class="mp-row">
            <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">{{ busy() ? 'Running…' : 'Run backtest' }}</button>
            <span class="mp-small mp-muted">Leave dates empty to use all available history.</span>
          </div>
        </form>
      </div>

      @if (bt(); as b) {
        <div class="mp-card">
          <div class="mp-card-head"><div><h2>{{ b.name }}</h2>
            <p class="mp-sub">{{ b.extra?.actualFrom || b.from }} → {{ b.extra?.actualTo || b.to }} · {{ b.config.rebalance }} review · up to {{ b.config.numStocks }} stocks · slippage {{ b.config.slippageBps }} bps</p></div></div>
          @if (b.metrics; as m) {
            <div class="mp-stats">
              <div class="mp-stat"><span class="mp-stat-label">Start → End capital</span><span class="mp-stat-value">{{ inr(m.endCapital) }}</span><span class="mp-stat-hint">from {{ inr(m.startCapital) }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Total return</span><span class="mp-stat-value" [class]="'mp-' + tone(m.totalReturnPct)">{{ pctNum(m.totalReturnPct, 1, true) }}</span><span class="mp-stat-hint">NIFTY {{ pctNum(m.benchmarkReturnPct, 1, true) }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">CAGR</span><span class="mp-stat-value">{{ pctNum(m.cagrPct, 1) }}</span><span class="mp-stat-hint">NIFTY {{ pctNum(m.benchmarkCagrPct, 1) }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Max drawdown</span><span class="mp-stat-value mp-down">{{ pctNum(m.maxDrawdownPct, 1) }}</span><span class="mp-stat-hint">NIFTY {{ pctNum(m.benchmarkMaxDrawdownPct, 1) }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Sharpe / Sortino</span><span class="mp-stat-value">{{ num(m.sharpe, 2) }} / {{ num(m.sortino, 2) }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Win rate</span><span class="mp-stat-value">{{ pctNum(m.winRatePct, 0) }}</span><span class="mp-stat-hint">{{ m.roundTrips }} round trips</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Profit factor</span><span class="mp-stat-value">{{ num(m.profitFactor, 2) }}</span><span class="mp-stat-hint">expectancy {{ signedInr(m.expectancy) }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Trades</span><span class="mp-stat-value">{{ m.trades }}</span><span class="mp-stat-hint">avg holding {{ num(m.avgHoldingDays, 0) }} days</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Avg win / loss</span><span class="mp-stat-value">{{ signedInr(m.avgProfit) }} / {{ signedInr(m.avgLoss) }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Turnover / year</span><span class="mp-stat-value">{{ num(m.turnoverPerYear, 1) }}×</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Costs &amp; slippage</span><span class="mp-stat-value">{{ inr(m.totalCosts + m.totalSlippage) }}</span><span class="mp-stat-hint">costs {{ inr(m.totalCosts) }} · slippage {{ inr(m.totalSlippage) }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Alpha vs NIFTY (CAGR)</span><span class="mp-stat-value" [class]="'mp-' + tone(m.alphaCagrPct)">{{ pctNum(m.alphaCagrPct, 1, true) }}</span></div>
            </div>
          }
          <mp-line-chart [series]="chartSeries()" [labels]="chartLabels()" [format]="moneyFmt" ariaLabel="Backtest equity curve versus NIFTY" />
        </div>

        <div class="mp-grid">
          <div class="mp-card mp-col-6">
            <div class="mp-card-head"><div><h3>Why positions were closed</h3><p class="mp-sub">Exits are triggered by the thesis breaking or risk rules — never by holding time alone.</p></div></div>
            <div class="mp-table-wrap"><table class="mp-table">
              <thead><tr><th>Exit reason</th><th class="num">Count</th><th class="num">Net P&amp;L</th><th class="num">Avg holding</th></tr></thead>
              <tbody>
                @for (e of exits(); track e.name) {
                  <tr><td>{{ humanize(e.name) }}</td><td class="num">{{ e.count }}</td><td class="num" [class]="'mp-' + tone(e.pnl)">{{ signedInr(e.pnl) }}</td><td class="num">{{ num(e.avgHoldingDays, 0) }}d</td></tr>
                } @empty { <tr><td colspan="4" class="mp-empty">No closed positions.</td></tr> }
              </tbody></table></div>
          </div>
          <div class="mp-card mp-col-6">
            <div class="mp-card-head"><div><h3>Open at the end</h3></div></div>
            <div class="mp-table-wrap"><table class="mp-table">
              <thead><tr><th>Stock</th><th class="num">Qty</th><th class="num">Avg</th><th class="num">Last</th><th class="num">Unrealised</th><th>Since</th></tr></thead>
              <tbody>
                @for (p of b.extra?.openPositions ?? []; track p.symbol) {
                  <tr><td class="mp-sym">{{ p.symbol }}</td><td class="num">{{ p.qty }}</td><td class="num">{{ inr(p.avgPrice, 2) }}</td><td class="num">{{ inr(p.lastPrice, 2) }}</td><td class="num" [class]="'mp-' + tone(p.unrealizedPnl)">{{ signedInr(p.unrealizedPnl) }}</td><td>{{ shortDate(p.entryDate) }}</td></tr>
                } @empty { <tr><td colspan="6" class="mp-empty">Flat at the end.</td></tr> }
              </tbody></table></div>
          </div>
        </div>

        <div class="mp-card">
          <div class="mp-card-head"><div><h3>Every trade ({{ b.trades.length }})</h3><p class="mp-sub">Each BUY and SELL with the reason the engine gave at the time and the resulting P&amp;L.</p></div>
            <div class="mp-row">
              <label class="ui-check"><input type="checkbox" [ngModel]="sellsOnly()" (ngModelChange)="sellsOnly.set($event); page.set(0)" /> Exits only</label>
            </div></div>
          <div class="mp-table-wrap"><table class="mp-table">
            <thead><tr><th>#</th><th>Date</th><th>Stock</th><th>Action</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Cost</th><th class="num">P&amp;L</th><th class="num">Held</th><th>Regime</th><th>Reason</th></tr></thead>
            <tbody>
              @for (t of pagedTrades(); track t.seq) {
                <tr>
                  <td>{{ t.seq }}</td><td>{{ t.date }}</td><td class="mp-sym">{{ t.symbol }}</td>
                  <td><span class="mp-badge" [attr.data-tone]="actionTone(t.action)">{{ t.action }}</span></td>
                  <td class="num">{{ t.qty }}</td><td class="num">{{ inr(t.price, 2) }}</td><td class="num">{{ inr(t.cost, 2) }}</td>
                  <td class="num" [class]="'mp-' + tone(t.pnl)">{{ t.pnl == null ? '—' : signedInr(t.pnl) }}@if (t.pnlPct != null) { <div class="mp-small">{{ pctNum(t.pnlPct * 100, 1, true) }}</div> }</td>
                  <td class="num">{{ t.holdingDays ?? '—' }}</td><td class="mp-small">{{ humanize(t.regime) }}</td><td class="reason">{{ t.reason }}</td>
                </tr>
              } @empty { <tr><td colspan="11" class="mp-empty">No trades.</td></tr> }
            </tbody></table></div>
          @if (pageCount() > 1) {
            <div class="mp-row pager">
              <button type="button" class="ui-btn ui-btn-secondary mp-btn-sm" [disabled]="page() === 0" (click)="page.set(page() - 1)">Previous</button>
              <span class="mp-small">Page {{ page() + 1 }} of {{ pageCount() }}</span>
              <button type="button" class="ui-btn ui-btn-secondary mp-btn-sm" [disabled]="page() >= pageCount() - 1" (click)="page.set(page() + 1)">Next</button>
            </div>
          }
        </div>
      }

      <div class="mp-card">
        <div class="mp-card-head"><div><h2>Time machine — “What would the system have done on …?”</h2>
          <p class="mp-sub">Runs the live decision engine on the data that existed at the close of that day, then shows what actually happened afterwards. The engine is re-run on truncated history to prove it did not peek ahead.</p></div></div>
        <form class="mp-row" (ngSubmit)="whatIf()">
          <div class="mp-field"><label for="wi-date">Date</label><input id="wi-date" class="ui-input" type="date" name="date" [(ngModel)]="wiDate" /></div>
          <div class="mp-field"><label for="wi-cap">Capital (₹)</label><input id="wi-cap" class="ui-input" type="number" name="cap" min="10000" step="10000" [(ngModel)]="wiCapital" /></div>
          <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">Reconstruct decision</button>
        </form>
        @if (wi(); as w) {
          <div class="mp-row badges">
            <span class="mp-badge" [attr.data-tone]="w.verifiedNoLookahead ? 'up' : 'muted'">{{ w.verifiedNoLookahead ? 'Verified: no look-ahead' : 'Latest day — nothing after it to verify against' }}</span>
            <span class="mp-small mp-muted">Requested {{ w.requestedDate }}, decided at the close of {{ w.asOf }} · {{ w.strategy.name }} · {{ inr(w.capital) }}</span>
          </div>
          <mp-decision-result [result]="w.result" />
          <div class="mp-card inner">
            <div class="mp-card-head"><div><h3>What happened next (hindsight — not available to the engine)</h3><p class="mp-sub">{{ w.hindsight.note }}</p></div></div>
            <div class="mp-stats">
              <div class="mp-stat"><span class="mp-stat-label">Buys from that day</span><span class="mp-stat-value" [class]="'mp-' + tone(w.hindsight.pnl)">{{ signedInr(w.hindsight.pnl) }}</span><span class="mp-stat-hint">{{ pctNum(w.hindsight.returnOnInvestedPct, 1, true) }} on {{ inr(w.hindsight.invested) }} to {{ w.hindsight.through }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">NIFTY over same period</span><span class="mp-stat-value">{{ pctNum(w.hindsight.benchmarkReturnPct, 1, true) }}</span></div>
              <div class="mp-stat"><span class="mp-stat-label">Following the system since</span><span class="mp-stat-value">{{ inr(w.hindsight.followedSystem.endCapital) }}</span><span class="mp-stat-hint">{{ pctNum(w.hindsight.followedSystem.totalReturnPct, 1, true) }} · max DD {{ pctNum(w.hindsight.followedSystem.maxDrawdownPct, 1) }} · {{ w.hindsight.followedSystem.trades }} trades</span></div>
            </div>
            @if (w.hindsight.buys.length) {
              <div class="mp-table-wrap"><table class="mp-table">
                <thead><tr><th>Stock</th><th class="num">Qty</th><th class="num">Entry</th><th class="num">Now</th><th class="num">Return</th><th class="num">P&amp;L</th><th>Stop</th></tr></thead>
                <tbody>
                  @for (x of w.hindsight.buys; track x.symbol) {
                    <tr><td class="mp-sym">{{ x.symbol }}</td><td class="num">{{ x.quantity }}</td><td class="num">{{ inr(x.entry, 2) }}</td><td class="num">{{ inr(x.endPrice, 2) }}</td>
                      <td class="num" [class]="'mp-' + tone(x.returnPct)">{{ pctNum(x.returnPct, 1, true) }}</td><td class="num" [class]="'mp-' + tone(x.pnl)">{{ signedInr(x.pnl) }}</td>
                      <td>{{ x.stopHit ? 'Hit ' + x.stopHit.date + ' at ' + inr(x.stopHit.price, 2) : 'Not hit' }}</td></tr>
                  }
                </tbody></table></div>
            }
          </div>
        }
      </div>

      <div class="mp-card">
        <div class="mp-card-head"><h3>Saved backtests</h3></div>
        <div class="mp-table-wrap"><table class="mp-table">
          <thead><tr><th>Name</th><th>Period</th><th>Run</th><th class="num">Return</th><th class="num">CAGR</th><th class="num">Max DD</th><th class="num">Sharpe</th><th></th></tr></thead>
          <tbody>
            @for (r of saved(); track r.id) {
              <tr>
                <td>{{ r.name }}</td><td>{{ r.from }} → {{ r.to }}</td><td>{{ dateTime(r.createdAt) }}</td>
                @if (r.metrics; as m) {
                  <td class="num" [class]="'mp-' + tone(m.totalReturnPct)">{{ pctNum(m.totalReturnPct, 1, true) }}</td><td class="num">{{ pctNum(m.cagrPct, 1) }}</td><td class="num">{{ pctNum(m.maxDrawdownPct, 1) }}</td><td class="num">{{ num(m.sharpe, 2) }}</td>
                } @else { <td colspan="4" class="mp-muted">{{ humanize(r.status) }}</td> }
                <td class="num"><button type="button" class="ui-btn ui-btn-ghost mp-btn-sm" (click)="open(r.id)">Open</button></td>
              </tr>
            } @empty { <tr><td colspan="8" class="mp-empty">No saved backtests yet.</td></tr> }
          </tbody></table></div>
      </div>
    </div>
  `,
  styles: `
    .pager { justify-content: center; margin-top: 0.75rem; }
    .badges { margin: 0.9rem 0 0.5rem; }
    .inner { margin-top: 1rem; }
    .reason { max-width: 420px; font-size: 0.8rem; }
  `,
})
export class BacktestTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);

  protected readonly strategies = signal<StrategySummary[]>([]);
  protected readonly simulated = signal(false);
  protected readonly bt = signal<Backtest | null>(null);
  protected readonly saved = signal<BacktestListItem[]>([]);
  protected readonly wi = signal<WhatIfResponse | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly page = signal(0);
  protected readonly sellsOnly = signal(false);

  protected strategyId = '';
  protected capital = 100000;
  protected from = '';
  protected to = '';
  protected numStocks: number | null = null;
  protected rebalance = '';
  protected slippage = 5;
  protected extraBps = 0;
  protected eventDate = '';
  protected eventAmount: number | null = null;
  protected wiDate = '';
  protected wiCapital = 100000;

  protected readonly inr = inr;
  protected readonly num = num;
  protected readonly pctNum = pctNum;
  protected readonly signedInr = signedInr;
  protected readonly shortDate = shortDate;
  protected readonly dateTime = dateTime;
  protected readonly humanize = humanize;
  protected readonly tone = tone;
  protected readonly actionTone = actionTone;
  protected readonly moneyFmt = (v: number) => (Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : `₹${v.toFixed(0)}`);

  protected readonly chartLabels = computed(() => (this.bt()?.equity ?? []).map((p) => p.date));
  protected readonly chartSeries = computed<ChartSeries[]>(() => {
    const b = this.bt();
    if (!b) return [];
    const s: ChartSeries[] = [{ name: 'Strategy', color: '#0f9d58', values: b.equity.map((p) => p.equity), area: true }];
    const bench = b.extra?.benchmark;
    if (bench?.length) s.push({ name: 'NIFTY buy & hold', color: '#6b7280', values: bench, dashed: true });
    return s;
  });
  protected readonly exits = computed(() =>
    Object.entries(this.bt()?.extra?.exitBreakdown ?? {})
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count),
  );
  private readonly shownTrades = computed(() => {
    const t = this.bt()?.trades ?? [];
    return this.sellsOnly() ? t.filter((x) => x.side === 'SELL') : t;
  });
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.shownTrades().length / PAGE)));
  protected readonly pagedTrades = computed(() => this.shownTrades().slice(this.page() * PAGE, (this.page() + 1) * PAGE));

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const [cfg, st, list] = await Promise.all([this.api.config(), this.api.status(), this.api.backtests()]);
      this.strategies.set(cfg.strategies);
      this.strategyId = cfg.settings.strategyId;
      this.slippage = cfg.settings.slippageBps;
      this.extraBps = cfg.settings.costs.extraBps;
      this.simulated.set(st.provider.simulated);
      this.saved.set(list.backtests);
      this.wiDate = st.data.last ? this.shiftYears(st.data.last, -1) : '';
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load backtest options'));
    }
  }

  private shiftYears(iso: string, years: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d.toISOString().slice(0, 10);
  }

  protected async run(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    const body: BacktestRequest = {
      strategyId: this.strategyId,
      capital: Number(this.capital),
      slippageBps: Number(this.slippage),
      costs: { extraBps: Number(this.extraBps) },
    };
    if (this.from) body.from = this.from;
    if (this.to) body.to = this.to;
    if (this.numStocks) body.numStocks = Number(this.numStocks);
    if (this.rebalance) body.rebalance = this.rebalance;
    if (this.eventDate && this.eventAmount) body.capitalEvents = [{ date: this.eventDate, amount: Number(this.eventAmount) }];
    try {
      const r = await this.api.backtest(body);
      this.show(r.backtest);
      this.saved.set((await this.api.backtests()).backtests);
    } catch (err) {
      this.error.set(errorMessage(err, 'Backtest failed'));
    } finally {
      this.busy.set(false);
    }
  }

  private show(b: Backtest): void {
    this.bt.set(b);
    this.page.set(0);
    this.sellsOnly.set(false);
  }

  protected async open(id: number): Promise<void> {
    this.busy.set(true);
    try {
      this.show((await this.api.getBacktest(id)).backtest);
      this.error.set('');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async whatIf(): Promise<void> {
    if (!this.wiDate) {
      this.error.set('Pick a date first.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      this.wi.set(await this.api.whatIf({ date: this.wiDate, capital: Number(this.wiCapital), strategyId: this.strategyId || undefined }));
    } catch (err) {
      this.wi.set(null);
      this.error.set(errorMessage(err, 'Could not reconstruct that date'));
    } finally {
      this.busy.set(false);
    }
  }
}

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CapitalChangeResponse, MomentumApiService } from '../momentum-api.service';
import { MomentumStateService } from '../momentum-state.service';
import { Performance, PortfolioMode, PortfolioView } from '../momentum.models';
import { ChartSeries, LineChartComponent } from '../shared/line-chart.component';
import { DecisionResultComponent } from '../shared/decision-result.component';
import { dateTime, errorMessage, humanize, inr, num, pctFrac, pctNum, shortDate, signedInr, tone } from '../format.util';

@Component({
  selector: 'app-momentum-portfolio-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LineChartComponent, DecisionResultComponent],
  template: `
    <div class="mp-page">
      @if (state.liveAvailable()) {
        <div class="mp-row">
          <div class="mp-tabs seg">
            <button type="button" class="mp-tab" [class.active]="mode() === 'PAPER'" (click)="setMode('PAPER')">Paper</button>
            <button type="button" class="mp-tab" [class.active]="mode() === 'LIVE'" (click)="setMode('LIVE')">Live</button>
          </div>
        </div>
      }
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="mp-banner" data-tone="up" role="status">{{ notice() }}</div> }

      @if (missing()) {
        @if (mode() === 'PAPER') {
          <div class="mp-card">
            <div class="mp-card-head"><div><h2>Start a paper portfolio</h2>
              <p class="mp-sub">Paper trading uses the same decision engine and order pipeline as live trading, with simulated fills at current prices, real costs and slippage. No real money is involved.</p></div></div>
            <form class="mp-row" (ngSubmit)="startPaper()">
              <div class="mp-field"><label for="pf-cap">Starting capital (₹)</label>
                <input id="pf-cap" class="ui-input" type="number" name="cap" min="10000" step="10000" [(ngModel)]="startCapital" /></div>
              <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">Start paper portfolio</button>
            </form>
          </div>
        } @else {
          <div class="mp-card mp-empty">No live portfolio yet. Enable live trading from the Live Trading tab.</div>
        }
      } @else if (view(); as v) {
        <div class="mp-stats">
          <div class="mp-stat"><span class="mp-stat-label">Portfolio value</span><span class="mp-stat-value">{{ inr(v.valuation.equity) }}</span><span class="mp-stat-hint">started {{ inr(v.portfolio.initialCapital) }}</span></div>
          <div class="mp-stat"><span class="mp-stat-label">Cash</span><span class="mp-stat-value">{{ inr(v.valuation.cash) }}</span><span class="mp-stat-hint">{{ pctNum(100 - v.valuation.exposurePct, 1) }} of portfolio</span></div>
          <div class="mp-stat"><span class="mp-stat-label">Invested</span><span class="mp-stat-value">{{ inr(v.valuation.invested) }}</span><span class="mp-stat-hint">{{ v.positions.length }} stock(s) · {{ pctNum(v.valuation.exposurePct, 1) }}</span></div>
          <div class="mp-stat"><span class="mp-stat-label">Unrealised P&amp;L</span><span class="mp-stat-value" [class]="'mp-' + tone(v.valuation.unrealized)">{{ signedInr(v.valuation.unrealized) }}</span></div>
          @if (perf(); as p) {
            <div class="mp-stat"><span class="mp-stat-label">Total return</span><span class="mp-stat-value" [class]="'mp-' + tone(p.totalReturnPct)">{{ pctNum(p.totalReturnPct, 2, true) }}</span><span class="mp-stat-hint">{{ signedInr(p.totalPnl) }} net of {{ inr(p.totalCosts) }} costs</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Realised P&amp;L</span><span class="mp-stat-value" [class]="'mp-' + tone(p.realizedPnl)">{{ signedInr(p.realizedPnl) }}</span><span class="mp-stat-hint">{{ p.tradesClosed }} exit(s) · win rate {{ pctNum(p.winRatePct, 0) }}</span></div>
          }
        </div>

        @if (chartValues().length > 1) {
          <div class="mp-card">
            <div class="mp-card-head"><div><h3>Equity curve</h3><p class="mp-sub">Daily portfolio value, including cash.</p></div></div>
            <mp-line-chart [series]="chartSeries()" [labels]="chartLabels()" [format]="moneyFmt" ariaLabel="Portfolio equity curve" />
          </div>
        }

        <div class="mp-card">
          <div class="mp-card-head"><div><h3>Positions</h3><p class="mp-sub">Held while the thesis stays valid — never sold just for age. Stops ratchet up, never down.</p></div>
            <a class="ui-btn ui-btn-secondary mp-btn-sm" routerLink="../decision-center">Review holdings</a></div>
          <div class="mp-table-wrap">
            <table class="mp-table">
              <thead><tr><th>Stock</th><th class="num">Qty</th><th class="num">Avg cost</th><th class="num">Last</th><th class="num">Value</th><th class="num">Weight</th><th class="num">P&amp;L</th><th class="num">Stop</th><th class="num">Risk to stop</th><th>Since</th></tr></thead>
              <tbody>
                @for (p of v.positions; track p.symbol) {
                  <tr>
                    <td><span class="mp-sym">{{ p.symbol }}</span><div class="mp-small mp-muted">{{ p.sector }}</div></td>
                    <td class="num">{{ p.qty }}</td>
                    <td class="num">{{ inr(p.avgPrice, 2) }}</td>
                    <td class="num">{{ inr(p.lastPrice, 2) }}</td>
                    <td class="num">{{ inr(p.value) }}</td>
                    <td class="num">{{ pctNum(p.weightPct, 1) }}</td>
                    <td class="num" [class]="'mp-' + tone(p.unrealizedPnl)">{{ signedInr(p.unrealizedPnl) }}<div class="mp-small">{{ pctFrac(p.unrealizedPct, 1, true) }}</div></td>
                    <td class="num">{{ p.stopPrice ? inr(p.stopPrice, 2) : '—' }}</td>
                    <td class="num">{{ p.riskToStop != null ? inr(p.riskToStop) : '—' }}</td>
                    <td>{{ shortDate(p.entryDate) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="10" class="mp-empty">No open positions. Cash is a position too — the engine buys only when trend, momentum and timing agree.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="mp-grid">
          <div class="mp-card mp-col-5">
            <div class="mp-card-head"><h3>Sector exposure</h3></div>
            @for (s of sectors(); track s.name) {
              <div class="sec"><span>{{ s.name }}</span><div class="mp-bar" [attr.data-tone]="s.value > 35 ? 'warn' : null"><span [style.width.%]="s.value"></span></div><span class="mp-num">{{ pctNum(s.value, 1) }}</span></div>
            } @empty {
              <p class="mp-sub">No sector exposure.</p>
            }
          </div>

          <div class="mp-card mp-col-7">
            <div class="mp-card-head"><div><h3>Change capital</h3>
              <p class="mp-sub">Add or withdraw money. The engine decides whether to top up holdings, buy new stocks, keep cash, or rebalance — and explains why.</p></div></div>
            @if (mode() === 'PAPER') {
              <form class="mp-row" (ngSubmit)="changeCapital(1)">
                <div class="mp-field grow"><label for="cap-amt">Amount (₹)</label><input id="cap-amt" class="ui-input" type="number" name="amt" min="1000" step="1000" [(ngModel)]="capitalAmount" /></div>
                <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">Add capital</button>
                <button type="button" class="ui-btn ui-btn-secondary" [disabled]="busy()" (click)="changeCapital(-1)">Withdraw</button>
              </form>
            } @else {
              <p class="mp-sub">Live capital follows your broker account. Change funds at the broker, then use “Sync funds” on the Live Trading tab.</p>
            }
            <h4 class="mp-small mp-muted evt-title">Capital events</h4>
            <ul class="mp-list plain">
              @for (e of v.capitalEvents; track e.id) {
                <li>{{ dateTime(e.ts) }} — <strong>{{ humanize(e.kind) }}</strong> {{ inr(e.amount) }} <span class="mp-muted">{{ e.note }}</span></li>
              }
            </ul>
          </div>
        </div>

        @if (change(); as c) {
          <div class="mp-card">
            <div class="mp-card-head"><div><h3>{{ c.kind === 'DEPOSIT' ? 'How the additional capital is deployed' : 'Capital withdrawal' }}</h3>
              @if (c.message) { <p class="mp-sub">{{ c.message }}</p> }</div></div>
            @if (c.execution?.results?.length) {
              <ul class="mp-list">
                @for (x of c.execution!.results; track x.signalId) { <li>{{ x.action }} {{ x.symbol }} — {{ humanize(x.status) }} {{ x.message ? '(' + x.message + ')' : '' }}</li> }
              </ul>
            }
          </div>
          @if (c.run) { <mp-decision-result [result]="c.run" /> }
        }
      }
    </div>
  `,
  styles: `
    .seg { display: inline-flex; }
    .grow { flex: 1; min-width: 180px; }
    .sec { display: grid; grid-template-columns: 110px 1fr 56px; gap: 0.6rem; align-items: center; font-size: 0.82rem; margin-bottom: 0.5rem; }
    .evt-title { margin: 1rem 0 0.4rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .plain { list-style: none; padding: 0; }
  `,
})
export class PortfolioTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);
  protected readonly state = inject(MomentumStateService);

  protected readonly mode = signal<PortfolioMode>('PAPER');
  protected readonly view = signal<PortfolioView | null>(null);
  protected readonly perf = signal<Performance | null>(null);
  protected readonly missing = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  protected readonly change = signal<CapitalChangeResponse | null>(null);
  protected startCapital = 100000;
  protected capitalAmount = 50000;

  protected readonly inr = inr;
  protected readonly num = num;
  protected readonly pctFrac = pctFrac;
  protected readonly pctNum = pctNum;
  protected readonly signedInr = signedInr;
  protected readonly shortDate = shortDate;
  protected readonly dateTime = dateTime;
  protected readonly humanize = humanize;
  protected readonly tone = tone;
  protected readonly moneyFmt = (v: number) => (Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : `₹${v.toFixed(0)}`);

  protected readonly chartValues = computed(() => this.perf()?.equitySeries ?? []);
  protected readonly chartLabels = computed(() => this.chartValues().map((p) => p.date));
  protected readonly chartSeries = computed<ChartSeries[]>(() => [
    { name: 'Portfolio value', color: '#0f9d58', values: this.chartValues().map((p) => p.equity), area: true },
    { name: 'Invested', color: '#2563eb', values: this.chartValues().map((p) => p.invested), dashed: true },
  ]);
  protected readonly sectors = computed(() =>
    Object.entries(this.view()?.sectors ?? {}).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
  );

  ngOnInit(): void {
    void this.load();
  }

  protected setMode(m: PortfolioMode): void {
    this.mode.set(m);
    this.change.set(null);
    void this.load();
  }

  protected async load(): Promise<void> {
    try {
      const [v, p] = await Promise.all([this.api.portfolio(this.mode()), this.api.performance(this.mode())]);
      this.view.set(v);
      this.perf.set(p);
      this.missing.set(false);
      this.error.set('');
    } catch (err) {
      const e = err as { status?: number; error?: { code?: string } };
      this.view.set(null);
      this.perf.set(null);
      if (e?.status === 404 && e.error?.code === 'NO_PORTFOLIO') {
        this.missing.set(true);
        this.error.set('');
      } else {
        this.error.set(errorMessage(err, 'Could not load the portfolio'));
      }
    }
  }

  protected async startPaper(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.initPaper(Number(this.startCapital));
      this.notice.set('Paper portfolio created. Run a decision to see what the engine would buy.');
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async changeCapital(sign: 1 | -1): Promise<void> {
    const amount = Math.abs(Number(this.capitalAmount)) * sign;
    if (!amount) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const r = await this.api.changeCapital(this.mode(), amount);
      this.change.set(r);
      this.notice.set(r.kind === 'DEPOSIT' ? `Added ${inr(amount)}.` : r.message || 'Withdrawal processed.');
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

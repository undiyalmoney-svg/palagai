import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DashboardResponse, MomentumApiService } from '../momentum-api.service';
import { MomentumStateService } from '../momentum-state.service';
import { RegimeCardComponent } from '../shared/regime-card.component';
import { actionTone, errorMessage, inr, num, orderTone, pctFrac, pctNum, shortDate, signedInr, tone } from '../format.util';

@Component({
  selector: 'app-momentum-dashboard-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, RegimeCardComponent],
  template: `
    <div class="mp-page">
      @if (error()) {
        <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div>
      }
      @if (data(); as d) {
        <div class="mp-grid">
          <div class="mp-col-5"><mp-regime-card [regime]="d.regime" [history]="d.regimeHistory" /></div>

          <div class="mp-col-7 mp-stack">
            <div class="mp-card ask">
              <div class="mp-card-head">
                <div>
                  <h3>What should I buy today?</h3>
                  <p class="mp-sub">Tell the engine how much you have. It scans the universe, checks the regime and entry timing, sizes the portfolio and answers BUY, HOLD or WAIT — with reasons.</p>
                </div>
              </div>
              <form class="mp-row" (ngSubmit)="ask()">
                <div class="mp-field grow">
                  <label for="dash-capital">I have (₹)</label>
                  <input id="dash-capital" class="ui-input" type="number" name="capital" min="5000" step="1000" [(ngModel)]="capital" />
                </div>
                <button type="submit" class="ui-btn ui-btn-primary">Ask the engine</button>
              </form>
            </div>

            <div class="mp-stats">
              @if (d.paper; as p) {
                <div class="mp-stat"><span class="mp-stat-label">Paper equity</span><span class="mp-stat-value">{{ inr(p.equity) }}</span><span class="mp-stat-hint">{{ p.positionCount }} position(s)</span></div>
                <div class="mp-stat"><span class="mp-stat-label">Paper cash</span><span class="mp-stat-value">{{ inr(p.cash) }}</span></div>
                <div class="mp-stat"><span class="mp-stat-label">Unrealised P&amp;L</span><span class="mp-stat-value" [class]="'mp-' + tone(p.unrealized)">{{ signedInr(p.unrealized) }}</span></div>
              } @else {
                <div class="mp-stat wide">
                  <span class="mp-stat-label">Paper portfolio</span>
                  <span class="mp-stat-hint">No paper portfolio yet. Start one to follow the engine with simulated money.</span>
                  <a class="ui-btn ui-btn-secondary mp-btn-sm" routerLink="../portfolio">Start paper portfolio</a>
                </div>
              }
              @if (d.live; as l) {
                <div class="mp-stat"><span class="mp-stat-label">Live equity</span><span class="mp-stat-value">{{ inr(l.equity) }}</span><span class="mp-stat-hint">{{ l.positionCount }} position(s)</span></div>
              }
              <div class="mp-stat"><span class="mp-stat-label">Strategy</span><span class="mp-stat-value small">{{ d.strategy.name }}</span><span class="mp-stat-hint">{{ d.horizon.toLowerCase() }} review · as of {{ shortDate(d.asOf) }}</span></div>
            </div>
          </div>
        </div>

        <div class="mp-grid">
          <div class="mp-card mp-col-8">
            <div class="mp-card-head">
              <div><h3>Top ranked momentum stocks</h3><p class="mp-sub">Transparent 0–100 score from momentum, trend, relative strength, volume, volatility and technicals.</p></div>
              <a class="ui-btn ui-btn-secondary mp-btn-sm" routerLink="../screener">Open screener</a>
            </div>
            <div class="mp-table-wrap">
              <table class="mp-table">
                <thead><tr><th>#</th><th>Stock</th><th class="num">Price</th><th class="num">Score</th><th class="num">3M</th><th class="num">RS vs NIFTY</th><th>Entry</th></tr></thead>
                <tbody>
                  @for (r of d.topRanked; track r.symbol) {
                    <tr class="clickable" (click)="openStock(r.symbol)">
                      <td>{{ r.rank }}</td>
                      <td><span class="mp-sym">{{ r.symbol }}</span> @if (r.held) { <span class="mp-badge" data-tone="info">held</span> }<div class="mp-small mp-muted">{{ r.sector }}</div></td>
                      <td class="num">{{ inr(r.price, 2) }}</td>
                      <td class="num"><strong>{{ num(r.score, 1) }}</strong></td>
                      <td class="num" [class]="'mp-' + tone(r.ret.m3)">{{ pctFrac(r.ret.m3, 1, true) }}</td>
                      <td class="num" [class]="'mp-' + tone(r.rsVsIndex3m)">{{ pctFrac(r.rsVsIndex3m, 1, true) }}</td>
                      <td><span class="mp-badge" [attr.data-tone]="badge(r.status)">{{ r.status }}</span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="mp-col-4 mp-stack">
            <div class="mp-card">
              <div class="mp-card-head"><h3>Pending signals</h3><a class="mp-link" routerLink="../decision-center">Decision Center</a></div>
              @if (d.pendingSignals.length) {
                <ul class="mp-list plain">
                  @for (s of d.pendingSignals; track s.id) {
                    <li><span class="mp-badge" [attr.data-tone]="badge(s.action)">{{ s.action }}</span> <strong>{{ s.symbol }}</strong> ×{{ s.quantity }} <span class="mp-muted">@ {{ inr(s.priceRef, 2) }}</span></li>
                  }
                </ul>
              } @else {
                <p class="mp-sub">No signals waiting for you.</p>
              }
            </div>
            <div class="mp-card">
              <div class="mp-card-head"><h3>Recent trades</h3><a class="mp-link" routerLink="../paper-trading">Paper Trading</a></div>
              @if (d.recentTrades.length) {
                <ul class="mp-list plain">
                  @for (t of d.recentTrades; track t.id) {
                    <li><span class="mp-badge" [attr.data-tone]="badge(t.side)">{{ t.side }}</span> <strong>{{ t.symbol }}</strong> ×{{ t.qty }} @ {{ inr(t.price, 2) }}
                      @if (t.pnl != null) { <span [class]="'mp-' + tone(t.pnl)">({{ signedInr(t.pnl) }})</span> }
                    </li>
                  }
                </ul>
              } @else {
                <p class="mp-sub">No trades yet.</p>
              }
            </div>
          </div>
        </div>
      } @else if (!error()) {
        <div class="mp-card mp-empty">Loading dashboard…</div>
      }
    </div>
  `,
  styles: `
    .grow { flex: 1; min-width: 180px; }
    .small { font-size: 0.95rem; }
    .wide { grid-column: span 2; align-items: flex-start; }
    .plain { list-style: none; padding: 0; }
  `,
})
export class DashboardTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);
  private readonly router = inject(Router);
  protected readonly state = inject(MomentumStateService);

  protected readonly data = signal<DashboardResponse | null>(null);
  protected readonly error = signal('');
  protected capital = 100000;

  protected readonly inr = inr;
  protected readonly num = num;
  protected readonly pctFrac = pctFrac;
  protected readonly pctNum = pctNum;
  protected readonly shortDate = shortDate;
  protected readonly signedInr = signedInr;
  protected readonly tone = tone;
  protected readonly orderTone = orderTone;

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.api.dashboard());
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load the dashboard'));
    }
  }

  protected badge(v: string): string {
    return actionTone(v);
  }

  protected ask(): void {
    void this.router.navigate(['/dashboard/momentum/decision-center'], { queryParams: { capital: this.capital, run: 1 } });
  }

  protected openStock(symbol: string): void {
    void this.router.navigate(['/dashboard/momentum/screener'], { queryParams: { symbol } });
  }
}

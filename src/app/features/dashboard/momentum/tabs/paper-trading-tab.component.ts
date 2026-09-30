import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MomentumApiService } from '../momentum-api.service';
import { Performance, PortfolioView } from '../momentum.models';
import { ExecutionPanelComponent } from '../shared/execution-panel.component';
import { errorMessage, inr, pctNum, signedInr, tone } from '../format.util';

@Component({
  selector: 'app-momentum-paper-trading-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, ExecutionPanelComponent],
  template: `
    <div class="mp-page">
      <div class="mp-banner" data-tone="info">
        <div>
          <strong>Paper trading is a full rehearsal of live trading.</strong>
          Same decision engine, same validation pipeline, same idempotent order manager — only the broker is simulated
          (fills at the latest price with slippage and real Zerodha-style costs). Positions change only after a simulated fill.
        </div>
      </div>
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }

      @if (missing()) {
        <div class="mp-card">
          <div class="mp-card-head"><div><h2>Start paper trading</h2><p class="mp-sub">Choose a virtual starting capital.</p></div></div>
          <form class="mp-row" (ngSubmit)="start(false)">
            <div class="mp-field"><label for="pt-cap">Starting capital (₹)</label>
              <input id="pt-cap" class="ui-input" type="number" name="cap" min="10000" step="10000" [(ngModel)]="capital" /></div>
            <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">Start paper portfolio</button>
          </form>
        </div>
      } @else if (view(); as v) {
        <div class="mp-stats">
          <div class="mp-stat"><span class="mp-stat-label">Paper equity</span><span class="mp-stat-value">{{ inr(v.valuation.equity) }}</span><span class="mp-stat-hint">started {{ inr(v.portfolio.initialCapital) }}</span></div>
          <div class="mp-stat"><span class="mp-stat-label">Cash</span><span class="mp-stat-value">{{ inr(v.valuation.cash) }}</span></div>
          <div class="mp-stat"><span class="mp-stat-label">Open positions</span><span class="mp-stat-value">{{ v.positions.length }}</span><span class="mp-stat-hint">{{ pctNum(v.valuation.exposurePct, 1) }} invested</span></div>
          @if (perf(); as p) {
            <div class="mp-stat"><span class="mp-stat-label">Total return</span><span class="mp-stat-value" [class]="'mp-' + tone(p.totalReturnPct)">{{ pctNum(p.totalReturnPct, 2, true) }}</span><span class="mp-stat-hint">{{ signedInr(p.totalPnl) }}</span></div>
          }
        </div>

        <mp-execution-panel mode="PAPER" [refreshKey]="refreshKey()" (changed)="load()" />

        <div class="mp-card">
          <div class="mp-card-head"><div><h3>Reset paper portfolio</h3>
            <p class="mp-sub">Deletes paper positions, orders and trades and starts again with new capital. Stored decision history for the old portfolio is removed with it. Go to <a class="mp-link" routerLink="../decision-center">Decision Center</a> to run a new decision afterwards.</p></div></div>
          <form class="mp-row" (ngSubmit)="start(true)">
            <div class="mp-field"><label for="pt-reset">New starting capital (₹)</label>
              <input id="pt-reset" class="ui-input" type="number" name="reset" min="10000" step="10000" [(ngModel)]="capital" /></div>
            <button type="submit" class="ui-btn ui-btn-danger" [disabled]="busy()">Reset paper portfolio</button>
          </form>
        </div>
      }
    </div>
  `,
})
export class PaperTradingTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);

  protected readonly view = signal<PortfolioView | null>(null);
  protected readonly perf = signal<Performance | null>(null);
  protected readonly missing = signal(false);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly refreshKey = signal(0);
  protected capital = 100000;

  protected readonly inr = inr;
  protected readonly pctNum = pctNum;
  protected readonly signedInr = signedInr;
  protected readonly tone = tone;

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    try {
      const [v, p] = await Promise.all([this.api.portfolio('PAPER'), this.api.performance('PAPER')]);
      this.view.set(v);
      this.perf.set(p);
      this.missing.set(false);
      this.error.set('');
    } catch (err) {
      const e = err as { status?: number; error?: { code?: string } };
      this.view.set(null);
      if (e?.status === 404 && e.error?.code === 'NO_PORTFOLIO') {
        this.missing.set(true);
        this.error.set('');
      } else {
        this.error.set(errorMessage(err, 'Could not load the paper portfolio'));
      }
    }
  }

  protected async start(reset: boolean): Promise<void> {
    if (reset && typeof confirm === 'function' && !confirm('Reset the paper portfolio? All paper positions, orders and trades will be deleted.')) return;
    this.busy.set(true);
    try {
      await this.api.initPaper(Number(this.capital), reset);
      await this.load();
      this.refreshKey.update((k) => k + 1);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

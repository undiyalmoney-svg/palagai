import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MomentumApiService } from '../momentum-api.service';
import { MomentumStateService } from '../momentum-state.service';
import { PortfolioView } from '../momentum.models';
import { ExecutionPanelComponent } from '../shared/execution-panel.component';
import { dateTime, errorMessage, inr, signedInr } from '../format.util';

/** Only routable while a broker session is configured (see `liveTradingGuard`). */
@Component({
  selector: 'app-momentum-live-trading-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, ExecutionPanelComponent],
  template: `
    <div class="mp-page">
      <div class="mp-banner" data-tone="warn">
        <div>
          <strong>Live trading places real orders with your broker.</strong>
          Every order passes the validation pipeline (market hours, funds, risk limits, duplicates, price sanity).
          An order is treated as open until the broker reports a fill — it is never assumed filled. Automated execution is off until you turn it on.
        </div>
      </div>
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="mp-banner" data-tone="up" role="status">{{ notice() }}</div> }

      <div class="mp-card">
        <div class="mp-card-head">
          <div><h2>Broker</h2>
            <p class="mp-sub">
              Session key {{ state.status()?.broker?.apiKey || '—' }}@if (state.status()?.broker?.updatedAt) { , updated {{ dateTime(state.status()?.broker?.updatedAt) }} }.
              Kite sessions expire daily — refresh from <a class="mp-link" routerLink="/dashboard/get-token">Get Token</a>.
            </p></div>
          <span class="mp-badge" [attr.data-tone]="liveEnabled() ? 'up' : 'muted'">{{ liveEnabled() ? 'Live enabled' : 'Live disabled' }}</span>
        </div>

        @if (funds(); as f) {
          <div class="mp-stats">
            <div class="mp-stat"><span class="mp-stat-label">Available equity cash</span><span class="mp-stat-value">{{ inr(f.equityCash ?? 0) }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Net equity balance</span><span class="mp-stat-value">{{ inr(f.equityNet ?? 0) }}</span></div>
          </div>
        } @else if (fundsError()) {
          <p class="mp-sub">Funds unavailable: {{ fundsError() }}</p>
        }

        @if (!liveEnabled()) {
          <div class="mp-row enable">
            <div class="mp-field grow"><label for="lv-phrase">Type “{{ livePhrase() }}” to enable</label>
              <input id="lv-phrase" class="ui-input" name="phrase" [ngModel]="phrase()" (ngModelChange)="phrase.set($event)" autocomplete="off" /></div>
            <button type="button" class="ui-btn ui-btn-primary" [disabled]="busy() || phrase().trim() !== livePhrase()" (click)="enable()">Enable live trading</button>
          </div>
        } @else {
          <div class="mp-row enable">
            <button type="button" class="ui-btn ui-btn-secondary" [disabled]="busy()" (click)="syncFunds()">Sync cash with broker funds</button>
            <button type="button" class="ui-btn ui-btn-secondary" [disabled]="busy()" (click)="importHoldings()">Import broker holdings</button>
            <button type="button" class="ui-btn ui-btn-danger" [disabled]="busy()" (click)="disable()">Disable live trading</button>
          </div>
        }
      </div>

      @if (liveEnabled()) {
        @if (view(); as v) {
          <div class="mp-stats">
            <div class="mp-stat"><span class="mp-stat-label">Live equity</span><span class="mp-stat-value">{{ inr(v.valuation.equity) }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Cash</span><span class="mp-stat-value">{{ inr(v.valuation.cash) }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Unrealised P&amp;L</span><span class="mp-stat-value">{{ signedInr(v.valuation.unrealized) }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Positions</span><span class="mp-stat-value">{{ v.positions.length }}</span></div>
          </div>
        }
        <mp-execution-panel mode="LIVE" [refreshKey]="refreshKey()" (changed)="load()" />
      } @else {
        <div class="mp-card mp-empty">Live trading is disabled. Paper trade first to see how the engine behaves, then enable live trading here.</div>
      }
    </div>
  `,
  styles: `
    .enable { margin-top: 0.85rem; align-items: flex-end; }
    .grow { flex: 1; min-width: 220px; }
  `,
})
export class LiveTradingTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);
  protected readonly state = inject(MomentumStateService);

  protected readonly view = signal<PortfolioView | null>(null);
  protected readonly funds = signal<{ equityCash?: number; equityNet?: number } | null>(null);
  protected readonly fundsError = signal('');
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  protected readonly phrase = signal('');
  protected readonly refreshKey = signal(0);

  protected readonly liveEnabled = computed(() => !!this.state.status()?.broker.liveEnabled);
  protected readonly livePhrase = computed(() => this.state.status()?.phrases.live ?? 'ENABLE LIVE TRADING');

  protected readonly inr = inr;
  protected readonly signedInr = signedInr;
  protected readonly dateTime = dateTime;

  ngOnInit(): void {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    await this.state.refreshStatus();
    await this.loadFunds();
    await this.load();
  }

  private async loadFunds(): Promise<void> {
    try {
      this.funds.set(await this.api.brokerFunds());
      this.fundsError.set('');
    } catch (err) {
      this.funds.set(null);
      this.fundsError.set(errorMessage(err, 'Could not read broker funds'));
    }
  }

  protected async load(): Promise<void> {
    if (!this.liveEnabled()) {
      this.view.set(null);
      return;
    }
    try {
      this.view.set(await this.api.portfolio('LIVE'));
    } catch {
      this.view.set(null);
    }
  }

  private async act(fn: () => Promise<string>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      this.notice.set(await fn());
      await this.refresh();
      this.refreshKey.update((k) => k + 1);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected enable(): Promise<void> {
    return this.act(async () => {
      const r = await this.api.enableLive(this.phrase().trim());
      this.phrase.set('');
      const n = r.holdings?.imported?.length ?? 0;
      const skip = r.holdings?.skipped?.length ?? 0;
      const extra = n || skip ? ` Imported ${n} holding(s)` + (skip ? `, skipped ${skip} outside the universe.` : '.') : '';
      return 'Live trading enabled. Automated execution remains OFF until you enable it below.' + extra;
    });
  }

  protected disable(): Promise<void> {
    return this.act(async () => {
      await this.api.disableLive();
      return 'Live trading disabled and automated execution turned off.';
    });
  }

  protected syncFunds(): Promise<void> {
    return this.act(async () => {
      const r = await this.api.syncFunds();
      return `Live cash synced to ${inr(r.cash)}.`;
    });
  }

  protected importHoldings(): Promise<void> {
    return this.act(async () => {
      const r = await this.api.importHoldings();
      const skip = r.skipped.length ? ` Skipped ${r.skipped.length} name(s) outside the universe.` : '';
      return `Holdings sync: ${r.imported.length} new, ${r.updated.length} updated, ${r.removed.length} removed. Cash ${inr(r.cash)}.${skip}`;
    });
  }
}

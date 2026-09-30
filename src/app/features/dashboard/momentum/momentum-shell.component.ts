import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MomentumStateService } from './momentum-state.service';

interface Tab {
  label: string;
  path: string;
  liveOnly?: boolean;
}

const TABS: Tab[] = [
  { label: 'Dashboard', path: 'dashboard' },
  { label: 'Momentum Screener', path: 'screener' },
  { label: 'Portfolio', path: 'portfolio' },
  { label: 'Decision Center', path: 'decision-center' },
  { label: 'Backtest', path: 'backtest' },
  { label: 'Strategy Lab', path: 'strategy-lab' },
  { label: 'Paper Trading', path: 'paper-trading' },
  { label: 'Live Trading', path: 'live-trading', liveOnly: true },
  { label: 'Settings', path: 'settings' },
];

@Component({
  selector: 'app-momentum-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="mp-page">
      @if (state.simulated()) {
        <div class="mp-banner" data-tone="warn" role="status">
          <strong>Simulated market data.</strong>
          <span>{{ state.status()?.provider?.simulatedNotice }} Connect a broker data provider on the server to use real prices.</span>
        </div>
      }
      @if (state.statusError(); as err) {
        <div class="mp-banner" data-tone="down" role="alert">
          <strong>Momentum service unavailable.</strong> <span>{{ err }}</span>
          <button type="button" class="mp-link" (click)="state.refreshStatus()">Retry</button>
        </div>
      }
      <nav class="mp-tabs" aria-label="Momentum sections">
        @for (t of tabs(); track t.path) {
          <a class="mp-tab" [routerLink]="t.path" routerLinkActive="active">{{ t.label }}</a>
        }
        <span class="mp-spacer"></span>
        @if (state.status(); as s) {
          <span class="meta mp-small mp-muted">
            <span class="dot" [class.open]="s.market.open"></span>
            {{ s.market.open ? 'Market open' : s.market.reason }} · data to {{ s.data.last }} · {{ s.strategy.name }}
          </span>
        }
      </nav>
      <router-outlet />
    </div>
  `,
  styles: `
    :host { display: block; }
    .meta { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0 0.6rem; white-space: nowrap; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pg-muted); }
    .dot.open { background: var(--pg-bull); box-shadow: 0 0 0 3px var(--pg-bull-glow); }
  `,
})
export class MomentumShellComponent implements OnInit {
  protected readonly state = inject(MomentumStateService);
  protected readonly tabs = computed(() => TABS.filter((t) => !t.liveOnly || this.state.liveAvailable()));

  ngOnInit(): void {
    void this.state.refreshStatus();
  }
}

import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MomentumStateService } from './momentum-state.service';

export interface Tab {
  label: string;
  path: string;
  liveOnly?: boolean;
}

export const MOMENTUM_TABS: Tab[] = [
  { label: 'Paper', path: 'paper' },
  { label: 'Live', path: 'live' },
  { label: 'Settings', path: 'settings' },
];

export function visibleMomentumTabs(_liveAvailable: boolean): Tab[] {
  return MOMENTUM_TABS;
}

@Component({
  selector: 'app-momentum-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="mp-page">
      @if (state.simulated()) {
        <div class="mp-banner" data-tone="warn" role="status">
          <strong>Simulated prices.</strong>
          <span>{{ state.status()?.provider?.simulatedNotice }}</span>
        </div>
      }
      @if (state.statusError(); as err) {
        <div class="mp-banner" data-tone="down" role="alert">
          <strong>Momentum service unavailable.</strong> <span>{{ err }}</span>
          <button type="button" class="mp-link" (click)="state.refreshStatus()">Retry</button>
        </div>
      }
      <nav class="mp-tabs" aria-label="Momentum sections">
        @for (t of tabs; track t.path) {
          <a class="mp-tab" [routerLink]="t.path" routerLinkActive="active">{{ t.label }}</a>
        }
        <span class="mp-spacer"></span>
        @if (state.status(); as s) {
          <span class="meta mp-small mp-muted">
            <span class="dot" [class.open]="s.market.open"></span>
            {{ s.market.open ? 'Market open' : s.market.reason }}
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
  protected readonly tabs = MOMENTUM_TABS;

  ngOnInit(): void {
    void this.state.refreshStatus();
  }
}

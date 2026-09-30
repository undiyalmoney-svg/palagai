import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RegimeHistoryRow, RegimeReading } from '../momentum.models';
import { pctFrac, regimeLabel, regimeTone } from '../format.util';

@Component({
  selector: 'mp-regime-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = regime();
    <div class="mp-card">
      <div class="mp-card-head">
        <div>
          <h3>Market regime</h3>
          <p class="mp-sub">Computed from NIFTY trend, breadth, momentum and volatility.</p>
        </div>
        <span class="mp-badge big" [attr.data-tone]="regimeTone(r.regime)">{{ regimeLabel(r.regime) }} · {{ r.score }}/100</span>
      </div>
      <ul class="mp-list">
        @for (x of r.reasons; track x) { <li>{{ x }}</li> }
      </ul>
      <dl class="mp-kv policy">
        <dt>Positions</dt><dd>{{ pctFrac(r.policy.positionsMult, 0) }} of normal size</dd>
        <dt>Cash reserve</dt><dd>at least {{ pctFrac(r.policy.minCashPct, 0) }}</dd>
        <dt>New buys</dt><dd>{{ r.policy.allowNewBuys ? 'Allowed (minimum entry ' + r.policy.minEntryStatus + ')' : 'Paused' }}</dd>
        <dt>Position size</dt><dd>× {{ r.policy.sizeMult }}</dd>
        <dt>Trailing stop</dt><dd>× {{ r.policy.trailMult }}</dd>
      </dl>
      @if (history().length > 1) {
        <div class="strip" aria-label="Regime history">
          @for (h of history(); track h.date) {
            <span [attr.data-tone]="regimeTone(h.regime)" [title]="h.date + ' · ' + regimeLabel(h.regime) + ' ' + h.score"></span>
          }
        </div>
        <div class="mp-small mp-muted">Recent regime readings (oldest → latest)</div>
      }
    </div>
  `,
  styles: `
    .big { font-size: 0.8rem; padding: 0.3rem 0.8rem; }
    .policy { margin-top: 0.75rem; }
    .strip { display: flex; gap: 2px; margin: 0.9rem 0 0.3rem; height: 14px; }
    .strip span { flex: 1; border-radius: 2px; background: var(--pg-info); opacity: 0.75; }
    .strip span[data-tone='up'] { background: var(--pg-bull); }
    .strip span[data-tone='down'] { background: var(--pg-bear); }
    .strip span[data-tone='warn'] { background: var(--pg-warn); }
  `,
})
export class RegimeCardComponent {
  readonly regime = input.required<RegimeReading>();
  readonly history = input<RegimeHistoryRow[]>([]);
  protected readonly regimeTone = regimeTone;
  protected readonly regimeLabel = regimeLabel;
  protected readonly pctFrac = pctFrac;
}

import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Decision, DecisionResult } from '../momentum.models';
import { actionTone, humanize, inr, num, pctFrac, regimeLabel, regimeTone } from '../format.util';
import { DecisionDetailComponent } from './decision-detail.component';

const ORDER: Record<string, number> = { EXIT: 0, SELL: 1, REDUCE: 2, BUY: 3, ADD: 3, HOLD: 4, WAIT: 5 };

/**
 * Renders a decision run: headline, regime, portfolio size, allocation and the
 * "What should I do now?" table with the full reasoning behind every row.
 */
@Component({
  selector: 'mp-decision-result',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecisionDetailComponent],
  template: `
    @let r = result();
    <div class="mp-stack">
      <div class="mp-card">
        <div class="mp-row">
          <span class="mp-badge" [attr.data-tone]="tone(r.answer)">{{ r.answer }}</span>
          <h3 class="mp-answer">{{ r.headline }}</h3>
        </div>
        <p class="mp-sub">
          As of {{ r.asOf }} close
          @if (r.strategy) { · {{ r.strategy.name }} }
          @if (r.hypothetical) { · hypothetical — nothing is stored or ordered }
          @if (r.review) { · full review day }
        </p>
        <div class="mp-callout summary">
          @for (line of r.summary.lines; track $index) {
            <div>{{ line }}</div>
          }
        </div>
        @if (r.triggers.length) {
          <div class="mp-row triggers">
            <span class="mp-small mp-muted">Triggers</span>
            @for (t of r.triggers; track t.type) {
              <span class="mp-badge" data-tone="info" [title]="t.detail">{{ label(t.type) }}</span>
            }
          </div>
        }
      </div>

      <div class="mp-grid">
        <div class="mp-card mp-col-4">
          <div class="mp-card-head"><h3>Market regime</h3>
            <span class="mp-badge" [attr.data-tone]="regimeTone(r.regime.regime)">{{ regimeLabel(r.regime.regime) }} · {{ r.regime.score }}</span>
          </div>
          <ul class="mp-list">
            @for (x of r.regime.reasons; track x) { <li>{{ x }}</li> }
          </ul>
          <p class="mp-sub">
            Policy: up to {{ pctFrac(r.regime.policy.positionsMult, 0) }} of normal positions, cash reserve ≥
            {{ pctFrac(r.regime.policy.minCashPct, 0) }}, new buys {{ r.regime.policy.allowNewBuys ? 'allowed' : 'paused' }}.
          </p>
        </div>
        <div class="mp-card mp-col-4">
          <div class="mp-card-head"><h3>Recommended portfolio size</h3><span class="mp-badge" data-tone="strong">{{ r.portfolioSize.n }} stocks</span></div>
          <p class="mp-sub">{{ r.portfolioSize.explanation }}</p>
          <details>
            <summary class="mp-small">Every constraint considered</summary>
            <ul class="mp-checks cons">
              @for (c of r.portfolioSize.constraints; track c.id) {
                <li>
                  <span [class]="c.binding ? 'bad' : 'ok'">{{ c.binding ? '●' : '○' }}</span>
                  <span><strong>{{ c.label }}: {{ c.value }}</strong> <span class="mp-muted">— {{ c.detail }}</span></span>
                </li>
              }
            </ul>
          </details>
        </div>
        <div class="mp-card mp-col-4">
          <div class="mp-card-head"><h3>Capital</h3><span class="mp-badge">{{ humanize(r.allocation.option) }}</span></div>
          <dl class="mp-kv">
            <dt>Portfolio value</dt><dd>{{ inr(r.capital.equity) }}</dd>
            <dt>Cash</dt><dd>{{ inr(r.capital.cash) }}</dd>
            <dt>Invested</dt><dd>{{ inr(r.capital.invested) }}</dd>
            <dt>Cash reserve</dt><dd>{{ inr(r.capital.reserve) }} ({{ pctFrac(r.capital.reservePct, 0) }})</dd>
            <dt>Deployable</dt><dd>{{ inr(r.capital.deployable) }}</dd>
            @if (r.capital.capitalEvent) {
              <dt>Capital change</dt><dd>{{ inr(r.capital.capitalEvent.amount) }}</dd>
            }
          </dl>
          <p class="mp-sub"><strong>{{ r.allocation.label }}.</strong> {{ r.allocation.explanation }}</p>
          @for (n of r.allocation.notes; track n) { <p class="mp-sub">{{ n }}</p> }
        </div>
      </div>

      <div class="mp-card">
        <div class="mp-card-head">
          <div>
            <h3>What should I do now?</h3>
            <p class="mp-sub">{{ r.summary.counts.buy }} buy · {{ r.summary.counts.sell + r.summary.counts.reduce }} sell/reduce · {{ r.summary.counts.hold }} hold · {{ r.summary.counts.wait }} wait. Select a row for the full reasoning.</p>
          </div>
          <div class="mp-row">
            <label class="ui-check"><input type="checkbox" [checked]="showWait()" (change)="showWait.set(!showWait())" /> Show WAIT rows</label>
            @if (executableCount() > 0) {
              <button type="button" class="ui-btn ui-btn-primary mp-btn-sm" [disabled]="busy()" (click)="executeAll.emit()">
                Execute {{ executableCount() }} order{{ executableCount() === 1 ? '' : 's' }}
              </button>
            }
          </div>
        </div>
        <div class="mp-table-wrap">
          <table class="mp-table">
            <thead>
              <tr>
                <th>Stock</th><th>Action</th><th class="num">Qty</th><th class="num">Price</th>
                <th class="num">Allocation</th><th class="num">Score</th><th>Reason</th><th></th>
              </tr>
            </thead>
            <tbody>
              @for (d of rows(); track d.decisionKey) {
                <tr class="clickable" (click)="toggle(d.decisionKey)">
                  <td><div class="mp-sym">{{ d.symbol }}</div><div class="mp-small mp-muted">{{ d.sector }}</div></td>
                  <td>
                    <span class="mp-badge" [attr.data-tone]="tone(d.action)">{{ d.action }}</span>
                    @if (d.timing && d.timing !== d.action && d.timing !== 'BUY_NOW') {
                      <div class="mp-small mp-muted">{{ label(d.timing) }}</div>
                    }
                  </td>
                  <td class="num">{{ d.quantity || '—' }}</td>
                  <td class="num">{{ inr(d.priceRef, 2) }}</td>
                  <td class="num">
                    @if (d.allocationValue) { {{ inr(d.allocationValue) }}<div class="mp-small mp-muted">{{ pctFrac(d.allocationPct, 1) }}</div> } @else { — }
                  </td>
                  <td class="num">{{ num(d.score, 1) }}</td>
                  <td class="reason">{{ d.reason }}</td>
                  <td class="num">
                    @if (signalFor(d); as sid) {
                      <button type="button" class="ui-btn ui-btn-secondary mp-btn-sm" [disabled]="busy()" (click)="executeOne.emit(sid); $event.stopPropagation()">Execute</button>
                    }
                  </td>
                </tr>
                @if (open() === d.decisionKey) {
                  <tr class="detail"><td colspan="8"><mp-decision-detail [decision]="d" /></td></tr>
                }
              } @empty {
                <tr><td colspan="8" class="mp-empty">No decisions to show.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: `
    .summary { margin-top: 0.75rem; display: flex; flex-direction: column; gap: 0.3rem; }
    .triggers { margin-top: 0.6rem; }
    .reason { max-width: 420px; font-size: 0.8rem; line-height: 1.4; }
    .cons { margin-top: 0.5rem; }
    summary { cursor: pointer; color: var(--pg-info); font-weight: 600; }
  `,
})
export class DecisionResultComponent {
  readonly result = input.required<DecisionResult>();
  /** decisionKey -> signal id for decisions that can be executed. */
  readonly signalIds = input<Record<string, number>>({});
  readonly busy = input(false);
  readonly executeOne = output<number>();
  readonly executeAll = output<void>();

  protected readonly open = signal<string | null>(null);
  protected readonly showWait = signal(false);

  protected readonly inr = inr;
  protected readonly num = num;
  protected readonly pctFrac = pctFrac;
  protected readonly humanize = humanize;
  protected readonly regimeLabel = regimeLabel;
  protected readonly regimeTone = regimeTone;
  protected readonly tone = actionTone;
  protected label = (v: string) => humanize(v);

  protected readonly rows = computed<Decision[]>(() => {
    const list = this.result().decisions.filter((d) => this.showWait() || d.action !== 'WAIT');
    return [...list].sort((a, b) => (ORDER[a.action] ?? 9) - (ORDER[b.action] ?? 9));
  });

  protected readonly executableCount = computed(
    () => this.result().decisions.filter((d) => this.signalFor(d) != null).length,
  );

  protected signalFor(d: Decision): number | null {
    if (!['BUY', 'SELL', 'EXIT', 'REDUCE'].includes(d.action)) return null;
    return this.signalIds()[d.decisionKey] ?? null;
  }

  protected toggle(key: string): void {
    this.open.update((v) => (v === key ? null : key));
  }
}

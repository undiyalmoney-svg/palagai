import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Decision } from '../momentum.models';
import { inr, pctFrac } from '../format.util';

/** Full "why" behind one decision, exactly as stored by the engine. */
@Component({
  selector: 'mp-decision-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = decision();
    @let e = d.explanation;
    <div class="detail">
      @if (d.action === 'BUY') {
        <div class="cols">
          <dl class="mp-kv">
            <dt>Why buy</dt><dd>{{ e?.whyBuy }}</dd>
            <dt>Why now</dt><dd>{{ e?.whyNow }}</dd>
            <dt>Why this stock</dt><dd>{{ e?.whyThisStock }}</dd>
            <dt>Why this price</dt><dd>{{ e?.whyThisPrice }}</dd>
            <dt>How much</dt><dd>{{ e?.howMuch }}</dd>
            <dt>How many shares</dt><dd>{{ e?.howManyShares }}</dd>
            <dt>Holding period</dt><dd>{{ e?.expectedHolding }}</dd>
            <dt>Risk</dt><dd>{{ e?.risk }}</dd>
          </dl>
          <div class="mp-stack">
            @if (e?.confirms?.length) {
              <div>
                <strong class="h">What confirms the trade</strong>
                <ul class="mp-list">
                  @for (c of e?.confirms; track c) { <li>{{ c }}</li> }
                </ul>
              </div>
            }
            @if (e?.invalidates?.length) {
              <div>
                <strong class="h">What invalidates it</strong>
                <ul class="mp-list">
                  @for (c of e?.invalidates; track c) { <li>{{ c }}</li> }
                </ul>
              </div>
            }
          </div>
        </div>
      } @else if (d.action === 'WAIT') {
        <p class="lead">{{ e?.headline || d.reason }}</p>
        @if (d.waitFor.length) {
          <strong class="h">Wait for</strong>
          <ul class="mp-list">
            @for (w of d.waitFor; track w) { <li>{{ w }}</li> }
          </ul>
        }
        @if (e?.note) { <p class="mp-muted">{{ e?.note }}</p> }
      } @else {
        <p class="lead">{{ e?.headline || d.reason }}</p>
        @if (e?.whySell || e?.whyHold) { <p>{{ e?.whySell || e?.whyHold }}</p> }
        @if (e?.result) { <p class="mp-muted">{{ e?.result }}</p> }
        @if (e?.thesis?.length) {
          <strong class="h">Thesis check</strong>
          <ul class="mp-checks">
            @for (t of e?.thesis; track t) {
              <li>
                <span [class]="t.startsWith('OK') ? 'ok' : 'bad'">{{ t.startsWith('OK') ? '✓' : '✕' }}</span>
                <span>{{ t.replace(/^(OK|FAILED) - /, '') }}</span>
              </li>
            }
          </ul>
        }
        @if (e?.warnings?.length) {
          <ul class="mp-list">
            @for (w of e?.warnings; track w) { <li>{{ w }}</li> }
          </ul>
        }
        @if (e?.nextStep) { <p class="mp-muted">{{ e?.nextStep }}</p> }
      }

      @if (d.risk?.stopPrice) {
        <div class="mp-stats plan">
          <div class="mp-stat"><span class="mp-stat-label">Protective stop</span><span class="mp-stat-value">{{ inr(d.risk?.stopPrice, 2) }}</span></div>
          @if (d.risk?.target) {
            <div class="mp-stat"><span class="mp-stat-label">Target</span><span class="mp-stat-value">{{ inr(d.risk?.target, 2) }}</span></div>
          }
          @if (d.risk?.rewardRisk) {
            <div class="mp-stat"><span class="mp-stat-label">Reward / risk</span><span class="mp-stat-value">{{ d.risk?.rewardRisk }}</span></div>
          }
          @if (d.risk?.riskAmount) {
            <div class="mp-stat"><span class="mp-stat-label">Risk if stopped</span><span class="mp-stat-value">{{ inr(d.risk?.riskAmount) }}</span><span class="mp-stat-hint">{{ pct(d.risk?.riskPctOfPortfolio) }} of portfolio</span></div>
          }
        </div>
      }

      @if (d.checks.length) {
        <details class="checks">
          <summary>Rule checks ({{ passCount() }}/{{ d.checks.length }} passed)</summary>
          <ul class="mp-checks">
            @for (c of d.checks; track c.id) {
              <li>
                <span [class]="c.pass ? 'ok' : c.critical ? 'bad' : 'soft'">{{ c.pass ? '✓' : c.critical ? '✕' : '!' }}</span>
                <span><strong>{{ c.label }}</strong> — <span class="mp-muted">{{ c.detail }}</span></span>
              </li>
            }
          </ul>
        </details>
      }
      <div class="foot mp-small mp-muted">
        Strategy {{ d.strategy }} · trigger {{ d.trigger || '—' }} · decided {{ d.asOf }} · key {{ d.decisionKey }}
      </div>
    </div>
  `,
  styles: `
    .detail { display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.84rem; line-height: 1.5; }
    .cols { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 1.25rem; }
    @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
    .h { display: block; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--pg-muted); margin-bottom: 0.3rem; }
    .lead { margin: 0; font-weight: 650; }
    p { margin: 0; }
    .plan { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
    .checks summary { cursor: pointer; font-weight: 650; margin-bottom: 0.5rem; }
    .foot { word-break: break-all; }
  `,
})
export class DecisionDetailComponent {
  readonly decision = input.required<Decision>();
  protected readonly inr = inr;
  protected pct = (v: number | undefined) => pctFrac(v, 2);
  protected passCount = () => this.decision().checks.filter((c) => c.pass).length;
}

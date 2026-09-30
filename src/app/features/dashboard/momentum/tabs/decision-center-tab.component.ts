import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MomentumApiService } from '../momentum-api.service';
import { MomentumStateService } from '../momentum-state.service';
import { DecisionResult, DecisionRunRow, ExecutionOutcome, NarratorAnswer, PortfolioMode } from '../momentum.models';
import { DecisionResultComponent } from '../shared/decision-result.component';
import { actionTone, dateTime, errorMessage, humanize } from '../format.util';

/** Stored runs keep the raw engine shape; the live endpoints add answer/headline on top. */
function normalize(raw: DecisionResult): DecisionResult {
  return { ...raw, answer: raw.answer ?? raw.summary?.answer, headline: raw.headline ?? raw.summary?.headline, triggers: raw.triggers ?? [] };
}

@Component({
  selector: 'app-momentum-decision-center-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DecisionResultComponent],
  template: `
    <div class="mp-page">
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }
      @if (execution(); as ex) {
        <div class="mp-banner" data-tone="info" role="status">
          <div>
            <strong>{{ ex.auto ? 'Automated execution ran:' : 'Execution:' }}</strong>
            @for (r of ex.results; track r.signalId) {
              <div>{{ r.action }} {{ r.symbol }} — {{ humanize(r.status) }}{{ r.message ? ' · ' + r.message : '' }}</div>
            } @empty { <div>Nothing needed to be sent.</div> }
          </div>
        </div>
      }

      <div class="mp-grid">
        <div class="mp-card mp-col-6">
          <div class="mp-card-head"><div><h2>“I have ₹… What should I buy today?”</h2>
            <p class="mp-sub">A hypothetical answer for fresh capital. Nothing is stored and no order is created.</p></div></div>
          <form class="mp-row" (ngSubmit)="advise()">
            <div class="mp-field grow"><label for="dc-cap">Capital (₹)</label><input id="dc-cap" class="ui-input" type="number" name="cap" min="5000" step="5000" [(ngModel)]="capital" /></div>
            <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">Ask</button>
          </form>
        </div>
        <div class="mp-card mp-col-6">
          <div class="mp-card-head"><div><h2>My portfolio: “What should I do now?”</h2>
            <p class="mp-sub">Evaluates every holding (continue holding? sell?) and every candidate against your actual cash and positions.</p></div></div>
          @if (portfolioMissing()) {
            <p class="mp-sub">No {{ mode().toLowerCase() }} portfolio yet. <a class="mp-link" routerLink="../portfolio">Start one</a> to get portfolio decisions.</p>
          } @else {
            <div class="mp-row">
              @if (state.liveAvailable()) {
                <select class="ui-select mode" [ngModel]="mode()" (ngModelChange)="setMode($event)" aria-label="Portfolio">
                  <option value="PAPER">Paper</option><option value="LIVE">Live</option>
                </select>
              }
              <button type="button" class="ui-btn ui-btn-secondary" [disabled]="busy()" (click)="preview()">Preview</button>
              <button type="button" class="ui-btn ui-btn-primary" [disabled]="busy()" (click)="run()">Run &amp; save decision</button>
              <label class="ui-check"><input type="checkbox" [ngModel]="force()" (ngModelChange)="force.set($event)" /> Force full review</label>
            </div>
            <p class="mp-sub">A saved run stores the complete reasoning, so you can ask “why did the system buy this?” weeks later.</p>
          }
        </div>
      </div>

      @if (busy() && !result()) { <div class="mp-card mp-empty">Running the decision engine…</div> }
      @if (result(); as r) {
        <mp-decision-result [result]="r" [signalIds]="signalIds()" [busy]="busy()" (executeOne)="executeOne($event)" (executeAll)="executeAll()" />
      }

      <div class="mp-grid">
        <div class="mp-card mp-col-6">
          <div class="mp-card-head"><div><h3>Ask about a decision</h3>
            <p class="mp-sub">The assistant only explains decisions the engine already stored. It cannot create or change trades.</p></div></div>
          <form class="mp-row" (ngSubmit)="ask()">
            <div class="mp-field grow"><label for="dc-q">Question</label><input id="dc-q" class="ui-input" name="q" [(ngModel)]="question" placeholder="Why did you buy …?" /></div>
            <button type="submit" class="ui-btn ui-btn-secondary" [disabled]="busy()">Ask</button>
          </form>
          <div class="mp-row chips">
            @for (q of suggestions(); track q) { <button type="button" class="mp-badge chip" (click)="question = q; ask()">{{ q }}</button> }
          </div>
          @if (answer(); as a) {
            <div class="mp-callout ans">{{ a.answer }}</div>
            <p class="mp-small mp-muted">Source: {{ a.source }} @if (a.evidence.length) { · evidence: {{ a.evidence.join(', ') }} }</p>
          }
        </div>
        <div class="mp-card mp-col-6">
          <div class="mp-card-head"><h3>Decision history</h3></div>
          <div class="mp-table-wrap">
            <table class="mp-table">
              <thead><tr><th>As of</th><th>Type</th><th>Answer</th><th>Regime</th><th></th></tr></thead>
              <tbody>
                @for (h of history(); track h.id) {
                  <tr class="clickable" (click)="openRun(h.id)">
                    <td>{{ h.asOf }}<div class="mp-small mp-muted">{{ dateTime(h.createdAt) }}</div></td>
                    <td>{{ humanize(h.kind) }}</td>
                    <td><span class="mp-badge" [attr.data-tone]="tone(h.answer)">{{ h.answer }}</span> <span class="mp-small mp-muted">{{ h.summary.headline }}</span></td>
                    <td>{{ humanize(h.regime) }}</td>
                    <td class="num"><span class="mp-link">Open</span></td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="mp-empty">No saved decisions yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .grow { flex: 1; min-width: 180px; }
    .mode { width: 110px; min-height: 40px; }
    .chips { margin-top: 0.6rem; }
    .chip { cursor: pointer; border: 1px solid var(--pg-line); background: #fff; font-weight: 600; }
    .chip:hover { background: var(--pg-bg-muted); }
    .ans { margin-top: 0.75rem; white-space: pre-wrap; }
  `,
})
export class DecisionCenterTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly state = inject(MomentumStateService);

  protected readonly mode = signal<PortfolioMode>('PAPER');
  protected readonly result = signal<DecisionResult | null>(null);
  protected readonly signalIds = signal<Record<string, number>>({});
  protected readonly execution = signal<ExecutionOutcome | null>(null);
  protected readonly history = signal<DecisionRunRow[]>([]);
  protected readonly answer = signal<NarratorAnswer | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly portfolioMissing = signal(false);
  protected readonly force = signal(false);
  protected capital = 100000;
  protected question = '';

  protected readonly humanize = humanize;
  protected readonly dateTime = dateTime;
  protected readonly tone = actionTone;

  protected readonly suggestions = computed(() => {
    const buy = this.result()?.decisions.find((d) => d.action === 'BUY')?.symbol;
    return [
      'What should I do today?',
      buy ? `Why did you buy ${buy}?` : 'Why did the system buy this stock?',
      'Why did you sell?',
      'How am I performing?',
      'What is the market regime?',
    ];
  });

  async ngOnInit(): Promise<void> {
    const q = this.route.snapshot.queryParamMap;
    const cap = Number(q.get('capital'));
    if (cap > 0) this.capital = cap;
    await this.loadHistory();
    if (q.get('run') && cap > 0) await this.advise();
  }

  protected setMode(m: PortfolioMode): void {
    this.mode.set(m);
    this.result.set(null);
    void this.loadHistory();
  }

  private async guard(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.execution.set(null);
    try {
      await fn();
    } catch (err) {
      const e = err as { status?: number; error?: { code?: string } };
      if (e?.status === 404 && e.error?.code === 'NO_PORTFOLIO') this.portfolioMissing.set(true);
      else this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected advise(): Promise<void> {
    return this.guard(async () => {
      this.signalIds.set({});
      this.result.set(normalize(await this.api.advice({ capital: Number(this.capital) })));
    });
  }

  protected preview(): Promise<void> {
    return this.guard(async () => {
      this.signalIds.set({});
      this.result.set(normalize(await this.api.decisionPreview(this.mode())));
    });
  }

  protected run(): Promise<void> {
    return this.guard(async () => {
      const r = await this.api.runDecision(this.mode(), this.force());
      this.result.set(normalize(r));
      this.execution.set(r.execution ?? null);
      await this.refreshSignals(r);
      await this.loadHistory();
    });
  }

  private async refreshSignals(r: DecisionResult): Promise<void> {
    if (!r.runId) return;
    const portfolio = await this.api.portfolio(this.mode());
    const list = await this.api.signals({ portfolioId: portfolio.portfolio.id, actionable: true, limit: 300 });
    const map: Record<string, number> = {};
    for (const s of list.signals) if (s.runId === r.runId && s.status === 'PENDING') map[s.decisionKey] = s.id;
    this.signalIds.set(map);
  }

  protected executeOne(id: number): Promise<void> {
    return this.guard(async () => {
      const r = await this.api.executeSignal(id);
      const msg = r.rejected ? `rejected — ${r.message}` : r.queued ? `queued — ${r.message}` : r.duplicate ? 'already had an order; nothing new was sent' : humanize(r.order.status).toLowerCase();
      this.execution.set({ auto: false, results: [{ signalId: id, symbol: r.order.symbol, action: r.order.side, status: msg.toUpperCase().replace(/ /g, '_'), message: null }] });
      const cur = this.result();
      if (cur) await this.refreshSignals(cur);
    });
  }

  protected executeAll(): Promise<void> {
    return this.guard(async () => {
      const ids = Object.values(this.signalIds());
      this.execution.set(await this.api.executeSignals(ids));
      const cur = this.result();
      if (cur) await this.refreshSignals(cur);
    });
  }

  protected async loadHistory(): Promise<void> {
    try {
      this.history.set((await this.api.decisionHistory(this.mode())).runs);
      this.portfolioMissing.set(false);
    } catch (err) {
      const e = err as { status?: number; error?: { code?: string } };
      this.history.set([]);
      if (e?.status === 404 && e.error?.code === 'NO_PORTFOLIO') this.portfolioMissing.set(true);
    }
  }

  protected openRun(id: number): Promise<void> {
    return this.guard(async () => {
      const { run } = await this.api.decisionRun(id);
      if (!run.result) throw new Error('This run has no stored result');
      this.signalIds.set({});
      this.result.set({ ...normalize(run.result), strategy: undefined });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  protected ask(): Promise<void> {
    return this.guard(async () => {
      if (!this.question.trim()) return;
      this.answer.set(await this.api.ask(this.question, this.mode()));
    });
  }
}

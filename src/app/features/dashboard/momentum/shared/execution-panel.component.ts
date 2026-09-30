import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MomentumApiService } from '../momentum-api.service';
import { MomentumStateService } from '../momentum-state.service';
import { Order, OrderEvent, PortfolioMode, PortfolioView, Signal, Trade } from '../momentum.models';
import { actionTone, dateTime, errorMessage, humanize, inr, orderTone, signedInr, tone } from '../format.util';

/**
 * Signals, orders, fills and the execution switch for one portfolio.
 * Orders are only ever created server-side from a stored signal; a submitted
 * order is never shown as filled until the broker reports a fill.
 */
@Component({
  selector: 'mp-execution-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="mp-stack">
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="mp-banner" data-tone="info" role="status">{{ notice() }}</div> }

      @if (view(); as v) {
        <div class="mp-card">
          <div class="mp-card-head">
            <div>
              <h3>Execution mode</h3>
              <p class="mp-sub">
                @if (v.portfolio.autoExecute) {
                  <strong>Automated execution is ON.</strong> Signals from each decision run are sent as {{ mode() === 'LIVE' ? 'REAL broker' : 'simulated' }} orders automatically, after the validation pipeline.
                } @else {
                  <strong>Signal mode.</strong> Decisions produce signals only. You review each one and press Execute.
                }
              </p>
            </div>
            <div class="mp-row">
              @if (needsPhrase() && !v.portfolio.autoExecute) {
                <input class="ui-input phrase" [ngModel]="phrase()" (ngModelChange)="phrase.set($event)" [placeholder]="'Type: ' + autoPhrase()" aria-label="Confirmation phrase" />
              }
              <button type="button" class="ui-btn" [class.ui-btn-secondary]="v.portfolio.autoExecute" [class.ui-btn-primary]="!v.portfolio.autoExecute"
                [disabled]="busy() || (needsPhrase() && !v.portfolio.autoExecute && phrase().trim() !== autoPhrase())" (click)="toggleAuto(!v.portfolio.autoExecute)">
                {{ v.portfolio.autoExecute ? 'Turn off automated execution' : 'Enable automated execution' }}
              </button>
            </div>
          </div>
        </div>
      }

      <div class="mp-card">
        <div class="mp-card-head">
          <div><h3>Signals</h3><p class="mp-sub">Every BUY / SELL / REDUCE the engine has produced for this portfolio.</p></div>
          <div class="mp-row">
            <label class="ui-check"><input type="checkbox" [ngModel]="pendingOnly()" (ngModelChange)="pendingOnly.set($event)" /> Pending only</label>
            @if (pendingCount() > 0) {
              <button type="button" class="ui-btn ui-btn-primary mp-btn-sm" [disabled]="busy()" (click)="executeAllPending()">Execute all {{ pendingCount() }} pending</button>
            }
          </div>
        </div>
        <div class="mp-table-wrap">
          <table class="mp-table">
            <thead><tr><th>Date</th><th>Stock</th><th>Action</th><th class="num">Qty</th><th class="num">Ref price</th><th class="num">Score</th><th>Status</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              @for (s of shownSignals(); track s.id) {
                <tr>
                  <td>{{ s.asOf }}</td>
                  <td class="mp-sym">{{ s.symbol }}</td>
                  <td><span class="mp-badge" [attr.data-tone]="actionTone(s.action)">{{ s.action }}</span></td>
                  <td class="num">{{ s.quantity }}</td>
                  <td class="num">{{ inr(s.priceRef, 2) }}</td>
                  <td class="num">{{ s.score ?? '—' }}</td>
                  <td><span class="mp-badge" [attr.data-tone]="orderTone(s.status)">{{ humanize(s.status) }}</span></td>
                  <td class="reason">{{ s.reason }}</td>
                  <td class="num">
                    @if (s.status === 'PENDING') {
                      <button type="button" class="ui-btn ui-btn-primary mp-btn-sm" [disabled]="busy()" (click)="execute(s)">Execute</button>
                      <button type="button" class="ui-btn ui-btn-ghost mp-btn-sm" [disabled]="busy()" (click)="skip(s)">Skip</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="9" class="mp-empty">No signals yet. Run a decision in the Decision Center.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="mp-card">
        <div class="mp-card-head">
          <div><h3>Orders</h3><p class="mp-sub">Status comes from the broker. Positions change only when a fill is reported.</p></div>
          <button type="button" class="ui-btn ui-btn-secondary mp-btn-sm" [disabled]="busy()" (click)="reconcile()">Reconcile open orders</button>
        </div>
        <div class="mp-table-wrap">
          <table class="mp-table">
            <thead><tr><th>#</th><th>Created</th><th>Stock</th><th>Side</th><th class="num">Qty</th><th class="num">Filled</th><th class="num">Avg fill</th><th>Status</th><th>Broker</th><th></th></tr></thead>
            <tbody>
              @for (o of orders(); track o.id) {
                <tr class="clickable" (click)="toggleOrder(o)">
                  <td>{{ o.id }}</td>
                  <td>{{ dateTime(o.createdAt) }}</td>
                  <td class="mp-sym">{{ o.symbol }}</td>
                  <td><span class="mp-badge" [attr.data-tone]="actionTone(o.side)">{{ o.side }}</span></td>
                  <td class="num">{{ o.qty }}</td>
                  <td class="num">{{ o.filledQty }}</td>
                  <td class="num">{{ o.avgFillPrice ? inr(o.avgFillPrice, 2) : '—' }}</td>
                  <td><span class="mp-badge" [attr.data-tone]="orderTone(o.status)">{{ humanize(o.status) }}</span></td>
                  <td>{{ o.broker }}{{ o.variety === 'amo' ? ' · AMO' : '' }}</td>
                  <td class="num">
                    @if (cancellable(o)) {
                      <button type="button" class="ui-btn ui-btn-danger mp-btn-sm" [disabled]="busy()" (click)="cancel(o); $event.stopPropagation()">Cancel</button>
                    }
                  </td>
                </tr>
                @if (openOrder() === o.id) {
                  <tr class="detail">
                    <td colspan="10">
                      <div class="mp-grid">
                        <div class="mp-col-7">
                          <strong class="mp-small mp-muted">Validation pipeline</strong>
                          <ul class="mp-checks">
                            @for (st of o.validation ?? []; track st.id) {
                              <li><span [class]="st.pass ? 'ok' : 'bad'">{{ st.pass ? '✓' : '✕' }}</span><span><strong>{{ humanize(st.id) }}</strong> — <span class="mp-muted">{{ st.detail }}</span></span></li>
                            }
                          </ul>
                          @if (o.error) { <div class="mp-banner" data-tone="down">{{ o.error }}</div> }
                          <p class="mp-small mp-muted">Idempotency key {{ o.idempotencyKey }} · reason: {{ o.reason }}</p>
                        </div>
                        <div class="mp-col-5">
                          <strong class="mp-small mp-muted">Timeline</strong>
                          <ul class="mp-list">
                            @for (ev of events(); track $index) {
                              <li>{{ dateTime(ev.ts) }} — <strong>{{ humanize(ev.status) }}</strong> ({{ ev.filledQty }} filled) {{ ev.detail }}</li>
                            }
                          </ul>
                        </div>
                      </div>
                    </td>
                  </tr>
                }
              } @empty {
                <tr><td colspan="10" class="mp-empty">No orders yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="mp-card">
        <div class="mp-card-head"><div><h3>Trade history</h3><p class="mp-sub">Every fill with the reason it was made and the realised P&amp;L on exits.</p></div></div>
        <div class="mp-table-wrap">
          <table class="mp-table">
            <thead><tr><th>Date</th><th>Stock</th><th>Side</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Costs</th><th class="num">P&amp;L</th><th class="num">Held</th><th>Reason</th></tr></thead>
            <tbody>
              @for (t of trades(); track t.id) {
                <tr>
                  <td>{{ t.date }}</td><td class="mp-sym">{{ t.symbol }}</td>
                  <td><span class="mp-badge" [attr.data-tone]="actionTone(t.side)">{{ t.side }}</span></td>
                  <td class="num">{{ t.qty }}</td><td class="num">{{ inr(t.price, 2) }}</td><td class="num">{{ inr(t.cost, 2) }}</td>
                  <td class="num" [class]="'mp-' + tone(t.pnl)">{{ t.pnl == null ? '—' : signedInr(t.pnl) }}</td>
                  <td class="num">{{ t.holdingDays == null ? '—' : t.holdingDays + 'd' }}</td>
                  <td class="reason">{{ t.reason }}</td>
                </tr>
              } @empty {
                <tr><td colspan="9" class="mp-empty">No fills yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: `
    .phrase { width: 260px; min-height: 36px; }
    .reason { max-width: 380px; font-size: 0.8rem; line-height: 1.4; }
  `,
})
export class ExecutionPanelComponent implements OnInit {
  private readonly api = inject(MomentumApiService);
  private readonly state = inject(MomentumStateService);

  readonly mode = input.required<PortfolioMode>();
  /** Parent bumps this to force a reload after it changes something. */
  readonly refreshKey = input(0);
  readonly changed = output<void>();

  protected readonly view = signal<PortfolioView | null>(null);
  protected readonly signals = signal<Signal[]>([]);
  protected readonly orders = signal<Order[]>([]);
  protected readonly trades = signal<Trade[]>([]);
  protected readonly events = signal<OrderEvent[]>([]);
  protected readonly openOrder = signal<number | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  protected readonly pendingOnly = signal(false);
  protected readonly phrase = signal('');

  protected readonly autoPhrase = computed(() => this.state.status()?.phrases.auto ?? 'ENABLE AUTOMATED EXECUTION');
  protected readonly needsPhrase = computed(() => this.mode() === 'LIVE');
  protected readonly pendingCount = computed(() => this.signals().filter((s) => s.status === 'PENDING').length);
  protected readonly shownSignals = computed(() => this.signals().filter((s) => !this.pendingOnly() || s.status === 'PENDING'));

  protected readonly actionTone = actionTone;
  protected readonly orderTone = orderTone;
  protected readonly humanize = humanize;
  protected readonly inr = inr;
  protected readonly signedInr = signedInr;
  protected readonly tone = tone;
  protected readonly dateTime = dateTime;

  constructor() {
    let first = true;
    effect(() => {
      this.refreshKey();
      if (first) {
        first = false;
        return;
      }
      void this.load();
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const v = await this.api.portfolio(this.mode());
      this.view.set(v);
      const [sig, ord, tr] = await Promise.all([
        this.api.signals({ portfolioId: v.portfolio.id, actionable: true, limit: 200 }),
        this.api.orders(v.portfolio.id),
        this.api.trades(this.mode()),
      ]);
      this.signals.set(sig.signals);
      this.orders.set(ord.orders);
      this.trades.set(tr.trades);
      this.error.set('');
    } catch (err) {
      this.view.set(null);
      this.error.set(errorMessage(err, 'Could not load execution data'));
    }
  }

  private async run(fn: () => Promise<string | void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const msg = await fn();
      if (msg) this.notice.set(msg);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
      await this.load();
      this.changed.emit();
    }
  }

  protected execute(s: Signal): Promise<void> {
    return this.run(async () => {
      const r = await this.api.executeSignal(s.id);
      const failed = r.rejected ? ` rejected: ${r.message}` : r.queued ? ` queued: ${r.message}` : r.duplicate ? ' already had an order — nothing new was sent' : ` ${humanize(r.order.status).toLowerCase()}`;
      return `${s.action} ${s.symbol}:${failed}`;
    });
  }

  protected executeAllPending(): Promise<void> {
    return this.run(async () => {
      const ids = this.signals().filter((s) => s.status === 'PENDING').map((s) => s.id);
      const r = await this.api.executeSignals(ids);
      return r.results.map((x) => `${x.action} ${x.symbol}: ${humanize(x.status).toLowerCase()}${x.message ? ' (' + x.message + ')' : ''}`).join(' · ');
    });
  }

  protected skip(s: Signal): Promise<void> {
    return this.run(async () => {
      await this.api.skipSignal(s.id);
    });
  }

  protected cancellable(o: Order): boolean {
    return ['QUEUED', 'SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'UNKNOWN'].includes(o.status);
  }

  protected cancel(o: Order): Promise<void> {
    return this.run(async () => {
      const r = await this.api.cancelOrder(o.id);
      return `Order #${o.id} is now ${humanize(r.order.status).toLowerCase()}.`;
    });
  }

  protected reconcile(): Promise<void> {
    return this.run(async () => {
      const r = await this.api.reconcile();
      return r.results.length ? `Checked ${r.results.length} open order(s) with the broker.` : 'No open orders to reconcile.';
    });
  }

  protected toggleAuto(enabled: boolean): Promise<void> {
    return this.run(async () => {
      await this.api.setAutoExecute(this.mode(), enabled, this.needsPhrase() ? this.phrase().trim() : undefined);
      this.phrase.set('');
      return enabled ? 'Automated execution enabled.' : 'Automated execution disabled — signal mode.';
    });
  }

  protected async toggleOrder(o: Order): Promise<void> {
    if (this.openOrder() === o.id) {
      this.openOrder.set(null);
      return;
    }
    this.openOrder.set(o.id);
    this.events.set([]);
    try {
      this.events.set((await this.api.order(o.id)).events);
    } catch {
      this.events.set([]);
    }
  }
}

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { MomentumApiService } from '../momentum-api.service';
import { MomentumStateService } from '../momentum-state.service';
import {
  DeskActionRow,
  DeskGuideStep,
  DeskLastWeekPick,
  DeskOverview,
  DeskPaperReplay,
  DeskScan,
  PortfolioMode,
} from '../momentum.models';
import { errorMessage, inr, pctNum, shortDate, signedInr, tone } from '../format.util';

@Component({
  selector: 'app-momentum-desk-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, NgTemplateOutlet],
  template: `
    <div class="mp-page">
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="mp-banner" data-tone="info" role="status">{{ notice() }}</div> }

      @if (kind() !== 'live') {
        <section class="mp-hero">
          <p class="mp-kicker">Practice</p>
          <h2>Paper — Dual Momentum, virtual money</h2>
          <p>
            Palagai ranks NSE large-caps, mid-caps, <strong>Gold BeES, Silver BeES and Nifty BeES</strong>
            on Dual Momentum 12-1 and holds <strong>2–3 names</strong>. That is the sleeve that prints the
            ~15% months on the live NSE tape. Sit in cash when Nifty’s own trend is broken.
            Pick a date filter, capital, and see start → end capital on top.
          </p>
        </section>

        <div class="mp-card">
          <div class="mp-card-head"><div>
            <h3>This week’s stocks</h3>
            <p class="mp-sub">One tap. Palagai sizes the book from this virtual cash. Gold / Silver / Nifty BeES can be buys when they lead.</p>
          </div></div>
          <form class="mp-row" (ngSubmit)="runPaperScan()">
            <div class="mp-field"><label for="paper-cap">Virtual cash (₹)</label>
              <input id="paper-cap" class="ui-input" type="number" name="pcap" min="10000" step="1000" [(ngModel)]="capital" required /></div>
            <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">{{ busy() ? 'Picking…' : 'Show this week’s stocks' }}</button>
          </form>
        </div>

        @if (paperScan(); as s) {
          @if (s.priceNote) {
            <div class="mp-banner" [attr.data-tone]="s.simulated ? 'warn' : 'info'" role="status">{{ s.priceNote }}</div>
          }
          <p class="mp-next">{{ s.nextAction || s.headline }}</p>
          <ng-container [ngTemplateOutlet]="planCards" [ngTemplateOutletContext]="{ $implicit: s }" />
        }

        <div class="mp-card">
          <div class="mp-card-head"><div>
            <h3>Paper results</h3>
            <p class="mp-sub">Last 12 months and last year are the Dual Momentum book. Last week is one noisy week — not the ~15% months.</p>
          </div></div>
          <form class="mp-stack" (ngSubmit)="runPaper()">
            <div class="mp-row" role="group" aria-label="Paper period">
              @for (opt of periodOptions; track opt.id) {
                <button type="button" class="ui-btn" [class.ui-btn-primary]="period === opt.id" [class.ui-btn-secondary]="period !== opt.id" (click)="setPeriod(opt.id)">{{ opt.label }}</button>
              }
            </div>
            @if (period === 'custom') {
              <div class="mp-row">
                <div class="mp-field"><label for="desk-from">From</label>
                  <input id="desk-from" class="ui-input" type="date" name="from" [(ngModel)]="from" required /></div>
                <div class="mp-field"><label for="desk-to">To</label>
                  <input id="desk-to" class="ui-input" type="date" name="to" [(ngModel)]="to" required /></div>
              </div>
            }
            <div class="mp-row">
              <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">{{ busy() ? 'Replaying…' : 'Show results' }}</button>
            </div>
          </form>
        </div>

        @if (paper(); as p) {
          @if (p.priceNote) {
            <div class="mp-banner" [attr.data-tone]="p.simulated ? 'warn' : 'info'" role="status">{{ p.priceNote }}</div>
          }
          @if (p.lookback; as lb) {
            <div class="mp-banner" data-tone="info" role="status">
              Last week is noise. Same book over {{ lb.periodLabel || 'last 12 months' }}:
              start {{ inr(lb.startCapital) }} → {{ inr(lb.endCapital) }}
              ({{ signedInr(lb.totalProfit) }}, {{ pctNum(lb.returnPct, 1, true) }}).
            </div>
          }
          <div class="mp-stats">
            <div class="mp-stat"><span class="mp-stat-label">Start capital</span>
              <span class="mp-stat-value">{{ inr(p.startCapital ?? p.summary?.started ?? p.capital) }}</span>
              <span class="mp-stat-hint">{{ p.periodLabel || p.from }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">End capital</span>
              <span class="mp-stat-value" [class]="'mp-' + tone((p.endCapital ?? p.summary?.ended ?? 0) - (p.startCapital ?? p.capital))">{{ inr(p.endCapital ?? p.summary?.ended) }}</span>
              <span class="mp-stat-hint">{{ p.to }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Paper P&amp;L</span>
              <span class="mp-stat-value" [class]="'mp-' + tone(p.totalProfit)">{{ signedInr(p.totalProfit) }}</span>
              <span class="mp-stat-hint">{{ p.from }} → {{ p.to }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Return</span>
              <span class="mp-stat-value" [class]="'mp-' + tone(p.summary?.returnPct ?? p.metrics?.totalReturnPct)">
                {{ pctNum(p.summary?.returnPct ?? p.metrics?.totalReturnPct, 1, true) }}
              </span>
              <span class="mp-stat-hint">{{ p.strategyName || 'Dual Momentum' }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Win rate</span>
              <span class="mp-stat-value">{{ pctNum(p.summary?.winRatePct ?? p.metrics?.winRatePct, 0) }}</span>
              <span class="mp-stat-hint">{{ p.closed.length }} closed · {{ p.open.length }} still held</span></div>
          </div>
          @if (p.summary; as sum) {
            <div class="mp-callout" [attr.data-tone]="tone(p.totalProfit) === 'down' ? 'warn' : 'info'">
              <p class="mp-answer">{{ sum.headline }}</p>
              <ul class="mp-list">@for (b of sum.bullets; track b) { <li>{{ b }}</li> }</ul>
              <p class="mp-sub">{{ sum.honestNote }}</p>
            </div>
          }
          <div class="mp-card">
            <div class="mp-card-head"><h3>Closed trades</h3></div>
            <div class="mp-table-wrap"><table class="mp-table">
              <thead><tr><th>Stock</th><th class="num">Qty</th><th>In</th><th>Out</th><th class="num">P&amp;L</th></tr></thead>
              <tbody>
                @for (t of p.closed; track t.symbol + t.entryDate + t.exitDate) {
                  <tr>
                    <td class="mp-sym">{{ t.symbol }}</td>
                    <td class="num">{{ t.qty }}</td>
                    <td>{{ shortDate(t.entryDate) }}<div class="mp-small mp-muted">{{ inr(t.entryPrice, 2) }}</div></td>
                    <td>{{ shortDate(t.exitDate) }}<div class="mp-small mp-muted">{{ inr(t.exitPrice, 2) }}</div></td>
                    <td class="num" [class]="'mp-' + tone(t.pnl)">{{ signedInr(t.pnl) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="mp-empty">No completed trades in this window — Dual Momentum held or stayed in cash.</td></tr>
                }
              </tbody>
            </table></div>
          </div>
          <div class="mp-card">
            <div class="mp-card-head"><h3>Still holding at the end</h3></div>
            <div class="mp-table-wrap"><table class="mp-table">
              <thead><tr><th>Stock</th><th class="num">Qty</th><th>Entry</th><th class="num">Last ₹</th><th class="num">Open P&amp;L</th></tr></thead>
              <tbody>
                @for (t of p.open; track t.symbol) {
                  <tr>
                    <td class="mp-sym">{{ t.symbol }}</td>
                    <td class="num">{{ t.qty }}</td>
                    <td>{{ shortDate(t.entryDate) }}<div class="mp-small mp-muted">{{ inr(t.entryPrice, 2) }}</div></td>
                    <td class="num">{{ inr(t.lastPrice, 2) }}</td>
                    <td class="num" [class]="'mp-' + tone(t.pnl)">{{ signedInr(t.pnl) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="mp-empty">Flat at the end of the range.</td></tr>
                }
              </tbody>
            </table></div>
          </div>
        }

        <div class="mp-card">
          <div class="mp-card-head"><div>
            <h3>Last week’s picks</h3>
            <p class="mp-sub">@if (lastWeekLabel()) { Week {{ lastWeekLabel() }}. } @else { Run this week’s scan at least once to store a week. }</p>
          </div></div>
          <div class="mp-table-wrap"><table class="mp-table">
            <thead><tr><th>Date</th><th>Stock</th><th class="num">Qty</th><th class="num">Ref ₹</th><th class="num">Buy at ₹</th><th>Why</th></tr></thead>
            <tbody>
              @for (pk of lastWeekPicks(); track pk.symbol + pk.date) {
                <tr>
                  <td>{{ shortDate(pk.date) }}</td>
                  <td class="mp-sym">{{ pk.symbol }}</td>
                  <td class="num">{{ pk.qty }}</td>
                  <td class="num">{{ inr(pk.priceRef, 2) }}</td>
                  <td class="num">{{ pk.suggestedLimit != null ? inr(pk.suggestedLimit, 2) : '—' }}</td>
                  <td class="reason">{{ pk.reason }}</td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="mp-empty">No saved pick from last week.</td></tr>
              }
            </tbody>
          </table></div>
        </div>

        <p class="mp-cta">Ready to use real cash? Open <a class="mp-link" routerLink="../live">Live</a> and Get Token. Palagai reads Kite funds and prints this week’s tickets.</p>
      } @else {
        <section class="mp-hero mp-hero-live">
          <p class="mp-kicker">Invest</p>
          <h2>Live — Get Token. We handle the rest.</h2>
          <p>
            You log in once each morning. Palagai reads Kite equity cash, sizes 2–3 Dual Momentum names, and tells you
            Buy / Hold / Sell. Rest the LIMIT after 16:00 IST for the next 09:15 IST open.
          </p>
        </section>

        @if (!tokenReady()) {
          <div class="mp-card">
            <div class="mp-card-head"><h3>Three steps. You only do the first.</h3></div>
            <ol class="mp-steps">
              @for (g of guide(); track g.step) {
                <li [class.done]="g.done">
                  <strong>{{ g.step }}. {{ g.title }}</strong>
                  <p>{{ g.body }}</p>
                  @if (g.href) {
                    <a class="ui-btn ui-btn-primary" [routerLink]="g.href">Get Token</a>
                  }
                </li>
              }
            </ol>
          </div>
        } @else {
          <div class="mp-card">
            <div class="mp-card-head"><div>
              <h3>This week</h3>
              <p class="mp-sub">
                @if (kiteCash() != null) { Kite cash {{ inr(kiteCash()!, 0) }} — Palagai sizes from this. }
                @else { Token is in. Palagai will read cash on scan. }
              </p>
            </div></div>
            <form class="mp-row" (ngSubmit)="runScan()">
              @if (kiteCash() == null) {
                <div class="mp-field"><label for="live-cap">Fallback capital (₹)</label>
                  <input id="live-cap" class="ui-input" type="number" name="lcap" min="10000" step="1000" [(ngModel)]="capital" required /></div>
              }
              <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">{{ busy() ? 'Scanning…' : 'Refresh this week' }}</button>
            </form>
            @if (fundsError()) {
              <div class="mp-banner" data-tone="down" role="alert">{{ fundsError() }} — update Get Token, then refresh.</div>
            }
          </div>

          @if (scan(); as s) {
            <p class="mp-next">{{ s.nextAction || s.headline }}</p>
            <ng-container [ngTemplateOutlet]="planCards" [ngTemplateOutletContext]="{ $implicit: s }" />

            @if (s.alsoHeld?.length) {
              <div class="mp-card">
                <div class="mp-card-head"><div>
                  <h3>Also at Kite</h3>
                  <p class="mp-sub">Held, but not in this Dual Momentum book. Palagai will not replace them.</p>
                </div></div>
                <ul class="mp-list">
                  @for (h of s.alsoHeld; track h.symbol) {
                    <li><strong>{{ h.symbol }}</strong> · {{ h.qty ?? '—' }} sh
                      @if (h.suggestedSell != null) { · sell {{ inr(h.suggestedSell, 2) }} }</li>
                  }
                </ul>
              </div>
            }

            <div class="mp-card">
              <div class="mp-card-head"><div>
                <h3>Last week’s picks</h3>
                <p class="mp-sub">@if (lastWeekLabel()) { Week {{ lastWeekLabel() }}. } @else { Refresh this week at least once to store a week. }</p>
              </div></div>
              <div class="mp-table-wrap"><table class="mp-table">
                <thead><tr><th>Date</th><th>Stock</th><th class="num">Qty</th><th class="num">Ref ₹</th><th class="num">Buy at ₹</th><th>Why</th></tr></thead>
                <tbody>
                  @for (pk of lastWeekPicks(); track pk.symbol + pk.date) {
                    <tr>
                      <td>{{ shortDate(pk.date) }}</td>
                      <td class="mp-sym">{{ pk.symbol }}</td>
                      <td class="num">{{ pk.qty }}</td>
                      <td class="num">{{ inr(pk.priceRef, 2) }}</td>
                      <td class="num">{{ pk.suggestedLimit != null ? inr(pk.suggestedLimit, 2) : '—' }}</td>
                      <td class="reason">{{ pk.reason }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="mp-empty">No saved pick from last week.</td></tr>
                  }
                </tbody>
              </table></div>
            </div>
          }
        }
      }
    </div>

    <ng-template #planCards let-s>
      <div class="mp-plan">
        @for (r of s.buy; track r.symbol) {
          <article class="mp-ticket-card" data-kind="buy">
            <div class="mp-kicker">Buy</div>
            <h3>{{ r.symbol }}</h3>
            <p class="mp-ticket-qty">{{ r.qty }} shares @ {{ r.suggestedLimit != null ? inr(r.suggestedLimit, 2) : inr(r.priceRef, 2) }}</p>
            <p class="mp-sub">{{ r.fillHint || r.reason }}</p>
            @if (kind() === 'live' && r.canExecute) {
              <button type="button" class="ui-btn ui-btn-primary mp-btn-sm" [disabled]="busy()" (click)="executeOne(r)">Place buy</button>
            }
          </article>
        }
        @for (r of s.hold; track r.symbol) {
          <article class="mp-ticket-card" data-kind="hold">
            <div class="mp-kicker">Hold</div>
            <h3>{{ r.symbol }}</h3>
            <p class="mp-ticket-qty">{{ r.qty }} shares · last {{ inr(r.lastPrice ?? r.priceRef, 2) }}</p>
            <p class="mp-sub">{{ r.reason }}</p>
          </article>
        }
        @for (r of s.sell; track r.symbol + r.action) {
          <article class="mp-ticket-card" data-kind="sell">
            <div class="mp-kicker">Sell</div>
            <h3>{{ r.symbol }}</h3>
            <p class="mp-ticket-qty">{{ r.qty }} shares @ {{ r.suggestedSell != null ? inr(r.suggestedSell, 2) : inr(r.suggestedLimit ?? r.priceRef, 2) }}</p>
            <p class="mp-sub">{{ r.fillHint || r.reason }}</p>
            @if (kind() === 'live' && r.canExecute) {
              <button type="button" class="ui-btn ui-btn-danger mp-btn-sm" [disabled]="busy()" (click)="executeOne(r)">Place sell</button>
            }
          </article>
        }
      </div>
      @if (!s.buy?.length && !s.hold?.length && !s.sell?.length) {
        <div class="mp-card mp-empty">Nothing to do this week. Dual Momentum is in cash, or Nifty’s trend is off.</div>
      }
    </ng-template>
  `,
  styles: `
    .mp-hero { background: var(--pg-bg-elevated); border: 1px solid var(--pg-line); border-radius: var(--pg-radius-lg); padding: 1.2rem 1.3rem; }
    .mp-hero-live { border-color: #86efac; background: var(--pg-bull-soft); }
    .mp-kicker { margin: 0 0 0.25rem; font-size: 0.72rem; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; color: var(--pg-muted); }
    .mp-hero h2 { margin: 0 0 0.45rem; font-size: 1.35rem; letter-spacing: -0.03em; }
    .mp-hero p { margin: 0; color: var(--pg-ink); line-height: 1.5; font-size: 0.92rem; }
    .mp-next { margin: 0; font-size: 1.05rem; font-weight: 700; letter-spacing: -0.02em; }
    .mp-cta { margin: 0; font-size: 0.9rem; }
    .mp-plan { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .mp-ticket-card { background: #fff; border: 1px solid var(--pg-line); border-radius: 14px; padding: 1rem 1.05rem; display: flex; flex-direction: column; gap: 0.3rem; }
    .mp-ticket-card[data-kind='buy'] { border-color: #16a34a; }
    .mp-ticket-card[data-kind='sell'] { border-color: #dc2626; }
    .mp-ticket-card h3 { margin: 0; font-size: 1.25rem; }
    .mp-ticket-qty { margin: 0; font-weight: 750; font-variant-numeric: tabular-nums; }
    .mp-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 1rem; }
    .mp-steps li { padding-left: 0; }
    .mp-steps p { margin: 0.25rem 0 0.5rem; color: var(--pg-muted); font-size: 0.88rem; line-height: 1.45; }
    .mp-steps li.done strong { color: var(--pg-bull-deep); }
  `,
})
export class DeskTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly state = inject(MomentumStateService);
  protected readonly kind = toSignal(this.route.data.pipe(map((d) => (d['desk'] === 'live' ? 'live' : 'paper'))), {
    initialValue: 'paper' as const,
  });

  protected readonly overview = signal<DeskOverview | null>(null);
  protected readonly paper = signal<DeskPaperReplay | null>(null);
  protected readonly paperScan = signal<DeskScan | null>(null);
  protected readonly scan = signal<DeskScan | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);

  protected capital = 25000;
  protected period: 'last_week' | 'last_12m' | 'last_year' | 'custom' = 'last_12m';
  protected from = '';
  protected to = '';
  protected readonly periodOptions = [
    { id: 'last_12m' as const, label: 'Last 12 months' },
    { id: 'last_year' as const, label: 'Last year' },
    { id: 'last_week' as const, label: 'Last week' },
    { id: 'custom' as const, label: 'Custom dates' },
  ];

  protected readonly inr = inr;
  protected readonly signedInr = signedInr;
  protected readonly pctNum = pctNum;
  protected readonly tone = tone;
  protected readonly shortDate = shortDate;

  protected readonly kiteCash = computed(() => {
    const fromScan = this.scan()?.funds;
    const fromOverview = this.overview()?.funds;
    const f = fromScan?.ok ? fromScan : fromOverview?.ok ? fromOverview : null;
    const n = f?.equityCash;
    return n != null && Number.isFinite(n) ? n : null;
  });

  protected readonly fundsError = computed(() => {
    const f = this.scan()?.funds ?? this.overview()?.funds;
    if (!f || f.ok) return '';
    return f.error || '';
  });

  protected readonly tokenReady = computed(() => {
    return !!(this.overview()?.tokenReady || this.state.status()?.broker?.configured);
  });

  protected readonly guide = computed<DeskGuideStep[]>(() => this.overview()?.guide ?? []);

  protected readonly lastWeekPicks = computed<DeskLastWeekPick[]>(() => {
    return this.paper()?.lastWeek?.picks || this.paperScan()?.lastWeek?.picks || this.scan()?.lastWeek?.picks || this.overview()?.lastWeek?.picks || [];
  });

  protected readonly lastWeekLabel = computed(() => {
    return this.paper()?.lastWeek?.week || this.paperScan()?.lastWeek?.week || this.scan()?.lastWeek?.week || this.overview()?.lastWeek?.week || '';
  });

  ngOnInit(): void {
    const def = this.overview()?.paperDefaults?.capital;
    if (def) this.capital = def;
    void this.loadOverview();
  }

  protected setPeriod(id: typeof this.period): void {
    this.period = id;
    const periods = this.overview()?.paperDefaults?.periods;
    if (id === 'custom') {
      if (!this.from) this.from = periods?.custom?.from || periods?.last_12m?.from || '';
      if (!this.to) this.to = periods?.custom?.to || periods?.last_12m?.to || '';
    }
  }

  private async loadOverview(): Promise<void> {
    try {
      const o = await this.api.desk();
      this.overview.set(o);
      if (o.paperDefaults?.capital) this.capital = o.paperDefaults.capital;
      if (o.paperDefaults?.periods?.custom) {
        this.from = o.paperDefaults.periods.custom.from;
        this.to = o.paperDefaults.periods.custom.to;
      } else if (o.paperDefaults?.from && o.paperDefaults?.to) {
        this.from = o.paperDefaults.from;
        this.to = o.paperDefaults.to;
      }
      if (this.kind() === 'live') {
        if (o.lastScan) this.scan.set(o.lastScan);
        if (this.tokenReady() && o.funds?.ok) await this.runScan();
      }
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load Palagai Momentum'));
    }
  }

  protected async runPaperScan(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.paperScan.set(await this.api.deskScan({ capital: Number(this.capital), reset: true, mode: 'PAPER' }));
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not pick this week’s stocks'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async runPaper(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const body: { capital: number; period: string; from?: string; to?: string; strategyId?: string } = {
        capital: Number(this.capital),
        period: this.period,
        strategyId: this.overview()?.strategy?.id || 'momentum-weekly',
      };
      if (this.period === 'custom') {
        body.from = this.from;
        body.to = this.to;
      }
      this.paper.set(await this.api.deskPaper(body));
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not replay paper results'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async runPaperYear(): Promise<void> {
    this.period = 'last_12m';
    await this.runPaper();
  }

  protected async runScan(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const mode: PortfolioMode = 'LIVE';
      const result = await this.api.deskScan({
        capital: this.kiteCash() ?? Number(this.capital),
        mode,
      });
      this.scan.set(result);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not build this week’s tickets'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async executeOne(row: DeskActionRow): Promise<void> {
    if (!row.signalId) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.api.executeSignal(row.signalId);
      this.notice.set(`${row.action} ${row.symbol} × ${row.qty} — ${r.order.status}${r.message ? ` · ${r.message}` : ''}`);
      row.canExecute = false;
      this.scan.update((s) => (s ? { ...s } : s));
    } catch (err) {
      this.error.set(errorMessage(err, `Could not ${row.action.toLowerCase()} ${row.symbol}`));
    } finally {
      this.busy.set(false);
    }
  }
}

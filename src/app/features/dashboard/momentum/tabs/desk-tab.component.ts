import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { MomentumApiService } from '../momentum-api.service';
import { MomentumStateService } from '../momentum-state.service';
import {
  DeskActionRow,
  DeskOverview,
  DeskPaperReplay,
  DeskScan,
  PortfolioMode,
} from '../momentum.models';
import { actionTone, errorMessage, inr, pctNum, shortDate, signedInr, tone } from '../format.util';

@Component({
  selector: 'app-momentum-desk-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="mp-page">
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="mp-banner" data-tone="info" role="status">{{ notice() }}</div> }

      @if (kind() !== 'live') {
        <div class="mp-card">
          <div class="mp-card-head"><div>
            <h2>Paper — see what the system did</h2>
            <p class="mp-sub">Pick a date range and capital — ₹10,000 is enough. The scanner ranks every NSE large-cap and mid-cap (Nifty 100 + Midcap 150), buys the weekly momentum leaders at the next 09:15 IST open, and sells the same way. A 10k book holds 2–3 stocks.</p>
          </div></div>
          <form class="mp-row" (ngSubmit)="runPaper()">
            <div class="mp-field"><label for="desk-from">From</label>
              <input id="desk-from" class="ui-input" type="date" name="from" [(ngModel)]="from" required /></div>
            <div class="mp-field"><label for="desk-to">To</label>
              <input id="desk-to" class="ui-input" type="date" name="to" [(ngModel)]="to" required /></div>
            <div class="mp-field"><label for="desk-cap">Capital (₹)</label>
              <input id="desk-cap" class="ui-input" type="number" name="cap" min="10000" step="1000" [(ngModel)]="capital" required /></div>
            <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">{{ busy() ? 'Running…' : 'Show picks' }}</button>
          </form>
        </div>

        @if (paper(); as p) {
          <div class="mp-stats">
            <div class="mp-stat"><span class="mp-stat-label">Total profit</span>
              <span class="mp-stat-value" [class]="'mp-' + tone(p.totalProfit)">{{ signedInr(p.totalProfit) }}</span>
              <span class="mp-stat-hint">closed {{ signedInr(p.closedProfit) }} · still open {{ signedInr(p.openProfit) }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Capital</span>
              <span class="mp-stat-value">{{ inr(p.capital) }}</span>
              <span class="mp-stat-hint">{{ p.from }} → {{ p.to }}</span></div>
            <div class="mp-stat"><span class="mp-stat-label">Closed trades</span>
              <span class="mp-stat-value">{{ p.closed.length }}</span>
              <span class="mp-stat-hint">entry &amp; exit at {{ p.fillTime }}</span></div>
          </div>

          <div class="mp-card">
            <div class="mp-card-head"><div><h3>Entered and sold</h3>
              <p class="mp-sub">Decision after 16:00 IST the previous session. Fill at 09:15 IST the next trading morning.</p></div></div>
            <div class="mp-table-wrap"><table class="mp-table">
              <thead><tr>
                <th>Stock</th><th class="num">Qty</th>
                <th>Entry</th><th class="num">Entry ₹</th>
                <th>Exit</th><th class="num">Exit ₹</th>
                <th class="num">Held</th><th class="num">Profit</th><th>Why sold</th>
              </tr></thead>
              <tbody>
                @for (t of p.closed; track t.symbol + t.entryDate + t.exitDate) {
                  <tr>
                    <td class="mp-sym">{{ t.symbol }}</td>
                    <td class="num">{{ t.qty }}</td>
                    <td>{{ shortDate(t.entryDate) }}<div class="mp-small mp-muted">{{ t.entryTime }}</div></td>
                    <td class="num">{{ inr(t.entryPrice, 2) }}</td>
                    <td>{{ shortDate(t.exitDate) }}<div class="mp-small mp-muted">{{ t.exitTime }}</div></td>
                    <td class="num">{{ inr(t.exitPrice, 2) }}</td>
                    <td class="num">{{ t.holdingDays ?? '—' }}d</td>
                    <td class="num" [class]="'mp-' + tone(t.pnl)">{{ signedInr(t.pnl) }}@if (t.pnlPct != null) { <div class="mp-small">{{ pctNum(t.pnlPct * 100, 1, true) }}</div> }</td>
                    <td class="reason">{{ t.exitReason }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="9" class="mp-empty">No completed trades in this range.</td></tr>
                }
              </tbody>
            </table></div>
          </div>

          <div class="mp-card">
            <div class="mp-card-head"><h3>Still holding at the end</h3></div>
            <div class="mp-table-wrap"><table class="mp-table">
              <thead><tr><th>Stock</th><th class="num">Qty</th><th>Entry</th><th class="num">Entry ₹</th><th class="num">Last ₹</th><th class="num">Held</th><th class="num">Open P&amp;L</th></tr></thead>
              <tbody>
                @for (t of p.open; track t.symbol) {
                  <tr>
                    <td class="mp-sym">{{ t.symbol }}</td>
                    <td class="num">{{ t.qty }}</td>
                    <td>{{ shortDate(t.entryDate) }}<div class="mp-small mp-muted">{{ t.entryTime }}</div></td>
                    <td class="num">{{ inr(t.entryPrice, 2) }}</td>
                    <td class="num">{{ inr(t.lastPrice, 2) }}</td>
                    <td class="num">{{ t.holdingDays ?? '—' }}d</td>
                    <td class="num" [class]="'mp-' + tone(t.pnl)">{{ signedInr(t.pnl) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="mp-empty">Flat at the end of the range.</td></tr>
                }
              </tbody>
            </table></div>
          </div>
        }
      } @else {
        @if (overview(); as o) {
          <div class="mp-card when">
            <div class="mp-card-head"><div>
              <h2>When to run the scanner</h2>
              <p class="mp-sub">{{ o.strategy.name }} · {{ o.schedule.horizon.toLowerCase() }} review. Decisions use the completed daily bar. Orders fill the next morning.</p>
            </div></div>
            <div class="mp-grid">
              <div class="mp-col-6">
                <div class="when-kicker">Buy / add new stocks</div>
                <div class="when-when">{{ o.schedule.buy.when }}</div>
                <p class="mp-sub">{{ o.schedule.buy.instruction }}</p>
              </div>
              <div class="mp-col-6">
                <div class="when-kicker">Check sells</div>
                <div class="when-when">{{ o.schedule.sell.when }}</div>
                <p class="mp-sub">{{ o.schedule.sell.instruction }}</p>
              </div>
            </div>
            <p class="mp-sub hold-rule">{{ o.schedule.holdRule }}</p>
          </div>
        }

        <div class="mp-card">
          <div class="mp-card-head"><div>
            <h2>This week</h2>
            <p class="mp-sub">Scans every NSE large-cap and mid-cap, and checks the stocks you already hold at Kite. Start with ₹10,000 — qty is sized so 2–3 names can actually be bought. Press Buy or Sell only on the rows you want. New buys show a LIMIT you can rest in advance for the next 09:15 IST open.</p>
          </div></div>
          <form class="mp-row" (ngSubmit)="runScan()">
            <div class="mp-field"><label for="live-cap">Capital (₹)</label>
              <input id="live-cap" class="ui-input" type="number" name="lcap" min="10000" step="1000" [(ngModel)]="capital" required /></div>
            <label class="ui-check"><input type="checkbox" name="reset" [(ngModel)]="resetBook" /> Start fresh with this capital</label>
            <button type="submit" class="ui-btn ui-btn-primary" [disabled]="busy()">{{ busy() ? 'Scanning…' : 'Run scanner' }}</button>
          </form>
          @if (scan()?.usedPaperFallback) {
            <p class="mp-sub">No live broker book yet — this scan uses your paper book. Connect a token and enable live trading so Hold/Sell can read your CNC holdings.</p>
          }
          @if (scan()?.holdingsSync; as hs) {
            @if (hs.ok) {
              <p class="mp-sub">Kite CNC: {{ (hs.imported?.length || 0) + (hs.updated?.length || 0) }} name(s) in the live book@if (hs.skipped?.length) { · {{ hs.skipped.length }} not in this scanner }.</p>
            } @else if (hs.error) {
              <p class="mp-sub">Could not refresh CNC holdings: {{ hs.error }}</p>
            }
          }
        </div>

        <div class="mp-card">
          <div class="mp-card-head"><div><h3>Last week’s picks</h3>
            <p class="mp-sub">@if (lastWeekLabel()) { Week {{ lastWeekLabel() }}. } @else { Run the scanner at least once to store a week. }</p></div></div>
          <div class="mp-table-wrap"><table class="mp-table">
            <thead><tr><th>Date</th><th>Stock</th><th class="num">Qty</th><th class="num">Ref ₹</th><th class="num">Buy at ₹</th><th>Why</th></tr></thead>
            <tbody>
              @for (p of lastWeekPicks(); track p.symbol + p.date) {
                <tr>
                  <td>{{ shortDate(p.date) }}</td>
                  <td class="mp-sym">{{ p.symbol }}</td>
                  <td class="num">{{ p.qty }}</td>
                  <td class="num">{{ inr(p.priceRef, 2) }}</td>
                  <td class="num">{{ p.suggestedLimit != null ? inr(p.suggestedLimit, 2) : '—' }}</td>
                  <td class="reason">{{ p.reason }}</td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="mp-empty">No saved pick from last week.</td></tr>
              }
            </tbody>
          </table></div>
        </div>

        @if (scan(); as s) {
          <p class="mp-sub">As of {{ s.asOf }} close · {{ s.headline }}</p>
          <div class="mp-card">
            <div class="mp-card-head">
              <div><h3>Buy</h3><p class="mp-sub">New names. Rest the Buy-at LIMIT for the next 09:15 IST open (AMO after 16:00). Ref is last close.</p></div>
              @if (executable(s.buy).length) {
                <button type="button" class="ui-btn ui-btn-primary mp-btn-sm" [disabled]="busy()" (click)="executeRows(s.buy)">Buy all</button>
              }
            </div>
            <div class="mp-table-wrap"><table class="mp-table">
              <thead><tr><th>Stock</th><th class="num">Qty</th><th class="num">Ref ₹</th><th class="num">Buy at ₹</th><th class="num">Value</th><th>Why</th><th></th></tr></thead>
              <tbody>
                @for (r of s.buy; track r.symbol) {
                  <tr>
                    <td class="mp-sym">{{ r.symbol }}</td>
                    <td class="num">{{ r.qty }}</td>
                    <td class="num">{{ inr(r.priceRef, 2) }}</td>
                    <td class="num"><strong>{{ r.suggestedLimit != null ? inr(r.suggestedLimit, 2) : '—' }}</strong>
                      @if (r.fillHint) { <div class="mp-small mp-muted">{{ r.fillHint }}</div> }</td>
                    <td class="num">{{ inr(r.allocationValue) }}</td>
                    <td class="reason">{{ r.reason }}</td>
                    <td class="num">
                      @if (r.canExecute) {
                        <button type="button" class="ui-btn ui-btn-primary mp-btn-sm" [disabled]="busy()" (click)="executeOne(r)">Buy</button>
                      }
                    </td>
                  </tr>
                } @empty { <tr><td colspan="7" class="mp-empty">Nothing to buy today.</td></tr> }
              </tbody>
            </table></div>
          </div>

          <div class="mp-card">
            <div class="mp-card-head"><div><h3>Hold</h3><p class="mp-sub">Already in your book. Keep these. Do not sell.</p></div></div>
            <div class="mp-table-wrap"><table class="mp-table">
              <thead><tr><th>Stock</th><th class="num">Qty</th><th class="num">Entry ₹</th><th class="num">Last ₹</th><th>Why</th></tr></thead>
              <tbody>
                @for (r of s.hold; track r.symbol) {
                  <tr>
                    <td class="mp-sym">{{ r.symbol }}</td>
                    <td class="num">{{ r.qty }}</td>
                    <td class="num">{{ r.avgPrice != null ? inr(r.avgPrice, 2) : '—' }}</td>
                    <td class="num">{{ inr(r.lastPrice ?? r.priceRef, 2) }}</td>
                    <td class="reason">{{ r.reason }}</td>
                  </tr>
                } @empty { <tr><td colspan="5" class="mp-empty">No holdings to hold. If you already own stocks at Kite, update the token, enable live, and run the scanner again.</td></tr> }
              </tbody>
            </table></div>
          </div>

          <div class="mp-card">
            <div class="mp-card-head">
              <div><h3>Sell</h3><p class="mp-sub">Exit or reduce names you already hold. Rest the Sell-at LIMIT for the next 09:15 IST open.</p></div>
              @if (executable(s.sell).length) {
                <button type="button" class="ui-btn ui-btn-danger mp-btn-sm" [disabled]="busy()" (click)="executeRows(s.sell)">Sell all</button>
              }
            </div>
            <div class="mp-table-wrap"><table class="mp-table">
              <thead><tr><th>Stock</th><th>Action</th><th class="num">Qty</th><th class="num">Sell at ₹</th><th>Why</th><th></th></tr></thead>
              <tbody>
                @for (r of s.sell; track r.symbol + r.action) {
                  <tr>
                    <td class="mp-sym">{{ r.symbol }}</td>
                    <td><span class="mp-badge" [attr.data-tone]="actionTone(r.action)">{{ r.action }}</span></td>
                    <td class="num">{{ r.qty }}</td>
                    <td class="num"><strong>{{ r.suggestedLimit != null ? inr(r.suggestedLimit, 2) : inr(r.priceRef, 2) }}</strong>
                      @if (r.fillHint) { <div class="mp-small mp-muted">{{ r.fillHint }}</div> }</td>
                    <td class="reason">{{ r.reason }}</td>
                    <td class="num">
                      @if (r.canExecute) {
                        <button type="button" class="ui-btn ui-btn-danger mp-btn-sm" [disabled]="busy()" (click)="executeOne(r)">Sell</button>
                      }
                    </td>
                  </tr>
                } @empty { <tr><td colspan="6" class="mp-empty">Nothing to sell today.</td></tr> }
              </tbody>
            </table></div>
          </div>

          @if (s.alsoHeld?.length) {
            <div class="mp-card">
              <div class="mp-card-head"><div>
                <h3>Also in your CNC book</h3>
                <p class="mp-sub">Held at Kite but not in the large/mid weekly scanner. The system will not auto-replace these — keep or sell yourself.</p>
              </div></div>
              <div class="mp-table-wrap"><table class="mp-table">
                <thead><tr><th>Stock</th><th class="num">Qty</th><th class="num">Avg ₹</th><th class="num">Last ₹</th><th>Why skipped</th></tr></thead>
                <tbody>
                  @for (h of s.alsoHeld; track h.symbol) {
                    <tr>
                      <td class="mp-sym">{{ h.symbol }}</td>
                      <td class="num">{{ h.qty ?? '—' }}</td>
                      <td class="num">{{ h.avgPrice != null ? inr(h.avgPrice, 2) : '—' }}</td>
                      <td class="num">{{ h.lastPrice != null ? inr(h.lastPrice, 2) : '—' }}</td>
                      <td class="reason">{{ h.reason }}</td>
                    </tr>
                  }
                </tbody>
              </table></div>
            </div>
          }
        }
      }

      <p class="mp-small mp-muted more"><a class="mp-link" routerLink="../settings">Settings</a>
        · <a class="mp-link" routerLink="../backtest">Research tools</a></p>
    </div>
  `,
  styles: `
    .when-kicker { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--pg-muted); }
    .when-when { font-size: 1.15rem; font-weight: 700; margin: 0.25rem 0 0.4rem; letter-spacing: -0.02em; }
    .hold-rule { margin-top: 0.85rem; font-weight: 600; }
    .more { margin-top: 0.25rem; }
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
  protected readonly scan = signal<DeskScan | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);

  protected capital = 10000;
  protected from = '2024-01-01';
  protected to = '2024-12-31';
  protected resetBook = false;

  protected readonly inr = inr;
  protected readonly signedInr = signedInr;
  protected readonly pctNum = pctNum;
  protected readonly tone = tone;
  protected readonly shortDate = shortDate;
  protected readonly actionTone = actionTone;

  ngOnInit(): void {
    const last = this.state.status()?.data.last;
    if (last) this.to = last;
    void this.loadOverview();
  }

  protected lastWeekPicks() {
    return this.scan()?.lastWeek.picks ?? this.overview()?.lastWeek.picks ?? [];
  }

  protected lastWeekLabel() {
    return this.scan()?.lastWeek.week ?? this.overview()?.lastWeek.week ?? '';
  }

  protected executable(rows: DeskActionRow[]): DeskActionRow[] {
    return rows.filter((r) => r.canExecute && r.signalId);
  }

  private async loadOverview(): Promise<void> {
    try {
      this.overview.set(await this.api.desk());
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load the scan calendar'));
    }
  }

  protected async runPaper(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.paper.set(await this.api.deskPaper({ capital: Number(this.capital), from: this.from, to: this.to }));
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not replay that date range'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async runScan(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const mode: PortfolioMode = 'LIVE';
      const result = await this.api.deskScan({ capital: Number(this.capital), reset: this.resetBook, mode });
      this.scan.set(result);
    } catch (err) {
      this.error.set(errorMessage(err, 'Scanner failed'));
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

  protected async executeRows(rows: DeskActionRow[]): Promise<void> {
    const ids = this.executable(rows).map((r) => r.signalId!).filter(Boolean);
    if (!ids.length) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const out = await this.api.executeSignals(ids);
      const lines = out.results.map((r) => `${r.action} ${r.symbol} — ${r.status}`).join('; ');
      this.notice.set(lines || 'Nothing sent.');
      for (const row of rows) row.canExecute = false;
      this.scan.update((s) => (s ? { ...s } : s));
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not send those orders'));
    } finally {
      this.busy.set(false);
    }
  }
}

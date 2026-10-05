import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MomentumApiService, ScreenerResponse } from '../momentum-api.service';
import { RankRow, StockDetail } from '../momentum.models';
import { LineChartComponent, ChartSeries } from '../shared/line-chart.component';
import { actionTone, errorMessage, inr, num, pctFrac, regimeLabel, regimeTone, tone } from '../format.util';

type SortKey = 'rank' | 'score' | 'price' | 'd1' | 'w1' | 'm1' | 'm3' | 'm6' | 'm12' | 'rs' | 'relVolume' | 'rsi' | 'adx' | 'atrPct';

@Component({
  selector: 'app-momentum-screener-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LineChartComponent],
  template: `
    <div class="mp-page">
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }
      @if (data(); as d) {
        <div class="mp-card">
          <div class="mp-card-head">
            <div>
              <h2>Momentum screener</h2>
              <p class="mp-sub">
                {{ d.universeSize }} stocks ranked as of {{ d.asOf }}. Market regime
                <span class="mp-badge" [attr.data-tone]="regimeTone(d.regime.regime)">{{ regimeLabel(d.regime.regime) }}</span>
                — new entries need status <strong>{{ d.regime.policy.minEntryStatus }}</strong> or better.
              </p>
            </div>
          </div>
          <div class="mp-form filters">
            <div class="mp-field"><label for="scr-q">Search</label><input id="scr-q" class="ui-input" placeholder="Symbol or name" [ngModel]="query()" (ngModelChange)="query.set($event)" /></div>
            <div class="mp-field"><label for="scr-sector">Sector</label>
              <select id="scr-sector" class="ui-select" [ngModel]="sector()" (ngModelChange)="sector.set($event)">
                <option value="">All sectors</option>
                @for (s of d.sectors; track s) { <option [value]="s">{{ s }}</option> }
              </select></div>
            <div class="mp-field"><label for="scr-status">Entry status</label>
              <select id="scr-status" class="ui-select" [ngModel]="status()" (ngModelChange)="status.set($event)">
                <option value="">Any</option><option value="STRONG_BUY">Strong buy</option><option value="BUY">Buy</option><option value="WATCH">Watch</option><option value="WAIT">Wait</option>
              </select></div>
            <label class="ui-check"><input type="checkbox" [ngModel]="eligibleOnly()" (ngModelChange)="eligibleOnly.set($event)" /> Eligible only</label>
            <label class="ui-check"><input type="checkbox" [ngModel]="heldOnly()" (ngModelChange)="heldOnly.set($event)" /> Held only</label>
          </div>
        </div>

        <div class="mp-table-wrap">
          <table class="mp-table">
            <thead>
              <tr>
                <th class="sortable" (click)="sortBy('rank')">#{{ arrow('rank') }}</th>
                <th>Stock</th>
                <th class="num sortable" (click)="sortBy('price')">Price{{ arrow('price') }}</th>
                <th class="num sortable" (click)="sortBy('score')">Score{{ arrow('score') }}</th>
                <th>Entry</th>
                <th class="num sortable" (click)="sortBy('d1')">1D{{ arrow('d1') }}</th>
                <th class="num sortable" (click)="sortBy('w1')">1W{{ arrow('w1') }}</th>
                <th class="num sortable" (click)="sortBy('m1')">1M{{ arrow('m1') }}</th>
                <th class="num sortable" (click)="sortBy('m3')">3M{{ arrow('m3') }}</th>
                <th class="num sortable" (click)="sortBy('m6')">6M{{ arrow('m6') }}</th>
                <th class="num sortable" (click)="sortBy('m12')">12M{{ arrow('m12') }}</th>
                <th class="num sortable" (click)="sortBy('rs')">RS 3M{{ arrow('rs') }}</th>
                <th class="num sortable" (click)="sortBy('relVolume')">Vol×{{ arrow('relVolume') }}</th>
                <th class="num sortable" (click)="sortBy('rsi')">RSI{{ arrow('rsi') }}</th>
                <th class="num sortable" (click)="sortBy('adx')">ADX{{ arrow('adx') }}</th>
                <th class="num sortable" (click)="sortBy('atrPct')">ATR%{{ arrow('atrPct') }}</th>
                <th>EMA 20/50/100/200</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.symbol) {
                <tr class="clickable" [class.dim]="!r.eligible" (click)="open(r.symbol)">
                  <td>{{ r.rank }}</td>
                  <td><span class="mp-sym">{{ r.symbol }}</span> @if (r.held) { <span class="mp-badge" data-tone="info">held</span> }
                    @if (r.breakout) { <span class="mp-badge" data-tone="up">breakout</span> }
                    <div class="mp-small mp-muted">{{ r.sector }}</div></td>
                  <td class="num">{{ inr(r.price, 2) }}</td>
                  <td class="num"><strong>{{ num(r.score, 1) }}</strong></td>
                  <td><span class="mp-badge" [attr.data-tone]="badge(r.status)">{{ r.status }}</span></td>
                  <td class="num" [class]="'mp-' + tone(r.ret.d1)">{{ pctFrac(r.ret.d1, 1, true) }}</td>
                  <td class="num" [class]="'mp-' + tone(r.ret.w1)">{{ pctFrac(r.ret.w1, 1, true) }}</td>
                  <td class="num" [class]="'mp-' + tone(r.ret.m1)">{{ pctFrac(r.ret.m1, 1, true) }}</td>
                  <td class="num" [class]="'mp-' + tone(r.ret.m3)">{{ pctFrac(r.ret.m3, 1, true) }}</td>
                  <td class="num" [class]="'mp-' + tone(r.ret.m6)">{{ pctFrac(r.ret.m6, 1, true) }}</td>
                  <td class="num" [class]="'mp-' + tone(r.ret.m12)">{{ pctFrac(r.ret.m12, 1, true) }}</td>
                  <td class="num" [class]="'mp-' + tone(r.rsVsIndex3m)">{{ pctFrac(r.rsVsIndex3m, 1, true) }}</td>
                  <td class="num">{{ num(r.relVolume, 2) }}</td>
                  <td class="num">{{ num(r.rsi, 0) }}</td>
                  <td class="num">{{ num(r.adx, 0) }}</td>
                  <td class="num">{{ pctFrac(r.atrPct, 1) }}</td>
                  <td class="ema">
                    @for (k of emaKeys; track k) { <i [class.on]="r.aboveEma[k]" [title]="'Price above EMA ' + k"></i> }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="17" class="mp-empty">No stocks match these filters.</td></tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (!error()) {
        <div class="mp-card mp-empty">Scanning the universe…</div>
      }
    </div>

    @if (selected()) {
      <button type="button" class="mp-scrim" aria-label="Close stock detail" (click)="close()"></button>
      <aside class="mp-drawer" aria-label="Stock detail">
        @if (detail(); as s) {
          <div class="mp-card-head">
            <div>
              <h2>{{ s.symbol }} <span class="mp-badge" [attr.data-tone]="badge(s.entry.status)">{{ s.entry.status }}</span></h2>
              <p class="mp-sub">{{ s.name }} · {{ s.sector }} · as of {{ s.asOf }}</p>
            </div>
            <button type="button" class="ui-btn ui-btn-ghost mp-btn-sm" (click)="close()">Close</button>
          </div>
          <div class="mp-stack">
            <div class="mp-card">
              <mp-line-chart [series]="chartSeries()" [labels]="chartLabels()" [height]="260" [format]="priceFmt" ariaLabel="Price with moving averages" />
            </div>
            <div class="mp-callout" [attr.data-tone]="s.entry.actionable ? undefined : 'warn'">
              <strong>{{ s.entry.headline }}</strong>
              @if (s.entry.waitFor.length) {
                <div class="mp-small">Wait for:</div>
                <ul class="mp-list">@for (w of s.entry.waitFor; track w) { <li>{{ w }}</li> }</ul>
              }
            </div>
            <div class="mp-grid">
              <div class="mp-card mp-col-6">
                <div class="mp-card-head"><h3>Score {{ num(s.score.total, 1) }}/100</h3></div>
                @for (c of components(s); track c.key) {
                  <details class="comp-box">
                    <summary class="comp"><span>{{ c.label }} <small class="mp-muted">×{{ pctFrac(c.weight, 0) }}</small></span><div class="mp-bar"><span [style.width.%]="c.value"></span></div><span class="mp-num">{{ num(c.value, 0) }}</span></summary>
                    <ul class="mp-list mp-small">@for (n of c.notes; track n) { <li>{{ n }}</li> }</ul>
                  </details>
                }
              </div>
              <div class="mp-card mp-col-6">
                <div class="mp-card-head"><h3>Trade plan</h3></div>
                <dl class="mp-kv">
                  <dt>Entry</dt><dd>{{ inr(s.entry.risk.entry, 2) }}</dd>
                  <dt>Stop</dt><dd>{{ inr(s.entry.risk.stop, 2) }} ({{ s.entry.risk.stopType }})</dd>
                  <dt>Target</dt><dd>{{ inr(s.entry.risk.target, 2) }} ({{ s.entry.risk.targetType }})</dd>
                  <dt>Reward / risk</dt><dd>{{ s.entry.risk.rewardRisk }}</dd>
                  <dt>Holding</dt><dd>{{ s.entry.expectedHolding }}</dd>
                </dl>
              </div>
            </div>
            <div class="mp-card">
              <div class="mp-card-head"><h3>Entry checks</h3></div>
              <ul class="mp-checks">
                @for (c of s.entry.checks; track c.id) {
                  <li><span [class]="c.pass ? 'ok' : c.critical ? 'bad' : 'soft'">{{ c.pass ? '✓' : c.critical ? '✕' : '!' }}</span><span><strong>{{ c.label }}</strong> — <span class="mp-muted">{{ c.detail }}</span></span></li>
                }
              </ul>
              @if (s.entry.invalidation.length) {
                <strong class="mp-small mp-muted">Would invalidate a buy</strong>
                <ul class="mp-list">@for (w of s.entry.invalidation; track w) { <li>{{ w }}</li> }</ul>
              }
            </div>
            @if (!s.eligibility.eligible) {
              <div class="mp-banner" data-tone="warn">Not eligible: {{ s.eligibility.reasons.join('; ') }}</div>
            }
          </div>
        } @else if (detailError()) {
          <div class="mp-banner" data-tone="down">{{ detailError() }}</div>
        } @else {
          <div class="mp-empty">Loading {{ selected() }}…</div>
        }
      </aside>
    }
  `,
  styles: `
    .filters { align-items: end; }
    tr.dim { opacity: 0.55; }
    .ema { white-space: nowrap; }
    .ema i { display: inline-block; width: 9px; height: 9px; margin-right: 3px; border-radius: 50%; background: var(--pg-line-strong); }
    .ema i.on { background: var(--pg-bull); }
    .comp { display: grid; grid-template-columns: 130px 1fr 32px; gap: 0.6rem; align-items: center; font-size: 0.8rem; cursor: pointer; list-style: none; }
    .comp-box { margin-bottom: 0.45rem; }
    .comp-box ul { margin: 0.4rem 0 0.2rem 0.4rem; }
    h2 { margin: 0; font-size: 1.1rem; }
  `,
})
export class ScreenerTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly data = signal<ScreenerResponse | null>(null);
  protected readonly error = signal('');
  protected readonly selected = signal<string | null>(null);
  protected readonly detail = signal<StockDetail | null>(null);
  protected readonly detailError = signal('');

  protected readonly query = signal('');
  protected readonly sector = signal('');
  protected readonly status = signal('');
  protected readonly eligibleOnly = signal(false);
  protected readonly heldOnly = signal(false);
  protected readonly sortKey = signal<SortKey>('rank');
  protected readonly sortDir = signal<1 | -1>(1);

  protected readonly emaKeys = ['20', '50', '100', '200'];
  protected readonly inr = inr;
  protected readonly num = num;
  protected readonly pctFrac = pctFrac;
  protected readonly tone = tone;
  protected readonly regimeTone = regimeTone;
  protected readonly regimeLabel = regimeLabel;
  protected readonly priceFmt = (v: number) => v.toFixed(2);

  protected readonly rows = computed<RankRow[]>(() => {
    const d = this.data();
    if (!d) return [];
    const q = this.query().trim().toLowerCase();
    const key = this.sortKey();
    const dir = this.sortDir();
    const value = (r: RankRow): number => {
      switch (key) {
        case 'rank': return r.rank;
        case 'score': return r.score;
        case 'price': return r.price;
        case 'rs': return r.rsVsIndex3m ?? -Infinity;
        case 'relVolume': return r.relVolume;
        case 'rsi': return r.rsi;
        case 'adx': return r.adx;
        case 'atrPct': return r.atrPct;
        default: return r.ret[key] ?? -Infinity;
      }
    };
    return d.rows
      .filter((r) => (!q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
        && (!this.sector() || r.sector === this.sector())
        && (!this.status() || r.status === this.status())
        && (!this.eligibleOnly() || r.eligible)
        && (!this.heldOnly() || r.held))
      .sort((a, b) => (value(a) - value(b)) * dir);
  });

  protected readonly chartLabels = computed(() => this.detail()?.overlays.dates ?? []);
  protected readonly chartSeries = computed<ChartSeries[]>(() => {
    const s = this.detail();
    if (!s) return [];
    const n = s.overlays.dates.length;
    const closes = s.candles.slice(-n).map((c) => c.close);
    return [
      { name: 'Close', color: '#0f172a', values: closes },
      { name: 'EMA 20', color: '#0f9d58', values: s.overlays.emaFast },
      { name: 'EMA 50', color: '#2563eb', values: s.overlays.emaMid },
      { name: 'EMA 100', color: '#ea580c', values: s.overlays.emaSlow },
      { name: 'EMA 200', color: '#e11d48', values: s.overlays.emaLong, dashed: true },
    ];
  });

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.api.screener());
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load the screener'));
    }
    const symbol = this.route.snapshot.queryParamMap.get('symbol');
    if (symbol) this.open(symbol);
  }

  protected badge(v: string): string {
    return actionTone(v);
  }

  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortDir.update((d) => (d === 1 ? -1 : 1));
    else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'rank' ? 1 : -1);
    }
  }

  protected arrow(key: SortKey): string {
    return this.sortKey() === key ? (this.sortDir() === 1 ? ' ▲' : ' ▼') : '';
  }

  protected components(s: StockDetail): Array<{ key: string; label: string; value: number; weight: number; notes: string[] }> {
    return Object.entries(s.score.components).map(([key, v]) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toUpperCase()),
      value: Number(v?.score ?? 0),
      weight: Number(v?.weight ?? 0),
      notes: Array.isArray(v?.notes) ? (v.notes as string[]) : [],
    }));
  }

  protected async open(symbol: string): Promise<void> {
    this.selected.set(symbol);
    this.detail.set(null);
    this.detailError.set('');
    void this.router.navigate([], { queryParams: { symbol }, replaceUrl: true });
    try {
      const d = await this.api.stock(symbol);
      if (this.selected() === symbol) this.detail.set(d);
    } catch (err) {
      this.detailError.set(errorMessage(err, 'Could not load this stock'));
    }
  }

  protected close(): void {
    this.selected.set(null);
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }
}

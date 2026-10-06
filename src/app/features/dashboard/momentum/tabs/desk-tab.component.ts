import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MomentumApiService } from '../momentum-api.service';
import { DeskActionRow, DeskScan } from '../momentum.models';
import { errorMessage, inr } from '../format.util';

@Component({
  selector: 'app-momentum-desk-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="mp-page">
      @if (error()) { <div class="mp-banner" data-tone="down" role="alert">{{ error() }}</div> }

      <div class="mp-row">
        <button type="button" class="ui-btn ui-btn-primary" [disabled]="busy()" (click)="runScan()">
          {{ busy() ? 'Scanning…' : 'Scan' }}
        </button>
        @if (!tokenReady()) {
          <a class="ui-btn ui-btn-secondary" routerLink="/dashboard/get-token">Get Token</a>
        }
      </div>

      @if (scan(); as s) {
        <p class="mp-next">{{ s.headline }}</p>

        @if (s.buyTomorrow?.length) {
          <section class="mp-card">
            <h2>Buy tomorrow</h2>
            <ul class="suggest">
              @for (r of s.buyTomorrow; track r.symbol) {
                <li><strong>{{ r.symbol }}</strong> · {{ r.qty }} shares · {{ price(r) }}</li>
              }
            </ul>
          </section>
        }

        @if (s.sellToday?.length) {
          <section class="mp-card">
            <h2>Sell today</h2>
            <ul class="suggest">
              @for (r of s.sellToday; track r.symbol) {
                <li><strong>{{ r.symbol }}</strong> · {{ r.qty }} shares · {{ price(r) }}</li>
              }
            </ul>
          </section>
        }

        @if (s.sellTomorrow?.length) {
          <section class="mp-card">
            <h2>Sell tomorrow</h2>
            <ul class="suggest">
              @for (r of s.sellTomorrow; track r.symbol) {
                <li><strong>{{ r.symbol }}</strong> · {{ r.qty }} shares · {{ price(r) }}</li>
              }
            </ul>
          </section>
        }
      } @else if (!error() && !busy()) {
        <div class="mp-card mp-empty">Scan for buy and sell.</div>
      }
    </div>
  `,
  styles: `
    h2 { margin: 0 0 0.6rem; font-size: 1.15rem; letter-spacing: -0.02em; }
    .suggest { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.45rem; }
    .suggest li { font-size: 1.05rem; font-variant-numeric: tabular-nums; }
    .mp-next { margin: 0; font-weight: 700; }
  `,
})
export class DeskTabComponent implements OnInit {
  private readonly api = inject(MomentumApiService);

  protected readonly scan = signal<DeskScan | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly tokenReady = signal(false);
  protected readonly inr = inr;

  ngOnInit(): void {
    void this.start();
  }

  protected price(row: DeskActionRow): string {
    const n = row.suggestedLimit ?? row.suggestedSell ?? row.suggestedBuy ?? row.priceRef;
    return n != null ? inr(n, 2) : '—';
  }

  private async start(): Promise<void> {
    try {
      const overview = await this.api.desk();
      this.tokenReady.set(!!overview.tokenReady);
    } catch {
      this.tokenReady.set(false);
    }
    await this.runScan();
  }

  protected async runScan(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.api.deskScan({ capital: 25000, mode: 'LIVE' });
      this.scan.set(result);
      if (result.product?.tokenReady) this.tokenReady.set(true);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not scan'));
    } finally {
      this.busy.set(false);
    }
  }
}

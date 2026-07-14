import { Component, OnDestroy, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PaperTradeDeskService } from '../../../core/paper-desk/paper-trade-desk.service';
import { PaperDeskMode } from '../../../core/paper-desk/paper-desk.models';

@Component({
  selector: 'app-trade-desk',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './trade-desk.component.html',
  styleUrl: './trade-desk.component.css',
})
export class TradeDeskComponent implements OnDestroy {
  private readonly desk = inject(PaperTradeDeskService);

  protected readonly mode = signal<PaperDeskMode>('testing');
  protected fromDate = shiftDays(-5);
  protected toDate = todayIso();
  /** Addon: when Live + this checked, places real Kite MIS orders. */
  protected realOrders = false;
  protected realOrdersAck = false;
  /** Live money lots (exchange lot size × this). Testing ignores this. */
  protected lots = 1;

  protected readonly snapshot = this.desk.snapshot;
  protected readonly busy = this.desk.busy;
  protected readonly error = signal('');

  ngOnDestroy(): void {
    this.desk.stopLive();
  }

  protected setMode(mode: PaperDeskMode): void {
    if (this.busy() || this.snapshot().running) {
      this.desk.stopLive();
    }
    this.mode.set(mode);
    this.error.set('');
    if (mode === 'testing') {
      this.realOrders = false;
      this.realOrdersAck = false;
    }
  }

  protected async onStart(): Promise<void> {
    this.error.set('');
    try {
      if (this.mode() === 'testing') {
        if (!this.fromDate || !this.toDate || this.fromDate > this.toDate) {
          this.error.set('Pick a valid From → To date range.');
          return;
        }
        await this.desk.runTesting(this.fromDate, this.toDate);
      } else {
        if (this.realOrders && !this.realOrdersAck) {
          this.error.set('Tick the confirmation box before starting Live money.');
          return;
        }
        if (this.realOrders) {
          const lots = Math.max(1, Math.floor(Number(this.lots)) || 1);
          this.lots = lots;
          const ok = window.confirm(
            `Start LIVE MONEY?\n\nReal Kite MIS MARKET orders will be placed on ATM options (${lots} lot each) for Nifty & Bank Nifty when signals fire.\n\nOrders go via DigitalOcean fixed IP.\nPaper Testing mode is unchanged.`,
          );
          if (!ok) {
            return;
          }
        }
        await this.desk.startLive({
          realOrders: this.realOrders,
          lots: Math.max(1, Math.floor(Number(this.lots)) || 1),
        });
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  protected onStop(): void {
    this.desk.stopLive();
  }

  protected hasOpenTrade(): boolean {
    return this.snapshot().statuses.some((s) => !!s.openTrade);
  }

  protected marketLiveSummary(): string {
    const open = this.snapshot().statuses.filter((s) => s.openTrade);
    if (!open.length) {
      return '';
    }
    return open
      .map((s) => {
        const o = s.openTrade!;
        const money = this.snapshot().realOrders && s.brokerEntryOrderId ? ' · Kite live' : '';
        return `${s.instrumentName}: ${o.direction} · Entry ${o.indexEntry.toFixed(1)} · SL ${o.indexStop.toFixed(1)} · Tgt ${o.indexTarget.toFixed(1)}${money}`;
      })
      .join('  |  ');
  }

  protected fmtTime(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    return ts.replace('T', ' ').slice(0, 16);
  }
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

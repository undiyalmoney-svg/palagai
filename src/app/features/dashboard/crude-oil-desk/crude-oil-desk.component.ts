import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CrudePaperDeskService } from '../../../core/paper-desk/crude-paper-desk.service';
import { PaperDeskMode } from '../../../core/paper-desk/paper-desk.models';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { LotsPreferenceService } from '../../../core/services/lots-preference.service';
import { MCX_CRUDE_SESSION } from '../../../core/config/session.config';
import { formatUnknownError } from '../../../core/utils/kite-error.util';

@Component({
  selector: 'app-crude-oil-desk',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './crude-oil-desk.component.html',
  styleUrl: './crude-oil-desk.component.css',
})
export class CrudeOilDeskComponent implements OnInit, OnDestroy {
  private readonly desk = inject(CrudePaperDeskService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly lotsPreference = inject(LotsPreferenceService);

  protected readonly session = MCX_CRUDE_SESSION;
  protected readonly mode = signal<PaperDeskMode>('testing');
  protected fromDate = shiftDays(-14);
  protected toDate = todayIso();
  /** When Live + checked, places real Kite MCX NRML orders. */
  protected realOrders = false;
  protected realOrdersAck = false;
  protected lots = 1;

  protected readonly snapshot = this.desk.snapshot;
  protected readonly busy = this.desk.busy;
  protected readonly error = signal('');

  ngOnInit(): void {
    this.lots = this.lotsPreference.get();
  }

  protected onLotsChange(): void {
    const normalized = Math.max(1, Math.floor(Number(this.lots)) || 1);
    this.lots = normalized;
    this.lotsPreference.set(normalized);
  }

  ngOnDestroy(): void {
    this.desk.stopLive();
  }

  protected setMode(mode: PaperDeskMode): void {
    if (this.busy()) {
      this.desk.cancelRun();
    } else if (this.snapshot().running) {
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
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('No Kite session. Open Get Token and paste your access token, then try again.');
      return;
    }

    const lots = Math.max(1, Math.floor(Number(this.lots)) || 1);
    this.lots = lots;
    this.lotsPreference.set(lots);

    try {
      if (this.mode() === 'testing') {
        if (!this.fromDate || !this.toDate || this.fromDate > this.toDate) {
          this.error.set('Pick a valid From → To date range.');
          return;
        }
        await this.desk.runTesting(this.fromDate, this.toDate, lots);
      } else {
        if (this.realOrders && !this.realOrdersAck) {
          this.error.set('Tick the confirmation box before starting Live money.');
          return;
        }
        if (this.realOrders) {
          const ok = window.confirm(
            `Start LIVE MONEY on Crude Oil Mini?\n\nReal Kite MCX NRML MARKET orders will be placed on ATM CRUDEOILM options (${lots} lot each) when signals fire.\n\nOrders go via DigitalOcean fixed IP.`,
          );
          if (!ok) {
            return;
          }
        }
        await this.desk.startLive({
          realOrders: this.realOrders,
          lots,
        });
      }
    } catch (err) {
      this.error.set(formatUnknownError(err, 'Crude desk'));
    }
  }

  protected onStop(): void {
    if (this.busy()) {
      this.desk.cancelRun();
      return;
    }
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

import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CrudePaperDeskService, CrudeDeskRunOptions } from '../../../core/paper-desk/crude-paper-desk.service';
import { PaperDeskExportService } from '../../../core/paper-desk/paper-desk-export.service';
import { PaperDeskMode } from '../../../core/paper-desk/paper-desk.models';
import {
  PAPER_WEEKDAY_OPTIONS,
  PaperWeekdayKey,
  PaperWeekdaySelection,
  buildWeekdayFilteredView,
  defaultPaperWeekdaySelection,
} from '../../../core/paper-desk/paper-desk-weekday-filter';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { LotsPreferenceService } from '../../../core/services/lots-preference.service';
import { MCX_CRUDE_SESSION } from '../../../core/config/session.config';
import { CRUDE_RUPEES_PER_POINT } from '../../../core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { extractTradeDate, formatDayOfWeek, formatDisplayDate } from '../../../core/utils/trade-date.util';

@Component({
  selector: 'app-crude-oil-desk',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './crude-oil-desk.component.html',
  styleUrl: './crude-oil-desk.component.css',
})
export class CrudeOilDeskComponent implements OnInit, OnDestroy {
  private readonly desk = inject(CrudePaperDeskService);
  private readonly deskExport = inject(PaperDeskExportService);
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
  /** Morning ORB 10:00–12:00 (default on for paper + live). */
  protected enableMorning = true;
  /** Evening PDHL 18:30–20:30 (default on — both windows). */
  protected enableEvening = true;
  /** Stricter day loss ≈ −₹2,950 (off = champion −₹2,400). */
  protected strictDayStop = false;

  /** Testing result filter: Mon–Fri. */
  protected readonly weekdayOptions = PAPER_WEEKDAY_OPTIONS;
  protected readonly weekdayOn = signal<PaperWeekdaySelection>(defaultPaperWeekdaySelection());

  protected readonly snapshot = this.desk.snapshot;
  protected readonly busy = this.desk.busy;
  protected readonly error = signal('');

  protected readonly resultView = computed(() => {
    const snap = this.snapshot();
    if (this.mode() !== 'testing' || !snap.trades.length) {
      return {
        trades: snap.trades,
        totals: snap.totals,
        dayStats: snap.dayStats,
        weekdayLabel: 'all',
        filtered: false,
      };
    }
    const view = buildWeekdayFilteredView(
      snap.trades,
      this.weekdayOn(),
      snap.totals.lotsUsed || this.lots,
      CRUDE_RUPEES_PER_POINT,
    );
    return { ...view, filtered: true };
  });

  ngOnInit(): void {
    this.lots = this.lotsPreference.get();
    if (this.snapshot().running) {
      this.mode.set('live');
      this.realOrders = this.snapshot().realOrders;
    }
  }

  ngOnDestroy(): void {
    // Do not stopLive — keep Crude polling while on Trade Desk / other tabs.
  }

  protected onLotsChange(): void {
    const normalized = Math.max(1, Math.floor(Number(this.lots)) || 1);
    this.lots = normalized;
    this.lotsPreference.set(normalized);
  }

  protected toggleWeekday(key: PaperWeekdayKey): void {
    this.weekdayOn.update((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  protected isWeekdayOn(key: PaperWeekdayKey): boolean {
    return this.weekdayOn()[key];
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

  private buildRunOptions(lots: number): CrudeDeskRunOptions {
    return {
      lots,
      strictDayStop: this.strictDayStop,
      enableMorning: this.enableMorning,
      enableEvening: this.enableEvening,
    };
  }

  protected async onStart(): Promise<void> {
    this.error.set('');
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('No Kite session. Open Get Token and paste your access token, then try again.');
      return;
    }
    if (!this.enableMorning && !this.enableEvening) {
      this.error.set('Turn on Morning and/or Evening session.');
      return;
    }

    const lots = Math.max(1, Math.floor(Number(this.lots)) || 1);
    this.lots = lots;
    this.lotsPreference.set(lots);
    const runOpts = this.buildRunOptions(lots);

    try {
      if (this.mode() === 'testing') {
        if (!this.fromDate || !this.toDate || this.fromDate > this.toDate) {
          this.error.set('Pick a valid From → To date range.');
          return;
        }
        await this.desk.runTesting(this.fromDate, this.toDate, runOpts);
      } else {
        if (this.realOrders && !this.realOrdersAck) {
          this.error.set('Tick the confirmation box before starting Live money.');
          return;
        }
        if (this.realOrders) {
          const risk = this.strictDayStop
            ? '\nStrict day stop −₹2,950 enabled.'
            : '\nDay stop −₹2,400 (champion default).';
          const ok = window.confirm(
            `Start LIVE MONEY on Crude Oil Mini?\n\nReal Kite MCX NRML MARKET orders will be placed on ATM CRUDEOILM options (${lots} lot each) when signals fire.${risk}\n\nOrders go via DigitalOcean fixed IP.`,
          );
          if (!ok) {
            return;
          }
        }
        await this.desk.startLive({
          ...runOpts,
          realOrders: this.realOrders,
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

  protected fmtWeekday(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    return formatDayOfWeek(extractTradeDate(ts));
  }

  protected fmtDisplayDate(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    return formatDisplayDate(extractTradeDate(ts));
  }

  protected downloadPdf(): void {
    const snap = this.snapshot();
    const view = this.resultView();
    if (!view.trades.length) {
      return;
    }
    this.deskExport.exportPdf(
      {
        ...snap,
        trades: view.trades,
        totals: view.totals,
        dayStats: view.dayStats,
      },
      {
        title: 'Crude Oil Desk Results',
        subtitle: `CRUDEOILM ${[
          this.enableMorning ? 'morning 10:00–12:00' : null,
          this.enableEvening ? 'evening 18:30–20:30' : null,
        ]
          .filter(Boolean)
          .join(' + ')} · days ${view.weekdayLabel}`,
      },
    );
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

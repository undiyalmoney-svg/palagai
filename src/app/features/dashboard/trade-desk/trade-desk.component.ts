import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PaperTradeDeskService, TradeDeskRunOptions } from '../../../core/paper-desk/paper-trade-desk.service';
import { PaperDeskExportService } from '../../../core/paper-desk/paper-desk-export.service';
import { PaperDeskMode } from '../../../core/paper-desk/paper-desk.models';
import {
  PAPER_WEEKDAY_OPTIONS,
  PaperWeekdayKey,
  PaperWeekdaySelection,
  buildWeekdayFilteredView,
  defaultPaperWeekdaySelection,
} from '../../../core/paper-desk/paper-desk-weekday-filter';
import { PDHL_RUPEES_PER_POINT } from '../../../core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { LotsPreferenceService } from '../../../core/services/lots-preference.service';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { extractTradeDate, formatDayOfWeek, formatDisplayDate } from '../../../core/utils/trade-date.util';

@Component({
  selector: 'app-trade-desk',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './trade-desk.component.html',
  styleUrl: './trade-desk.component.css',
})
export class TradeDeskComponent implements OnInit, OnDestroy {
  private readonly desk = inject(PaperTradeDeskService);
  private readonly deskExport = inject(PaperDeskExportService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly lotsPreference = inject(LotsPreferenceService);

  protected readonly mode = signal<PaperDeskMode>('testing');
  protected fromDate = shiftDays(-14);
  protected toDate = todayIso();
  /** When Live + checked, places real Kite MIS orders. */
  protected realOrders = false;
  protected realOrdersAck = false;
  /** Exchange lot × this — Testing / Live paper Option ₹ and Live money qty. */
  protected lots = 1;

  /** Trade Desk book + risk checkboxes (Testing + Live). */
  protected enableNifty = true;
  protected enableBank = true;
  /** Combined strict day loss ≈ −₹2,950 (safer than default ~−₹8k days). */
  protected strictDayStop = false;
  /** Combined day profit lock ≈ +₹5,000. */
  protected dayProfitLock = false;

  /** Testing result filter: Mon–Fri (fetch all, show selected weekdays). */
  protected readonly weekdayOptions = PAPER_WEEKDAY_OPTIONS;
  protected readonly weekdayOn = signal<PaperWeekdaySelection>(defaultPaperWeekdaySelection());

  protected readonly snapshot = this.desk.snapshot;
  protected readonly busy = this.desk.busy;
  protected readonly error = signal('');

  /** Filtered Testing view; Live uses full snapshot. */
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
      PDHL_RUPEES_PER_POINT,
    );
    return { ...view, filtered: true };
  });

  ngOnInit(): void {
    this.lots = this.lotsPreference.get();
    // Live continues in the root desk service across tab switches — restore UI mode.
    if (this.snapshot().running) {
      this.mode.set('live');
      this.realOrders = this.snapshot().realOrders;
    }
  }

  ngOnDestroy(): void {
    // Do not stopLive — Trade Desk + Crude must keep polling when you switch tabs.
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

  private buildRunOptions(lots: number): TradeDeskRunOptions {
    return {
      lots,
      enableNifty: this.enableNifty,
      enableBank: this.enableBank,
      strictDayStop: this.strictDayStop,
      dayProfitLock: this.dayProfitLock,
    };
  }

  private selectedBooksLabel(): string {
    const parts = [
      this.enableNifty ? 'Nifty 50' : null,
      this.enableBank ? 'Bank Nifty' : null,
    ].filter(Boolean);
    return parts.join(' + ') || 'none';
  }

  protected async onStart(): Promise<void> {
    this.error.set('');
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('No Kite session. Open Get Token and paste your access token, then try again.');
      return;
    }
    if (!this.enableNifty && !this.enableBank) {
      this.error.set('Select at least one: Nifty 50 or Bank Nifty.');
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
          const riskBits = [
            this.strictDayStop ? 'strict day stop −₹2,950' : null,
            this.dayProfitLock ? 'day profit lock +₹5,000' : null,
          ]
            .filter(Boolean)
            .join(', ');
          const ok = window.confirm(
            `Start LIVE MONEY?\n\nReal Kite MIS MARKET orders on ATM options (${lots} lot each) for: ${this.selectedBooksLabel()}.\n${riskBits ? `Risk: ${riskBits}.\n` : ''}\nOrders go via DigitalOcean fixed IP.`,
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
      this.error.set(formatUnknownError(err, 'Trade desk'));
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

  protected hasKiteOpenTrade(): boolean {
    return this.snapshot().statuses.some((s) => !!s.openTrade && !!s.brokerEntryOrderId);
  }

  protected hasKiteBlockEvents(): boolean {
    return this.snapshot().orderEvents.some((e) => e.action === 'SKIP' || e.action === 'ERROR');
  }

  protected marketLiveSummary(): string {
    const open = this.snapshot().statuses.filter((s) => s.openTrade);
    if (!open.length) {
      return '';
    }
    return open
      .map((s) => {
        const o = s.openTrade!;
        const optTgt = this.optionTargetPremium(o);
        const optBits =
          o.optionEntryPremium != null
            ? ` · Opt ${o.optionEntryPremium.toFixed(2)}${optTgt != null ? `→${optTgt.toFixed(2)}` : ''}`
            : '';
        if (this.snapshot().realOrders && s.brokerEntryOrderId) {
          return `${s.instrumentName}: ${o.direction} · E ${o.indexEntry.toFixed(1)} → Tgt ${o.indexTarget.toFixed(1)}${optBits} · Kite ${s.brokerEntryOrderId}`;
        }
        if (this.snapshot().realOrders) {
          return `${s.instrumentName}: ${o.direction} · desk only · NOT on Kite${s.kiteBlockReason ? ` (${s.kiteBlockReason})` : ''}`;
        }
        return `${s.instrumentName}: ${o.direction} · E ${o.indexEntry.toFixed(1)} → Tgt ${o.indexTarget.toFixed(1)}${optBits} · paper`;
      })
      .join('  |  ');
  }

  /** Option SL premium proxy: entry − |index entry − stop| × 0.5 (same as live SL-M). */
  protected optionStopPremium(open: {
    indexEntry: number;
    indexStop: number;
    optionEntryPremium: number | null;
  }): number | null {
    if (open.optionEntryPremium == null || open.optionEntryPremium <= 0) {
      return null;
    }
    const indexRisk = Math.abs(open.indexEntry - open.indexStop);
    return Math.max(0.05, Math.round((open.optionEntryPremium - indexRisk * 0.5) / 0.05) * 0.05);
  }

  /** Option target premium proxy: entry + |index target − entry| × 0.5. */
  protected optionTargetPremium(open: {
    indexEntry: number;
    indexTarget: number;
    optionEntryPremium: number | null;
  }): number | null {
    if (open.optionEntryPremium == null || open.optionEntryPremium <= 0) {
      return null;
    }
    const indexReward = Math.abs(open.indexTarget - open.indexEntry);
    return Math.max(0.05, Math.round((open.optionEntryPremium + indexReward * 0.5) / 0.05) * 0.05);
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
        title: 'Trade Desk Results',
        subtitle: `Nifty 50 / Bank Nifty paper · days ${view.weekdayLabel}`,
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

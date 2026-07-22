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
import { tradesUsedRuler } from '../../../core/paper-desk/paper-desk-points-money';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { LotsPreferenceService } from '../../../core/services/lots-preference.service';
import { StrategyManagerService } from '../../../core/strategy-manager/runtime/strategy-manager.service';
import { StrategyAssignmentService } from '../../../core/strategy-manager/config/strategy-assignment.service';
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
  private readonly strategyManager = inject(StrategyManagerService);
  private readonly assignments = inject(StrategyAssignmentService);

  protected readonly mode = signal<PaperDeskMode>('testing');
  /** Always true — Nifty/Bank are Ruler-only. */
  protected readonly rulerEnabled = this.assignments.rulerEnabled;
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

  /** Filtered Testing view; Live uses full snapshot. Ruler P&L follows run, not only toggle. */
  protected readonly resultView = computed(() => {
    const snap = this.snapshot();
    const rulerRun =
      !!snap.rulerActive ||
      this.rulerEnabled() ||
      tradesUsedRuler(snap.trades);
    const rankBy = rulerRun ? 'pointsMoney' : 'option';
    if (this.mode() !== 'testing' || !snap.trades.length) {
      return {
        trades: snap.trades,
        totals: snap.totals,
        dayStats: snap.dayStats,
        weekdayLabel: 'all',
        filtered: false,
        rulerRun,
      };
    }
    const view = buildWeekdayFilteredView(
      snap.trades,
      this.weekdayOn(),
      snap.totals.lotsUsed || this.lots,
      rankBy,
      snap.fromDate,
      snap.toDate,
    );
    return { ...view, filtered: true, rulerRun };
  });

  ngOnInit(): void {
    this.lots = this.lotsPreference.get();
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

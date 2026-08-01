import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PaperTradeDeskService, TradeDeskRunOptions } from '../../../core/paper-desk/paper-trade-desk.service';
import { PaperDeskExportService } from '../../../core/paper-desk/paper-desk-export.service';
import { PaperDeskMode } from '../../../core/paper-desk/paper-desk.models';
import { buildLiveAssistant } from '../../../core/paper-desk/live-assistant.util';
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
import { AuthService } from '../../../core/auth/auth.service';
import { StrategyAssignmentService } from '../../../core/strategy-manager/config/strategy-assignment.service';
import { StrategyRegistryService } from '../../../core/strategy-manager/registry/strategy-registry.service';
import { dnaCapsForStrategy } from '../../../core/strategy-manager/config/strategy-dna-caps';
import { DeskChannel } from '../../../core/strategy-manager/models/desk-channel.model';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';

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
  private readonly auth = inject(AuthService);
  private readonly uiDialog = inject(UiDialogService);
  private readonly assignments = inject(StrategyAssignmentService);
  private readonly registry = inject(StrategyRegistryService);

  protected readonly mode = signal<PaperDeskMode>('testing');
  /** Default both dates to yesterday so Testing opens on the last completed session. */
  protected fromDate = yesterdayIso();
  protected toDate = yesterdayIso();
  /** When Live + checked, places real Kite MIS orders. */
  protected realOrders = false;
  protected realOrdersAck = false;
  /** Per-book lots (exchange lot × this). Defaults from shared preference. */
  protected niftyLots = 1;
  protected bankLots = 1;
  protected crudeLots = 1;

  /** Trade Desk book + risk checkboxes (Testing + Live). All books ON by default. */
  protected enableNifty = true;
  protected enableBank = true;
  protected enableCrude = true;
  /** Combined strict day loss ≈ −₹2,950 — off by default; user must opt in. */
  protected strictDayStop = false;
  /** Combined day profit lock ≈ +₹5,000. */
  protected dayProfitLock = false;
  /** Background Kutty scalp — owner only in UI; friends always off. */
  protected enableKutty = true;
  /** Kutty only — no Trap/Strat entries. Off by default. */
  protected kuttyAlone = false;

  /** Owner (Devil) sees Kutty controls; friends do not. */
  protected readonly showKutty = computed(
    () => this.auth.currentUser()?.role === 'owner',
  );
  /** Crude controls only if user has crude module (owner always has it). */
  protected readonly showCrude = computed(() => this.auth.hasModule('crude'));

  /** Testing result filter: Mon–Fri (fetch all, show selected weekdays). */
  protected readonly weekdayOptions = PAPER_WEEKDAY_OPTIONS;
  protected readonly weekdayOn = signal<PaperWeekdaySelection>(defaultPaperWeekdaySelection());

  protected readonly snapshot = this.desk.snapshot;
  protected readonly busy = this.desk.busy;
  protected readonly error = signal('');

  /** Active Strat assignments for the desk mode (Paper in Testing, Live in Live). */
  protected readonly activeStrategies = computed(() => {
    const assignMode = this.mode() === 'live' ? 'live' : 'paper';
    const map = this.assignments.assignments();
    const row = (channel: DeskChannel) => {
      const id = assignMode === 'live' ? map[channel].live : map[channel].paper;
      const mod = this.registry.getById(id);
      const caps = dnaCapsForStrategy(id, channel);
      const mt = caps.maxTradesPerDay > 0 ? `${caps.maxTradesPerDay}t/day` : '∞ t/day';
      return {
        channel,
        id,
        name: mod?.name ?? id,
        maxTradesLabel: mt,
      };
    };
    return {
      modeLabel: assignMode === 'live' ? 'Live' : 'Paper',
      nifty: row('nifty'),
      bank: row('bank'),
      crude: {
        channel: 'crude' as const,
        id: 'crude-all-green',
        name: 'All-Green',
        maxTradesLabel: '∞ t/day',
      },
      same: map.nifty[assignMode] === map.bank[assignMode],
    };
  });

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
      (id) => this.lotsForInstrumentId(id),
      PDHL_RUPEES_PER_POINT,
    );
    return { ...view, filtered: true };
  });

  ngOnInit(): void {
    const preferred = this.lotsPreference.get();
    this.niftyLots = preferred;
    this.bankLots = preferred;
    this.crudeLots = preferred;
    // Friends: no Kutty. Crude only if module granted.
    if (!this.showKutty()) {
      this.enableKutty = false;
      this.kuttyAlone = false;
    }
    if (!this.showCrude()) {
      this.enableCrude = false;
    }
    // Live continues in the root desk service across tab switches — restore UI mode.
    if (this.snapshot().running) {
      this.mode.set('live');
      this.realOrders = this.snapshot().realOrders;
    }
  }

  ngOnDestroy(): void {
    // Do not stopLive — Trade Desk + Crude must keep polling when you switch tabs.
  }

  protected onLotsChange(book: 'nifty' | 'bank' | 'crude'): void {
    if (book === 'nifty') {
      this.niftyLots = Math.max(1, Math.floor(Number(this.niftyLots)) || 1);
      this.lotsPreference.set(this.niftyLots);
    } else if (book === 'bank') {
      this.bankLots = Math.max(1, Math.floor(Number(this.bankLots)) || 1);
    } else {
      this.crudeLots = Math.max(1, Math.floor(Number(this.crudeLots)) || 1);
    }
  }

  private lotsForInstrumentId(instrumentId: string): number {
    const id = instrumentId.toLowerCase();
    if (id.includes('crude')) {
      return this.crudeLots;
    }
    if (id.includes('bank')) {
      return this.bankLots;
    }
    return this.niftyLots;
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

  private buildRunOptions(): TradeDeskRunOptions {
    const kuttyAlone = this.showKutty() && this.kuttyAlone;
    const enableKutty = this.showKutty() && (kuttyAlone || this.enableKutty);
    const enableCrude = this.showCrude() && this.enableCrude;
    return {
      lots: this.niftyLots,
      niftyLots: this.niftyLots,
      bankLots: this.bankLots,
      crudeLots: this.crudeLots,
      enableNifty: this.enableNifty,
      enableBank: this.enableBank,
      enableCrude,
      strictDayStop: this.strictDayStop,
      dayProfitLock: this.dayProfitLock,
      enableKutty,
      kuttyAlone,
    };
  }

  protected onKuttyAloneChange(): void {
    if (this.kuttyAlone) {
      this.enableKutty = true;
    }
  }

  protected onEnableKuttyChange(): void {
    if (!this.enableKutty) {
      this.kuttyAlone = false;
    }
  }

  private selectedBooksLabel(): string {
    const parts = [
      this.enableNifty ? `Nifty 50 ×${this.niftyLots}` : null,
      this.enableBank ? `Bank Nifty ×${this.bankLots}` : null,
      this.enableCrude && this.showCrude()
        ? `Crude Oil Mini ×${this.crudeLots} (All-Green)`
        : null,
    ].filter(Boolean);
    return parts.join(' + ') || 'none';
  }

  protected async onStart(): Promise<void> {
    this.error.set('');
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('No Kite session. Open Get Token and paste your access token, then try again.');
      return;
    }
    if (!this.enableNifty && !this.enableBank && !(this.enableCrude && this.showCrude())) {
      this.error.set(
        this.showCrude()
          ? 'Select at least one: Nifty 50, Bank Nifty, or Crude Oil Mini.'
          : 'Select at least one: Nifty 50 or Bank Nifty.',
      );
      return;
    }

    this.niftyLots = Math.max(1, Math.floor(Number(this.niftyLots)) || 1);
    this.bankLots = Math.max(1, Math.floor(Number(this.bankLots)) || 1);
    this.crudeLots = Math.max(1, Math.floor(Number(this.crudeLots)) || 1);
    this.lotsPreference.set(this.niftyLots);
    const runOpts = this.buildRunOptions();

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
            this.enableCrude && this.showCrude()
              ? 'Crude All-Green continues past 15:15'
              : null,
          ]
            .filter(Boolean)
            .join(', ');
          const ok = await this.uiDialog.confirm({
            title: 'Start live money?',
            message: `Real Kite MIS MARKET orders on ATM options for: ${this.selectedBooksLabel()}.\n${riskBits ? `Risk: ${riskBits}.\n` : ''}\nOrders go via DigitalOcean fixed IP.`,
            confirmLabel: 'Start live',
            cancelLabel: 'Cancel',
            tone: 'danger',
          });
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

  /**
   * Plain-language “what’s happening now” for Live — scanning, flat/no setup,
   * waiting for entry, in trade, or Kite blocked.
   */
  protected readonly liveAssistant = computed(() => {
    const snap = this.snapshot();
    if (this.mode() !== 'live') {
      return null;
    }
    const nowHhMm = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    });
    return buildLiveAssistant({
      running: snap.running,
      marketOpen: snap.marketOpen,
      realOrders: snap.realOrders,
      message: snap.message,
      statuses: snap.statuses,
      nowHhMm,
      lotsByBook: {
        nifty: this.niftyLots,
        bank: this.bankLots,
        crude: this.crudeLots,
      },
    });
  });

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
        subtitle: this.showCrude()
          ? `Nifty / Bank / Crude paper · days ${view.weekdayLabel}`
          : `Nifty / Bank paper · days ${view.weekdayLabel}`,
      },
    );
  }

  /** Quick Testing ranges — short windows (e.g. Jul-only) can look “broken” vs research. */
  protected setTestingRange(daysBack: number): void {
    this.fromDate = shiftDays(-Math.abs(daysBack));
    this.toDate = todayIso();
  }

  /** True when almost every row is estimated → Index ₹ proxy is the money truth. */
  protected readonly moneyIsIndexProxy = computed(() => {
    const t = this.resultView().totals;
    if (!t.trades) {
      return false;
    }
    const est = t.premiumEstimatedCount ?? 0;
    return est >= t.trades;
  });
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Yesterday in Asia/Kolkata calendar (used as Trade Desk Testing default). */
function yesterdayIso(): string {
  return shiftDays(-1);
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

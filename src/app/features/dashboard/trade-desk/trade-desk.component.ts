import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
import {
  PDHL_RUPEES_PER_POINT,
  deskDayProfitLockMoneyRs,
  deskStrictDayLossMoneyRs,
} from '../../../core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { LotsPreferenceService } from '../../../core/services/lots-preference.service';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { extractTradeDate, formatDayOfWeek, formatDisplayDate } from '../../../core/utils/trade-date.util';
import { StrategyAssignmentService } from '../../../core/strategy-manager/config/strategy-assignment.service';
import { StrategyRegistryService } from '../../../core/strategy-manager/registry/strategy-registry.service';
import { dnaCapsForStrategy } from '../../../core/strategy-manager/config/strategy-dna-caps';
import { DeskChannel } from '../../../core/strategy-manager/models/desk-channel.model';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { APP_BUILD_LABEL } from '../../../core/config/app-build';
import { DAILY_3K_DESK_PRESET } from '../../../core/paper-desk/daily-3k-desk-preset';
import {
  CapitalLotPlan,
  DEFAULT_TRADING_CAPITAL_RS,
  planLotsForCapital,
} from '../../../core/paper-desk/capital-plan.util';
import { CapitalPreferenceService } from '../../../core/services/capital-preference.service';
import { computeOptionTargetPremium } from '../../../core/live-desk/option-sl-premium.util';

@Component({
  selector: 'app-trade-desk',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatProgressSpinnerModule, RouterLink],
  templateUrl: './trade-desk.component.html',
  styleUrl: './trade-desk.component.css',
})
export class TradeDeskComponent implements OnInit, OnDestroy {
  private readonly desk = inject(PaperTradeDeskService);
  private readonly deskExport = inject(PaperDeskExportService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly lotsPreference = inject(LotsPreferenceService);
  private readonly capitalPreference = inject(CapitalPreferenceService);
  private readonly uiDialog = inject(UiDialogService);
  private readonly assignments = inject(StrategyAssignmentService);
  private readonly registry = inject(StrategyRegistryService);

  /** Visible build stamp so you can confirm deploy (e.g. v1.3.41 · …). */
  protected readonly appBuildLabel = APP_BUILD_LABEL;

  /** Hands-off agent defaults to Live — client only presses Start / Stop. */
  protected readonly mode = signal<PaperDeskMode>('live');
  /** When true, Live hides knobs; Start applies the full agent plan. */
  protected readonly handsOffAgent = true;
  /**
   * Default Testing window = today (IST).
   * Yesterday-only hid “today’s DNA ₹” that research / agent reports show.
   */
  protected fromDate = todayIso();
  protected toDate = todayIso();
  /** When Live + checked, places real Kite MIS orders. */
  protected realOrders = false;
  protected realOrdersAck = false;
  /**
   * Total trading capital (₹). Desk auto-allocates lots from this.
   * Client sets capital once; daily job is Get Token + Start + keep tab open.
   */
  protected capitalRs = DEFAULT_TRADING_CAPITAL_RS;
  /**
   * Draft string while the capital field is being edited.
   * Do NOT clamp on every keystroke — that made the input uneditable.
   */
  protected capitalDraft = String(DEFAULT_TRADING_CAPITAL_RS);
  /** When true (default), lot inputs are driven by capital — not hand-edited. */
  protected autoLotsFromCapital = true;
  protected capitalPlan: CapitalLotPlan = planLotsForCapital(DEFAULT_TRADING_CAPITAL_RS);
  /** Per-book lots (exchange lot × this). Defaults from capital plan. */
  protected niftyLots = 1;
  protected bankLots = 1;

  /** Index books only — Crude/Nat Gas are not on Trade Desk. */
  protected enableNifty = true;
  protected enableBank = true;
  /** Combined strict day loss ≈ −₹2,950 × lots — on for hands-off agent. */
  protected strictDayStop = true;
  /** Combined day profit lock ≈ +₹3,000 × lots (1→₹3k, 3→₹9k). */
  protected dayProfitLock = true;
  /** Kutty off — not part of the agent desk. */
  protected enableKutty = false;
  protected kuttyAlone = false;

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
    // Default trading capital is ₹40k (saved preference overrides only after user edits).
    this.capitalRs = this.capitalPreference.get() || DEFAULT_TRADING_CAPITAL_RS;
    if (this.capitalRs < 10_000) {
      this.capitalRs = DEFAULT_TRADING_CAPITAL_RS;
    }
    this.capitalDraft = String(this.capitalRs);
    // Live continues in the root desk service across tab switches — restore UI mode.
    if (this.snapshot().running) {
      this.mode.set('live');
      this.realOrders = this.snapshot().realOrders;
      this.realOrdersAck = true;
      this.capitalPlan = planLotsForCapital(this.capitalRs);
    } else {
      // Hands-off: Live · capital → lots · all-green DNA · capital guards on.
      this.mode.set('live');
      this.applyCapitalAgentPreset();
      // Preset must not wipe a saved capital the user typed earlier.
      this.capitalDraft = String(this.capitalRs || DEFAULT_TRADING_CAPITAL_RS);
    }
    this.enableKutty = false;
    this.kuttyAlone = false;
  }

  ngOnDestroy(): void {
    // Do not stopLive — desk keeps polling when you switch tabs.
  }

  /**
   * Commit capital on blur / Enter only — never while typing.
   * Clamping on ngModelChange was resetting the field every keystroke.
   */
  protected commitCapital(): void {
    const parsed = Math.floor(Number(String(this.capitalDraft).replace(/[,_\s]/g, '')));
    const next = Math.max(
      10_000,
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TRADING_CAPITAL_RS,
    );
    this.capitalRs = next;
    this.capitalDraft = String(next);
    this.capitalPreference.set(next);
    if (this.busy() || this.snapshot().running) {
      return;
    }
    this.applyCapitalAllocation();
  }

  /** Keep draft in sync while typing; do not normalize yet. */
  protected onCapitalDraftChange(raw: string): void {
    this.capitalDraft = raw;
  }

  protected onAutoLotsToggle(): void {
    if (this.autoLotsFromCapital && !(this.busy() || this.snapshot().running)) {
      this.applyCapitalAllocation();
    }
  }

  protected onLotsChange(book: 'nifty' | 'bank'): void {
    if (this.autoLotsFromCapital) {
      return;
    }
    if (book === 'nifty') {
      this.niftyLots = Math.max(1, Math.floor(Number(this.niftyLots)) || 1);
      this.lotsPreference.set(this.niftyLots);
    } else {
      this.bankLots = Math.max(1, Math.floor(Number(this.bankLots)) || 1);
    }
  }

  /**
   * Hands-off agent preset — client only presses Start / Stop after 15:15.
   * Capital, lots, books, DNA, Live money, day lock + strict stop all auto.
   */
  private applyCapitalAgentPreset(): void {
    if (this.busy() || this.snapshot().running) {
      return;
    }
    const p = DAILY_3K_DESK_PRESET;
    this.assignments.forceTrapDefaultsForDaily3k();
    this.strictDayStop = true; // capital must not drain
    this.dayProfitLock = true;
    this.autoLotsFromCapital = true;
    this.enableKutty = false;
    this.kuttyAlone = false;
    // Live money only on Live tab — Paper never places Kite orders.
    if (this.mode() === 'live') {
      this.realOrders = true;
      this.realOrdersAck = true;
    } else {
      this.realOrders = false;
      this.realOrdersAck = false;
    }
    this.applyCapitalAllocation();
    this.error.set('');
  }

  /** Size Nifty+Bank from total capital — more capital → more lots. */
  private applyCapitalAllocation(): void {
    const plan = planLotsForCapital(this.capitalRs);
    this.capitalPlan = plan;
    this.enableNifty = plan.enableNifty;
    this.enableBank = plan.enableBank;
    this.niftyLots = plan.enableNifty ? Math.max(1, plan.niftyLots) : 0;
    this.bankLots = plan.enableBank ? Math.max(1, plan.bankLots) : 0;
    // Preference store keeps a single "primary" lot hint (Nifty when on).
    this.lotsPreference.set(Math.max(this.niftyLots, this.bankLots, 1));
  }

  protected allocationSummary(): string {
    const bits = [
      this.enableNifty ? `Nifty ×${this.niftyLots}` : null,
      this.enableBank ? `Bank ×${this.bankLots}` : null,
    ].filter(Boolean);
    return bits.join(' · ') || 'no books';
  }

  protected hasKiteSession(): boolean {
    return !!this.kiteSession.getAuthorizationHeader();
  }

  private lotsForInstrumentId(instrumentId: string): number {
    const id = instrumentId.toLowerCase();
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
    // Hands-off: always the same books/DNA/guards — no leftover toggles.
    if (this.handsOffAgent && !this.snapshot().running) {
      this.applyCapitalAgentPreset();
      if (mode === 'testing') {
        this.realOrders = false;
        this.realOrdersAck = false;
      }
    }
  }

  private buildRunOptions(): TradeDeskRunOptions {
    return {
      lots: this.niftyLots,
      niftyLots: this.niftyLots,
      bankLots: this.bankLots,
      enableNifty: this.enableNifty,
      enableBank: this.enableBank,
      enableCrude: false,
      enableNatGas: false,
      strictDayStop: this.strictDayStop,
      dayProfitLock: this.dayProfitLock,
      enableKutty: false,
      kuttyAlone: false,
    };
  }

  /**
   * Lots used for ₹ lock/stop labels. Daily keeps Nifty/Bank equal — money ≈ ₹3k × lots.
   */
  protected deskRiskLots(): number {
    if (this.enableBank && !this.enableNifty) {
      return Math.max(1, Math.floor(Number(this.bankLots)) || 1);
    }
    return Math.max(1, Math.floor(Number(this.niftyLots)) || 1);
  }

  /** Day profit lock money band — capital plan when auto lots, else ₹3k × lots. */
  protected profitLockMoneyRs(): number {
    if (this.autoLotsFromCapital && this.capitalPlan.dayProfitLockRs > 0) {
      return this.capitalPlan.dayProfitLockRs;
    }
    return deskDayProfitLockMoneyRs(this.deskRiskLots());
  }

  /** Strict day-stop money band at current lots (1→₹2,950, 3→₹8,850). */
  protected strictStopMoneyRs(): number {
    return deskStrictDayLossMoneyRs(this.deskRiskLots());
  }

  private selectedBooksLabel(): string {
    const parts = [
      this.enableNifty ? `Nifty 50 ×${this.niftyLots}` : null,
      this.enableBank ? `Bank Nifty ×${this.bankLots}` : null,
    ].filter(Boolean);
    return parts.join(' + ') || 'none';
  }

  protected async onStart(): Promise<void> {
    this.error.set('');
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('No Kite session. Open Get Token once, then press Start.');
      return;
    }
    // Commit any in-progress capital typing before sizing / start.
    this.commitCapital();
    // Hands-off: same plan for Paper and Live — only Kite I/O differs on Live.
    if (this.handsOffAgent) {
      this.applyCapitalAgentPreset();
    } else if (this.autoLotsFromCapital) {
      this.applyCapitalAllocation();
    }
    if (!this.enableNifty && !this.enableBank) {
      this.error.set('Agent plan has no books — check capital preference (min ₹10,000).');
      return;
    }

    this.niftyLots = Math.max(1, Math.floor(Number(this.niftyLots)) || 1);
    this.bankLots = Math.max(1, Math.floor(Number(this.bankLots)) || 1);
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
        // Hands-off Live money: no checkboxes, no confirm dialog — Start is the only action.
        if (this.handsOffAgent) {
          this.realOrders = true;
          this.realOrdersAck = true;
        } else if (this.realOrders && !this.realOrdersAck) {
          this.error.set('Tick the confirmation box before starting Live money.');
          return;
        } else if (this.realOrders) {
          const riskBits = [
            this.strictDayStop
              ? `strict day stop −₹${this.strictStopMoneyRs().toLocaleString('en-IN')}`
              : null,
            this.dayProfitLock
              ? `day profit lock +₹${this.profitLockMoneyRs().toLocaleString('en-IN')}`
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

  /** Option target premium proxy — NFO ATM delta. */
  protected optionTargetPremium(open: {
    indexEntry: number;
    indexTarget: number;
    optionEntryPremium: number | null;
    option?: { exchange?: string; tradingSymbol?: string } | null;
  }): number | null {
    if (open.optionEntryPremium == null || open.optionEntryPremium <= 0) {
      return null;
    }
    return computeOptionTargetPremium({
      fillPremium: open.optionEntryPremium,
      indexRewardPts: Math.abs(open.indexTarget - open.indexEntry),
      exchange: open.option?.exchange,
      tradingSymbol: open.option?.tradingSymbol,
    });
  }

  protected fmtTime(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    return ts.replace('T', ' ').slice(0, 16);
  }

  /** HH:MM only — Day column already has the date (stops mobile When wrap). */
  protected fmtClock(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    const norm = ts.replace('T', ' ');
    const m = norm.match(/\b(\d{2}:\d{2})\b/);
    if (m?.[1]) {
      return m[1];
    }
    const slice = norm.slice(11, 16);
    return slice.length === 5 ? slice : '—';
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
        subtitle: `Nifty / Bank · days ${view.weekdayLabel}`,
      },
    );
  }

  /** Quick Testing ranges — short windows (e.g. Jul-only) can look “broken” vs research. */
  protected setTestingRange(daysBack: number): void {
    this.fromDate = shiftDays(-Math.abs(daysBack));
    this.toDate = todayIso();
  }

  /** Single-session Testing = today IST. */
  protected setTestingToday(): void {
    this.fromDate = todayIso();
    this.toDate = todayIso();
  }

  /**
   * One Profit ₹ — option money for Testing and Live (Kite fills overlay on Live money).
   * Research Locked ₹ is a side meter only.
   */
  protected primaryProfitRs(): number {
    const t = this.resultView().totals;
    if (t.optionNetAfterChargesRs != null) {
      return t.optionNetAfterChargesRs;
    }
    return t.optionNetRs ?? 0;
  }

  /** Published Locked index table (Jul ₹65,041) — research side meter. */
  protected lockedResearchRs(): number | null {
    const v = this.resultView().totals.researchLockedNetRs;
    return v == null ? null : v;
  }

  /** Per-trade profit — same basis as primary (net if present). */
  protected tradeProfitRs(t: {
    netOptionPnlRs?: number | null;
    optionPnlRs?: number | null;
  }): number {
    if (t.netOptionPnlRs != null) {
      return t.netOptionPnlRs;
    }
    return t.optionPnlRs ?? 0;
  }

  /** False when option bars missing — do not paint Index SL as a ₹ loss. */
  protected hasTradeProfitRs(t: {
    netOptionPnlRs?: number | null;
    optionPnlRs?: number | null;
  }): boolean {
    return t.netOptionPnlRs != null || t.optionPnlRs != null;
  }

  /**
   * Closed-leg side label — desk always buys the option (long CE/PE).
   * Bare "SELL" next to a PE looked like a short; premium drop then looked "should be green".
   */
  protected optionLegLabel(t: {
    direction: 'BUY' | 'SELL';
    option?: { optionType?: 'CE' | 'PE' | string } | null;
  }): string {
    const ot = (t.option?.optionType ?? '').toUpperCase();
    if (ot === 'CE' || ot === 'PE') {
      return `Long ${ot} · fut ${t.direction}`;
    }
    return t.direction === 'BUY' ? 'Long CE · fut BUY' : 'Long PE · fut SELL';
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

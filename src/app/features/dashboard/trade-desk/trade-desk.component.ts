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
import { AuthService } from '../../../core/auth/auth.service';
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
import {
  computeOptionTargetPremium,
  computeProtectiveSlTrigger,
  optionPremiumDelta,
} from '../../../core/live-desk/option-sl-premium.util';

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
  private readonly auth = inject(AuthService);
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
  /** When true (default), lot inputs are driven by capital — not hand-edited. */
  protected autoLotsFromCapital = true;
  protected capitalPlan: CapitalLotPlan = planLotsForCapital(DEFAULT_TRADING_CAPITAL_RS);
  /** Per-book lots (exchange lot × this). Defaults from capital plan. */
  protected niftyLots = 1;
  protected bankLots = 1;
  protected crudeLots = 1;
  protected natGasLots = 1;

  /** Trade Desk book + risk checkboxes (Testing + Live). All books ON by default. */
  protected enableNifty = true;
  protected enableBank = true;
  protected enableCrude = true;
  /** Off until Nat Gas DNA is fully vetted — opt in for Testing / Live. */
  protected enableNatGas = false;
  /** Combined strict day loss ≈ −₹2,950 × lots — off by default; user must opt in. */
  protected strictDayStop = false;
  /** Combined day profit lock ≈ +₹3,000 × lots (1→₹3k, 3→₹9k) — on by default. */
  protected dayProfitLock = true;
  /** Background Kutty scalp — owner only in UI; off by default (Daily desk). */
  protected enableKutty = false;
  /** Kutty only — no Trap/Strat entries. Off by default. */
  protected kuttyAlone = false;

  /** Owner (Devil) sees Kutty controls; friends do not. */
  protected readonly showKutty = computed(
    () => this.auth.currentUser()?.role === 'owner',
  );
  /** Crude / Nat Gas controls if user has crude module (owner always has it). */
  protected readonly showCrude = computed(() => this.auth.hasModule('crude'));
  protected readonly showNatGas = computed(() => this.auth.hasModule('crude'));

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
        id: 'crude-selective',
        name: 'Selective',
        maxTradesLabel: 'unlimited · SL50/TP200',
      },
      natgas: {
        id: 'natgas-daily-profit-ng',
        name: 'Daily Profit (NG)',
        maxTradesLabel: '1t/day',
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
    this.capitalRs = this.capitalPreference.get();
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
    }
    // Friends: no Kutty. Crude/Nat Gas only if module granted.
    if (!this.showKutty()) {
      this.enableKutty = false;
      this.kuttyAlone = false;
    }
    if (!this.showCrude()) {
      this.enableCrude = false;
    }
    if (!this.showNatGas()) {
      this.enableNatGas = false;
    }
  }

  ngOnDestroy(): void {
    // Do not stopLive — Trade Desk + MCX books must keep polling when you switch tabs.
  }

  /** Capital changed → re-allocate lots (unless Live is already running). */
  protected onCapitalChange(): void {
    this.capitalRs = Math.max(
      10_000,
      Math.floor(Number(this.capitalRs) || DEFAULT_TRADING_CAPITAL_RS),
    );
    this.capitalPreference.set(this.capitalRs);
    if (this.busy() || this.snapshot().running) {
      return;
    }
    this.applyCapitalAllocation();
  }

  protected onAutoLotsToggle(): void {
    if (this.autoLotsFromCapital && !(this.busy() || this.snapshot().running)) {
      this.applyCapitalAllocation();
    }
  }

  protected onLotsChange(book: 'nifty' | 'bank' | 'crude' | 'natgas'): void {
    if (this.autoLotsFromCapital) {
      return;
    }
    if (book === 'nifty') {
      this.niftyLots = Math.max(1, Math.floor(Number(this.niftyLots)) || 1);
      this.lotsPreference.set(this.niftyLots);
    } else if (book === 'bank') {
      this.bankLots = Math.max(1, Math.floor(Number(this.bankLots)) || 1);
    } else if (book === 'natgas') {
      this.natGasLots = Math.max(1, Math.floor(Number(this.natGasLots)) || 1);
    } else {
      this.crudeLots = Math.max(1, Math.floor(Number(this.crudeLots)) || 1);
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
    this.realOrders = true;
    this.realOrdersAck = true;
    this.applyCapitalAllocation();
    this.error.set('');
  }

  /** Size books from total capital. */
  private applyCapitalAllocation(): void {
    const plan = planLotsForCapital(this.capitalRs);
    this.capitalPlan = plan;
    const p = DAILY_3K_DESK_PRESET;
    this.niftyLots = Math.max(1, plan.niftyLots || p.niftyLots);
    this.bankLots = Math.max(1, plan.bankLots > 0 ? plan.bankLots : p.bankLots);
    // All-green plan keeps Crude at 0 lots / off unless user opts in later.
    this.crudeLots = plan.crudeLots > 0 ? plan.crudeLots : 1;
    this.natGasLots = 1;
    this.lotsPreference.set(this.niftyLots);
    this.enableNifty = plan.enableNifty;
    this.enableBank = plan.enableBank;
    this.enableCrude = this.showCrude() && plan.enableCrude && p.enableCrude;
    this.enableNatGas = false;
  }

  protected allocationSummary(): string {
    const bits = [
      this.enableNifty ? `Nifty ×${this.niftyLots}` : null,
      this.enableBank ? `Bank ×${this.bankLots}` : null,
      this.enableCrude && this.showCrude() ? `Crude ×${this.crudeLots}` : null,
    ].filter(Boolean);
    return bits.join(' · ') || 'no books';
  }

  protected hasKiteSession(): boolean {
    return !!this.kiteSession.getAuthorizationHeader();
  }

  private lotsForInstrumentId(instrumentId: string): number {
    const id = instrumentId.toLowerCase();
    if (id.includes('natgas') || id.includes('naturalgas')) {
      return this.natGasLots;
    }
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
    const enableNatGas = this.showNatGas() && this.enableNatGas;
    return {
      lots: this.niftyLots,
      niftyLots: this.niftyLots,
      bankLots: this.bankLots,
      crudeLots: this.crudeLots,
      natGasLots: this.natGasLots,
      enableNifty: this.enableNifty,
      enableBank: this.enableBank,
      enableCrude,
      enableNatGas,
      strictDayStop: this.strictDayStop,
      dayProfitLock: this.dayProfitLock,
      enableKutty,
      kuttyAlone,
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
        ? `Crude Oil Mini ×${this.crudeLots} (Selective · Trap SL50/TP200 · unlimited)`
        : null,
      this.enableNatGas && this.showNatGas()
        ? `Natural Gas Mini ×${this.natGasLots} (Daily Profit NG)`
        : null,
    ].filter(Boolean);
    return parts.join(' + ') || 'none';
  }

  private anyMcxSelected(): boolean {
    return (
      (!!this.enableCrude && this.showCrude()) || (!!this.enableNatGas && this.showNatGas())
    );
  }

  protected async onStart(): Promise<void> {
    this.error.set('');
    if (!this.kiteSession.getAuthorizationHeader()) {
      this.error.set('No Kite session. Open Get Token once, then press Start.');
      return;
    }
    // Hands-off: re-apply the full agent plan every Start (any morning time OK).
    if (this.handsOffAgent && this.mode() === 'live') {
      this.applyCapitalAgentPreset();
    } else {
      this.capitalRs = Math.max(
        10_000,
        Math.floor(Number(this.capitalRs) || DEFAULT_TRADING_CAPITAL_RS),
      );
      this.capitalPreference.set(this.capitalRs);
      if (this.autoLotsFromCapital) {
        this.applyCapitalAllocation();
      }
    }
    if (!this.enableNifty && !this.enableBank && !this.anyMcxSelected()) {
      this.error.set('Agent plan has no books — check capital preference (min ₹10,000).');
      return;
    }

    this.niftyLots = Math.max(1, Math.floor(Number(this.niftyLots)) || 1);
    this.bankLots = Math.max(1, Math.floor(Number(this.bankLots)) || 1);
    this.crudeLots = Math.max(1, Math.floor(Number(this.crudeLots)) || 1);
    this.natGasLots = Math.max(1, Math.floor(Number(this.natGasLots)) || 1);
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
            this.anyMcxSelected() ? 'MCX books continue past 15:15' : null,
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
        natgas: this.natGasLots,
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

  /**
   * Option SL premium proxy — same util as live SL-M.
   * NFO ≈ 0.5Δ; Crude/NatGas MCX ≈ 1.0Δ + min gap (not hardcoded 0.5).
   */
  protected optionStopPremium(open: {
    indexEntry: number;
    indexStop: number;
    optionEntryPremium: number | null;
    option?: { exchange?: string; tradingSymbol?: string } | null;
  }): number | null {
    if (open.optionEntryPremium == null || open.optionEntryPremium <= 0) {
      return null;
    }
    return computeProtectiveSlTrigger({
      fillPremium: open.optionEntryPremium,
      indexRiskPts: Math.abs(open.indexEntry - open.indexStop),
      exchange: open.option?.exchange,
      tradingSymbol: open.option?.tradingSymbol,
    });
  }

  /** Option target premium proxy — exchange-aware delta (MCX 1.0 / NFO 0.5). */
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

  /** UI note: which delta the option SL/target row uses. */
  protected optionDeltaNote(open: {
    option?: { exchange?: string; tradingSymbol?: string } | null;
  }): string {
    const d = optionPremiumDelta(open.option?.exchange, open.option?.tradingSymbol);
    return d >= 1
      ? 'Option SL/Tgt ≈ index pts × 1.0 (MCX Crude/NG — same as live SL-M)'
      : 'Option SL/Tgt ≈ index pts × 0.5 (NFO — same as live SL-M)';
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
        subtitle:
          this.showCrude() || this.showNatGas()
            ? `Nifty / Bank / Crude / Nat Gas paper · days ${view.weekdayLabel}`
            : `Nifty / Bank paper · days ${view.weekdayLabel}`,
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
   * One Profit ₹ — Kite fill money on Live, option premium money on paper/Testing.
   * No Index ₹ / Opt dual numbers in the UI.
   */
  protected primaryProfitRs(): number {
    const t = this.resultView().totals;
    if (t.optionNetAfterChargesRs != null) {
      return t.optionNetAfterChargesRs;
    }
    return t.optionNetRs ?? 0;
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

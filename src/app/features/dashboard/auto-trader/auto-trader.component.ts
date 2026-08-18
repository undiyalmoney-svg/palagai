import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { KiteApiService } from '../../../core/kite/kite-api.service';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { APP_BUILD_LABEL } from '../../../core/config/app-build';
import {
  DEFAULT_TRADING_CAPITAL_RS,
} from '../../../core/paper-desk/capital-plan.util';
import { CapitalPreferenceService } from '../../../core/services/capital-preference.service';
import { DESK_LOTS_CAP, deskLotsForCapital } from './desk-lots.util';

type BankStrategy = 'trap' | 'genie';
/** Live All3 Crude DNA — never send/display "selective" when server is live-crude-green. */
type CrudeStrategy = 'live-crude-green';
type RunStatus = 'running' | 'stopping' | 'stopped' | 'error' | 'unknown';

/** Order-API All3 risk bases (defaults.dayProfitLockRsBase / strictDayStopRsBase). */
const DAY_PROFIT_LOCK_PER_LOT_RS = 2_500;
const STRICT_DAY_STOP_PER_LOT_RS = 2_950;

interface CapitalLotsHint {
  under75k?: number;
  from75k?: number;
  perLakhAbove?: number;
  at6L?: number;
  cap?: number;
  note?: string;
  tradeCounts?: string;
}

interface LiveBooks {
  nifty?: boolean;
  bank?: boolean;
  crude?: boolean;
  bankAllowed?: boolean;
  crudeAllowed?: boolean;
  crudeStrategy?: string;
  crudeWindow?: string;
  crudeAfterIndexClose?: boolean;
  bankOnlyAfterNifty?: boolean;
  label?: string;
  /** Shared lot size — Nifty = Bank = Crude. */
  deskLots?: number;
  niftyLots?: number;
  bankLots?: number;
  crudeLots?: number;
  niftyMaxTradesDay?: number;
  bankMaxTradesDay?: number;
  crudeMaxTradesDay?: number;
  capitalLots?: CapitalLotsHint;
}

interface LivePreset {
  id?: string;
  enableNifty?: boolean;
  enableBank?: boolean;
  enableCrude?: boolean;
  niftyLots?: number;
  bankLots?: number;
  crudeLots?: number;
  niftyMaxTradesDay?: number;
  bankMaxTradesDay?: number;
  crudeMaxTradesDay?: number;
  capitalRs?: number;
  niftyStrategy?: string;
  bankStrategy?: string;
  crudeStrategy?: string;
  crudeAfterIndexClose?: boolean;
  bankOnlyAfterNifty?: boolean;
  paperLivePath?: boolean;
  dayProfitLock?: boolean;
  strictDayStop?: boolean;
  dnaId?: string;
  label?: string;
}

interface LiveRisk {
  riskLots?: number;
  deskLots?: number;
  profitLockMoneyRs?: number;
  strictStopMoneyRs?: number;
  labels?: string[];
  checkboxHint?: string;
  capitalHint?: string;
}

interface LiveDefaults {
  appBuild?: string;
  version?: string;
  preset?: LivePreset;
  books?: LiveBooks;
  uiHint?: string;
  dayProfitLockRsBase?: number;
  strictDayStopRsBase?: number;
  checkboxHint?: string;
}

interface LiveHealth {
  appBuild?: string;
  version?: string;
  crudeAllowed?: boolean;
  bankAllowed?: boolean;
  bankOnlyAfterNifty?: boolean;
  paperLivePath?: boolean;
  crudeDna?: string;
  trapDna?: string;
  liveOps?: unknown;
  research?: unknown;
  defaults?: LivePreset;
  books?: LiveBooks;
}

interface LiveEvent {
  at: string;
  action: string;
  detail: string;
}

interface LiveStatus {
  status: RunStatus;
  message?: string;
  startedAt?: string | null;
  lastHeartbeatAt?: string | null;
  heartbeatAgeSec?: number | null;
  stale?: boolean;
  version?: string;
  appBuild?: string;
  authPresent?: boolean;
  books?: LiveBooks;
  risk?: LiveRisk;
  config?: {
    enableNifty: boolean;
    enableBank: boolean;
    enableCrude: boolean;
    deskLots?: number;
    niftyLots: number;
    bankLots: number;
    crudeLots: number;
    bankStrategy: BankStrategy;
    niftyStrategy: 'trap';
    crudeStrategy: string;
    crudeAfterIndexClose?: boolean;
    bankOnlyAfterNifty?: boolean;
    dayProfitLock?: boolean;
    strictDayStop?: boolean;
    realOrders: boolean;
    capital?: number;
    capitalRs?: number;
    niftyMaxTradesDay?: number;
    bankMaxTradesDay?: number;
    crudeMaxTradesDay?: number;
  } | null;
  events?: LiveEvent[];
  trades?: Array<Record<string, unknown>>;
  totals?: {
    optionNetAfterChargesRs?: number;
    optionNetRs?: number;
    trades?: number;
  };
}

interface OrderCheckLine {
  at: string;
  level: 'info' | 'ok' | 'err';
  message: string;
}

interface BacktestTrade {
  id: string;
  instrumentName: string;
  book?: string;
  direction: 'BUY' | 'SELL';
  entryTime: string;
  exitTime: string;
  exitReason: string;
  option?: { tradingSymbol?: string; optionType?: 'CE' | 'PE' | string } | null;
  optionEntryPremium?: number | null;
  optionExitPremium?: number | null;
  optionPnlRs?: number | null;
  netOptionPnlRs?: number | null;
}

interface BacktestBookRow {
  label: string;
  strategy: string;
  trades: number;
  wins: number;
  losses: number;
  optionNetAfterChargesRs: number;
}

interface BacktestResult {
  fromDate: string;
  toDate: string;
  riskLabels: string[];
  paperLivePath?: boolean;
  books: BacktestBookRow[];
  totals: {
    trades: number;
    wins: number;
    losses: number;
    optionNetRs: number;
    optionNetAfterChargesRs: number;
  };
  dayStats: Array<{ date: string; trades: number; optionNetRs: number }>;
  trades: BacktestTrade[];
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function normalizeCrudeStrategy(raw: unknown): CrudeStrategy {
  // Live All3 always uses live-crude-green — never fall back to selective in UI.
  void raw;
  return 'live-crude-green';
}

function crudeStrategyLabel(raw: unknown): string {
  const s = String(raw || '').toLowerCase();
  if (s === 'live-crude-green' || !s || s === 'selective' || s === 'all-green') {
    // selective/all-green are not live All3 options — always show live-crude-green.
    return 'Crude live-crude-green';
  }
  return `Crude ${s}`;
}

@Component({
  selector: 'app-auto-trader',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatProgressSpinnerModule, RouterLink],
  templateUrl: './auto-trader.component.html',
  styleUrl: './auto-trader.component.css',
})
export class AutoTraderComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly kiteApi = inject(KiteApiService);
  private readonly uiDialog = inject(UiDialogService);
  private readonly capitalPreference = inject(CapitalPreferenceService);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Local UI badge — overridden by server appBuild from /live/health or /live/defaults when available. */
  protected readonly appBuildLabel = APP_BUILD_LABEL;
  protected readonly serverAppBuild = signal('');
  protected readonly serverVersion = signal('');

  /** Same-origin proxy → DO Order-API /live (server-side control plane). */
  private readonly liveApiBase =
    (environment as { liveApiBaseUrl?: string }).liveApiBaseUrl || '/api/live';

  private readonly orderApiBase =
    (environment as { orderApiBaseUrl?: string }).orderApiBaseUrl || '/api/order-kite';

  /** Cheap equity smoke test — same path Trade Desk / Order Test use. */
  private readonly testSymbol = 'RELIANCE';
  private readonly testExchange = 'NSE';

  /**
   * Capital is a starting hint for lots. Each book’s lots are independently editable.
   */
  protected capitalRs = DEFAULT_TRADING_CAPITAL_RS;
  protected capitalDraft = String(DEFAULT_TRADING_CAPITAL_RS);
  /** Risk display — max of the three book lots. */
  protected deskLots = 1;
  protected capitalHint = '';

  /** Risk bases from /live/defaults (fallback to All3 DNA). */
  protected dayProfitLockRsBase = DAY_PROFIT_LOCK_PER_LOT_RS;
  protected strictDayStopRsBase = STRICT_DAY_STOP_PER_LOT_RS;
  protected checkboxHint = '';

  /** All3 books — Nifty Trap → Bank after Nifty → Crude LIVE_CRUDE_GREEN after NSE. */
  protected enableNifty = true;
  protected enableBank = true;
  protected enableCrude = true;
  /** Per-book lots — editable; sent on Start. */
  protected niftyLots = 1;
  protected bankLots = 1;
  protected crudeLots = 1;
  /** 0 = unlimited. N > 0 = max closed trades that book may open today. */
  protected niftyMaxTradesDay = 0;
  protected bankMaxTradesDay = 0;
  protected crudeMaxTradesDay = 4;
  protected tradeCountsHint =
    '0 = unlimited. N > 0 = max closed trades that book may open today. Stop, then Start to apply.';
  /** From /live/defaults|/live/health — controls row visibility (not capital heuristics). */
  protected bankAllowed = true;
  protected crudeAllowed = true;
  protected bankOnlyAfterNifty = true;
  protected crudeAfterIndexClose = true;
  protected paperLivePath = true;
  protected crudeWindow = '16:00–21:00 IST (hard gate 15:15)';
  protected deskLabel = 'All3 · Nifty→Bank→Crude';
  protected deskSupportLine = 'Nifty → Bank (after Nifty) → Crude after NSE';
  protected bankStrategy: BankStrategy = 'trap';
  protected crudeStrategy: CrudeStrategy = 'live-crude-green';
  protected dayProfitLock = true;
  protected strictDayStop = true;

  /**
   * Paper vs Live — same two modes as Trade Desk, both run on the backend:
   *  - paper: server worker fetches data and simulates — no real orders.
   *  - live: DigitalOcean Order-API places real MIS orders.
   */
  protected readonly mode = signal<'paper' | 'live'>('paper');
  protected testQty = 1;

  /** Paper backtest window (IST). */
  protected fromDate = todayIso();
  protected toDate = todayIso();
  protected readonly backtestBusy = signal(false);
  protected readonly backtestError = signal('');
  protected readonly backtest = signal<BacktestResult | null>(null);

  protected readonly busy = signal(false);
  protected readonly orderBusy = signal(false);
  protected readonly lastTestOrderId = signal<string | null>(null);
  protected readonly orderCheckLog = signal<OrderCheckLine[]>([]);
  protected readonly status = signal<LiveStatus>({
    status: 'unknown',
    message: 'Not connected yet',
  });
  /** Merged event stream (status + optional /live/events). */
  protected readonly events = signal<LiveEvent[]>([]);
  protected readonly note = signal(
    'All3 server desk: Nifty Trap → Bank after Nifty → Crude after NSE. Paper≡Live path. Get Token → Push token → Start.',
  );

  protected readonly running = computed(() => this.status().status === 'running');
  protected readonly locked = computed(() => this.busy() || this.running());
  protected readonly authPresent = computed(() => {
    const s = this.status();
    if (s.authPresent != null) {
      return !!s.authPresent;
    }
    return this.hasKiteSession();
  });

  /** Build stamp: prefer live server appBuild so deploy is verifiable. */
  protected readonly displayAppBuild = computed(() => {
    const server = this.serverAppBuild() || this.status().appBuild;
    const ver = this.serverVersion() || this.status().version;
    if (server && ver) {
      return `v${ver} · ${server}`;
    }
    if (server) {
      return String(server);
    }
    return this.appBuildLabel;
  });

  /** Visibility from server allow-flags — not capital heuristics. */
  protected showBankBook(): boolean {
    return this.bankAllowed !== false;
  }

  protected showCrudeBook(): boolean {
    return this.crudeAllowed !== false;
  }

  protected crudeStrategyDisplay(): string {
    const cfg = this.status().config?.crudeStrategy;
    const books = this.status().books?.crudeStrategy;
    return crudeStrategyLabel(cfg || books || this.crudeStrategy);
  }

  /** Crude status chip — ON when config/books say so; never imply off just because before hard gate. */
  protected crudeStatusChip(): string | null {
    if (!this.showCrudeBook()) {
      return 'Crude OFF';
    }
    const s = this.status();
    const on =
      s.config?.enableCrude === true ||
      s.books?.crude === true ||
      this.enableCrude;
    if (!on) {
      return null;
    }
    const window = this.crudeWindow || 'hard gate 15:15';
    return `Crude ON · ${window}`;
  }

  /** Client-side capital → deskLots preview (same as server). */
  protected capitalLotsPreview(): number {
    return deskLotsForCapital(this.capitalRs);
  }

  /** Resolved capital ₹ while running (server config) or local draft. */
  protected displayCapitalRs(): number {
    const cfg = this.status().config;
    if (this.running() && cfg) {
      const cap = Math.floor(Number(cfg.capitalRs ?? cfg.capital) || 0);
      if (cap > 0) {
        return cap;
      }
    }
    return this.capitalRs;
  }

  protected deskLotsHelper(): string {
    const hint = this.status().risk?.capitalHint || this.capitalHint;
    if (hint) {
      return hint;
    }
    return `Lots are per book (editable). Capital hint ₹40k→1 · ₹4L→4 · ₹6L→6 · cap 10. Stop → Start to apply.`;
  }

  private formatCapitalLotsHint(c: CapitalLotsHint): string {
    if (c.note) {
      return String(c.note);
    }
    return `deskLots ladder: <75k→${c.under75k ?? 1} · ≥75k→${c.from75k ?? 2}+ · ₹6L→${c.at6L ?? 6} · cap ${c.cap ?? 10}`;
  }

  /** Integers ≥ 0. Empty/invalid → fallback (0 = unlimited). */
  private asIntMin0(value: unknown, fallback: number): number {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0) {
      return fallback;
    }
    return n;
  }

  /** Lots ≥ 1, capped at deskLots ladder max. */
  private asIntMin1(value: unknown, fallback: number): number {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) {
      return Math.max(1, Math.min(DESK_LOTS_CAP, Math.floor(Number(fallback)) || 1));
    }
    return Math.min(DESK_LOTS_CAP, n);
  }

  protected tradeCountLabel(n: number): string {
    return n <= 0 ? 'unlimited' : String(n);
  }

  /** Switch Paper ⇆ Live (blocked while a server session is running). */
  protected setMode(next: 'paper' | 'live'): void {
    if (this.locked()) {
      return;
    }
    this.mode.set(next);
  }

  ngOnInit(): void {
    this.capitalRs = this.capitalPreference.get() || DEFAULT_TRADING_CAPITAL_RS;
    if (this.capitalRs < 10_000) {
      this.capitalRs = DEFAULT_TRADING_CAPITAL_RS;
    }
    this.capitalDraft = String(this.capitalRs);
    this.applyCapitalAllocation({ armAllowedBooks: true });
    this.seedLotsFromCapital();
    void this.loadLiveDefaults();
    void this.refreshStatus();
    this.pollTimer = setInterval(() => void this.refreshStatus(), 15_000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Commit capital on blur / Enter only — never while typing (keeps field editable). */
  protected commitCapital(): void {
    const parsed = Math.floor(Number(String(this.capitalDraft).replace(/[,_\s]/g, '')));
    const next = Math.max(
      10_000,
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TRADING_CAPITAL_RS,
    );
    const prev = this.capitalRs;
    this.capitalRs = next;
    this.capitalDraft = String(next);
    this.capitalPreference.set(next);
    this.applyCapitalAllocation();
    if (this.running() && prev !== next) {
      this.note.set(
        `Capital saved at ₹${next}. Lots stay as typed — Stop → Start to apply (START_IGNORED while running).`,
      );
    }
  }

  protected onCapitalDraftChange(raw: string): void {
    this.capitalDraft = raw;
  }

  /** Seed all three books from the capital ladder (initial / defaults only). */
  private seedLotsFromCapital(): void {
    const n = deskLotsForCapital(this.capitalRs);
    this.niftyLots = n;
    this.bankLots = n;
    this.crudeLots = n;
    this.deskLots = n;
  }

  private refreshDeskLots(): void {
    this.deskLots = Math.max(
      1,
      this.asIntMin1(this.niftyLots, 1),
      this.asIntMin1(this.bankLots, 1),
      this.asIntMin1(this.crudeLots, 1),
    );
  }

  /**
   * Arm allowed books. Does not overwrite typed lots.
   * Never hard-hide Crude for low capital.
   */
  private applyCapitalAllocation(opts?: { armAllowedBooks?: boolean }): void {
    this.enableNifty = true;

    if (this.bankAllowed !== false) {
      if (opts?.armAllowedBooks) {
        this.enableBank = true;
      }
    } else {
      this.enableBank = false;
    }

    if (this.crudeAllowed !== false) {
      // Server forces Crude ON when crudeAllowed — keep checked even at low capital.
      this.enableCrude = true;
    } else {
      this.enableCrude = false;
    }
  }

  /**
   * Books summary — while running, prefer resolved status.config per-book lots.
   */
  protected allocationSummary(): string {
    const cfg = this.status().config;
    if (this.running() && cfg) {
      const n = this.asIntMin1(cfg.niftyLots, this.niftyLots);
      const b = this.asIntMin1(cfg.bankLots, this.bankLots);
      const c = this.asIntMin1(cfg.crudeLots, this.crudeLots);
      const bits = [
        cfg.enableNifty !== false ? `N${n}` : null,
        cfg.enableBank ? `B${b}` : this.showBankBook() && this.enableBank ? `B${b}` : null,
        cfg.enableCrude ? `C${c}` : this.showCrudeBook() && this.enableCrude ? `C${c}` : null,
      ].filter(Boolean);
      return bits.join('/');
    }
    return `N${this.asIntMin1(this.niftyLots, 1)}/B${this.asIntMin1(this.bankLots, 1)}/C${this.asIntMin1(this.crudeLots, 1)}`;
  }

  protected hasKiteSession(): boolean {
    return !!this.kiteSession.getAuthorizationHeader();
  }

  protected deskRiskLots(): number {
    const risk = this.status().risk;
    if (risk?.deskLots && risk.deskLots > 0) {
      return risk.deskLots;
    }
    if (risk?.riskLots && risk.riskLots > 0) {
      return risk.riskLots;
    }
    if (this.running() && this.status().config) {
      const cfg = this.status().config!;
      return Math.max(
        1,
        this.asIntMin1(cfg.niftyLots, this.niftyLots),
        this.asIntMin1(cfg.bankLots, this.bankLots),
        this.asIntMin1(cfg.crudeLots, this.crudeLots),
      );
    }
    return Math.max(
      1,
      this.asIntMin1(this.niftyLots, 1),
      this.asIntMin1(this.bankLots, 1),
      this.asIntMin1(this.crudeLots, 1),
    );
  }

  protected profitLockMoneyRs(): number {
    const risk = this.status().risk;
    if (risk?.profitLockMoneyRs != null && risk.profitLockMoneyRs > 0) {
      return risk.profitLockMoneyRs;
    }
    return this.dayProfitLockRsBase * this.deskRiskLots();
  }

  protected strictStopMoneyRs(): number {
    const risk = this.status().risk;
    if (risk?.strictStopMoneyRs != null && risk.strictStopMoneyRs > 0) {
      return risk.strictStopMoneyRs;
    }
    return this.strictDayStopRsBase * this.deskRiskLots();
  }

  protected riskLabels(): string[] {
    const risk = this.status().risk;
    if (risk?.labels?.length) {
      return [...risk.labels];
    }
    const parts: string[] = [];
    if (this.strictDayStop) {
      parts.push(`strict −₹${this.strictStopMoneyRs().toLocaleString('en-IN')}`);
    }
    if (this.dayProfitLock) {
      parts.push(`profit lock +₹${this.profitLockMoneyRs().toLocaleString('en-IN')} (option ₹)`);
    }
    if (this.bankOnlyAfterNifty) {
      parts.push('Bank after Nifty');
    }
    if (this.paperLivePath) {
      parts.push('Paper≡Live');
    }
    return parts;
  }

  protected riskStripText(): string {
    const risk = this.status().risk;
    const capitalHint = risk?.capitalHint || this.capitalHint;
    const hint = risk?.checkboxHint || this.checkboxHint;
    const labels = this.riskLabels().join(' · ');
    const bits = [labels, capitalHint, hint].filter(Boolean);
    return bits.join(' · ');
  }

  // ── Paper backtest ──
  protected setTestingToday(): void {
    this.fromDate = todayIso();
    this.toDate = todayIso();
  }

  protected setTestingRange(daysBack: number): void {
    this.fromDate = shiftDays(-Math.abs(daysBack));
    this.toDate = todayIso();
  }

  protected primaryProfitRs(): number {
    const t = this.backtest()?.totals;
    if (!t) {
      return 0;
    }
    return t.optionNetAfterChargesRs ?? t.optionNetRs ?? 0;
  }

  protected tradeProfitRs(t: BacktestTrade): number {
    if (t.netOptionPnlRs != null) {
      return t.netOptionPnlRs;
    }
    return t.optionPnlRs ?? 0;
  }

  protected hasTradeProfitRs(t: BacktestTrade): boolean {
    return t.netOptionPnlRs != null || t.optionPnlRs != null;
  }

  protected tradeBookLabel(t: BacktestTrade): string {
    const raw = String(t.book || t.instrumentName || '').toLowerCase();
    if (raw.includes('crude')) {
      return 'Crude';
    }
    if (raw.includes('bank')) {
      return 'Bank';
    }
    if (raw.includes('nifty') || raw.includes('nse:n')) {
      return 'Nifty';
    }
    if (t.book) {
      return String(t.book);
    }
    return t.instrumentName || '—';
  }

  protected bookStrategyLabel(book: BacktestBookRow): string {
    const label = String(book.label || '').toLowerCase();
    const strat = String(book.strategy || '').toLowerCase();
    if (label.includes('crude') || strat.includes('crude')) {
      return crudeStrategyLabel(book.strategy);
    }
    if (strat === 'trap' || !strat) {
      return 'Trap';
    }
    return book.strategy;
  }

  protected optionLegLabel(t: BacktestTrade): string {
    const ot = (t.option?.optionType ?? '').toUpperCase();
    if (ot === 'CE' || ot === 'PE') {
      return `Long ${ot} · fut ${t.direction}`;
    }
    return t.direction === 'BUY' ? 'Long CE · fut BUY' : 'Long PE · fut SELL';
  }

  protected fmtClock(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    const norm = String(ts).replace('T', ' ');
    const m = norm.match(/\b(\d{2}:\d{2})\b/);
    return m?.[1] ?? (norm.slice(11, 16) || '—');
  }

  protected fmtDay(ts: string | null | undefined): string {
    return ts ? String(ts).slice(0, 10) : '—';
  }

  protected eventActionClass(action: string): string {
    return String(action || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'UNKNOWN';
  }

  protected isNotableEvent(e: LiveEvent): boolean {
    const action = String(e.action || '').toUpperCase();
    return (
      action === 'CRUDE_ON' ||
      action === 'ENTRY' ||
      action === 'EXIT' ||
      action === 'SKIP' ||
      action === 'ERROR' ||
      action === 'START_IGNORED' ||
      action === 'AUTH_WAIT' ||
      action === 'BANK_OFF'
    );
  }

  /**
   * Start payload — send per-book lots and max trades with capitalRs.
   * Never send crudeStrategy: "selective".
   */
  private buildLivePayload(realOrders: boolean): Record<string, unknown> {
    const enableCrude = this.showCrudeBook() ? true : !!this.enableCrude;
    const enableBank = this.showBankBook() ? !!this.enableBank : false;
    const niftyLots = this.asIntMin1(this.niftyLots, 1);
    const bankLots = this.asIntMin1(this.bankLots, 1);
    const crudeLots = this.asIntMin1(this.crudeLots, 1);
    this.niftyLots = niftyLots;
    this.bankLots = bankLots;
    this.crudeLots = crudeLots;
    this.refreshDeskLots();

    return {
      realOrders,
      capitalRs: this.capitalRs,
      capital: this.capitalRs,
      enableNifty: true,
      enableBank,
      enableCrude,
      niftyLots,
      bankLots,
      crudeLots,
      niftyMaxTradesDay: this.asIntMin0(this.niftyMaxTradesDay, 0),
      bankMaxTradesDay: this.asIntMin0(this.bankMaxTradesDay, 0),
      crudeMaxTradesDay: this.asIntMin0(this.crudeMaxTradesDay, 4),
      dayProfitLock: this.dayProfitLock,
      strictDayStop: this.strictDayStop,
      crudeAfterIndexClose: this.crudeAfterIndexClose !== false,
      bankOnlyAfterNifty: this.bankOnlyAfterNifty !== false,
      crudeStrategy: 'live-crude-green',
      bankStrategy: this.bankStrategy === 'genie' ? 'genie' : 'trap',
      niftyStrategy: 'trap',
    };
  }

  /** Pull All3 preset / books / appBuild from Order-API. */
  private async loadLiveDefaults(): Promise<void> {
    try {
      const [defaults, health] = await Promise.all([
        firstValueFrom(this.http.get<LiveDefaults>(`${this.liveApiBase}/defaults`)).catch(
          () => null,
        ),
        firstValueFrom(this.http.get<LiveHealth>(`${this.liveApiBase}/health`)).catch(() => null),
      ]);

      const preset = defaults?.preset ?? health?.defaults ?? null;
      const books = defaults?.books ?? health?.books ?? null;

      if (defaults?.appBuild || health?.appBuild) {
        this.serverAppBuild.set(String(defaults?.appBuild || health?.appBuild));
      }
      if (defaults?.version || health?.version) {
        this.serverVersion.set(String(defaults?.version || health?.version));
      }

      if (defaults?.dayProfitLockRsBase != null && defaults.dayProfitLockRsBase > 0) {
        this.dayProfitLockRsBase = defaults.dayProfitLockRsBase;
      }
      if (defaults?.strictDayStopRsBase != null && defaults.strictDayStopRsBase > 0) {
        this.strictDayStopRsBase = defaults.strictDayStopRsBase;
      }
      if (defaults?.checkboxHint) {
        this.checkboxHint = String(defaults.checkboxHint);
      }

      if (health?.bankAllowed != null) {
        this.bankAllowed = health.bankAllowed !== false;
      } else if (books?.bankAllowed != null) {
        this.bankAllowed = books.bankAllowed !== false;
      }

      if (health?.crudeAllowed != null) {
        this.crudeAllowed = health.crudeAllowed !== false;
      } else if (books?.crudeAllowed != null) {
        this.crudeAllowed = books.crudeAllowed !== false;
      }

      if (health?.bankOnlyAfterNifty != null) {
        this.bankOnlyAfterNifty = health.bankOnlyAfterNifty !== false;
      } else if (books?.bankOnlyAfterNifty != null) {
        this.bankOnlyAfterNifty = books.bankOnlyAfterNifty !== false;
      } else if (preset?.bankOnlyAfterNifty != null) {
        this.bankOnlyAfterNifty = preset.bankOnlyAfterNifty !== false;
      }

      if (preset?.crudeAfterIndexClose != null) {
        this.crudeAfterIndexClose = preset.crudeAfterIndexClose !== false;
      } else if (books?.crudeAfterIndexClose != null) {
        this.crudeAfterIndexClose = books.crudeAfterIndexClose !== false;
      }

      if (health?.paperLivePath != null) {
        this.paperLivePath = !!health.paperLivePath;
      } else if (preset?.paperLivePath != null) {
        this.paperLivePath = !!preset.paperLivePath;
      }

      if (books?.crudeWindow) {
        this.crudeWindow = String(books.crudeWindow);
      }

      if (books?.capitalLots) {
        this.capitalHint = this.formatCapitalLotsHint(books.capitalLots);
        const countsHint = books.capitalLots.tradeCounts?.trim();
        if (countsHint) {
          this.tradeCountsHint = countsHint;
        }
      }
      if (defaults?.uiHint) {
        // Keep as note hint once; don't overwrite active session notes every poll.
      }

      const label = preset?.label || books?.label;
      if (label) {
        this.deskLabel = String(label);
      }
      if (books?.label) {
        this.deskSupportLine = String(books.label);
      } else {
        this.deskSupportLine = 'Nifty → Bank (after Nifty) → Crude after NSE';
      }

      if (preset) {
        this.enableNifty = preset.enableNifty !== false;
        this.enableBank = this.bankAllowed ? preset.enableBank !== false : false;
        this.enableCrude = this.crudeAllowed ? preset.enableCrude !== false : false;
        if (this.crudeAllowed && preset.enableCrude == null) {
          this.enableCrude = true;
        }
        this.crudeStrategy = normalizeCrudeStrategy(preset.crudeStrategy ?? books?.crudeStrategy);
        this.dayProfitLock = preset.dayProfitLock !== false;
        this.strictDayStop = preset.strictDayStop !== false;
        if (preset.bankStrategy === 'genie') {
          this.bankStrategy = 'genie';
        }
      } else if (this.crudeAllowed) {
        this.enableCrude = true;
        this.crudeStrategy = 'live-crude-green';
      }

      if (books?.crudeStrategy) {
        this.crudeStrategy = normalizeCrudeStrategy(books.crudeStrategy);
      }

      this.niftyMaxTradesDay = this.asIntMin0(
        books?.niftyMaxTradesDay ?? preset?.niftyMaxTradesDay,
        0,
      );
      this.bankMaxTradesDay = this.asIntMin0(
        books?.bankMaxTradesDay ?? preset?.bankMaxTradesDay,
        0,
      );
      this.crudeMaxTradesDay = this.asIntMin0(
        books?.crudeMaxTradesDay ?? preset?.crudeMaxTradesDay,
        4,
      );

      this.applyCapitalAllocation({ armAllowedBooks: true });
      const fallbackLots = deskLotsForCapital(this.capitalRs);
      this.niftyLots = this.asIntMin1(
        books?.niftyLots ?? preset?.niftyLots ?? this.niftyLots,
        fallbackLots,
      );
      this.bankLots = this.asIntMin1(
        books?.bankLots ?? preset?.bankLots ?? this.bankLots,
        fallbackLots,
      );
      this.crudeLots = this.asIntMin1(
        books?.crudeLots ?? preset?.crudeLots ?? this.crudeLots,
        fallbackLots,
      );
      this.refreshDeskLots();
    } catch {
      if (this.crudeAllowed) {
        this.enableCrude = true;
      }
    }
  }

  protected async runBacktest(): Promise<void> {
    this.backtestError.set('');
    if (!this.fromDate || !this.toDate || this.fromDate > this.toDate) {
      this.backtestError.set('Pick a valid From → To range.');
      return;
    }
    this.commitCapital();
    this.applyCapitalAllocation();
    if (!this.enableNifty && !this.enableBank && !this.enableCrude) {
      this.backtestError.set('Desk plan has no books — check capital (min ₹10,000).');
      return;
    }
    const kite = this.kiteSession.getAuthorizationHeader();
    const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};
    this.backtestBusy.set(true);
    try {
      const body = {
        ...this.buildLivePayload(false),
        fromDate: this.fromDate,
        toDate: this.toDate,
      };
      delete (body as { realOrders?: boolean }).realOrders;
      const res = await firstValueFrom(
        this.http.post<BacktestResult>(`${this.liveApiBase}/backtest`, body, { headers }),
      );
      this.backtest.set(res);
      if (res.paperLivePath != null) {
        this.paperLivePath = !!res.paperLivePath;
      }
      this.note.set(
        `Paper backtest ${res.fromDate} → ${res.toDate}: ${res.totals.trades} trades · net ₹${res.totals.optionNetAfterChargesRs.toLocaleString('en-IN')} (Paper≡Live).`,
      );
    } catch (err) {
      const backendMsg = (err as { error?: { message?: string } })?.error?.message;
      this.backtestError.set(backendMsg || formatUnknownError(err, 'Backtest'));
    } finally {
      this.backtestBusy.set(false);
    }
  }

  protected async refreshStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<LiveStatus>(`${this.liveApiBase}/status`),
      );
      this.status.set(res);
      if (res.appBuild) {
        this.serverAppBuild.set(String(res.appBuild));
      }
      if (res.version) {
        this.serverVersion.set(String(res.version));
      }
      if (res.books) {
        if (res.books.bankAllowed != null) {
          this.bankAllowed = res.books.bankAllowed !== false;
        }
        if (res.books.crudeAllowed != null) {
          this.crudeAllowed = res.books.crudeAllowed !== false;
        }
        if (res.books.bankOnlyAfterNifty != null) {
          this.bankOnlyAfterNifty = res.books.bankOnlyAfterNifty !== false;
        }
        if (res.books.crudeAfterIndexClose != null) {
          this.crudeAfterIndexClose = res.books.crudeAfterIndexClose !== false;
        }
        if (res.books.crudeWindow) {
          this.crudeWindow = String(res.books.crudeWindow);
        }
        if (res.books.label) {
          this.deskSupportLine = String(res.books.label);
        }
        if (res.books.crudeStrategy) {
          this.crudeStrategy = normalizeCrudeStrategy(res.books.crudeStrategy);
        }
        if (res.books.capitalLots) {
          this.capitalHint = this.formatCapitalLotsHint(res.books.capitalLots);
        }
      }
      if (res.risk?.capitalHint) {
        this.capitalHint = String(res.risk.capitalHint);
      }
      // Mirror running server config (source of truth) — per-book lots.
      if (res.config && res.status === 'running') {
        this.enableNifty = !!res.config.enableNifty;
        this.enableBank = !!res.config.enableBank;
        this.enableCrude = !!res.config.enableCrude;
        this.niftyLots = this.asIntMin1(res.config.niftyLots, this.niftyLots);
        this.bankLots = this.asIntMin1(res.config.bankLots, this.bankLots);
        this.crudeLots = this.asIntMin1(res.config.crudeLots, this.crudeLots);
        this.refreshDeskLots();
        if (res.config.niftyMaxTradesDay != null) {
          this.niftyMaxTradesDay = this.asIntMin0(res.config.niftyMaxTradesDay, 0);
        }
        if (res.config.bankMaxTradesDay != null) {
          this.bankMaxTradesDay = this.asIntMin0(res.config.bankMaxTradesDay, 0);
        }
        if (res.config.crudeMaxTradesDay != null) {
          this.crudeMaxTradesDay = this.asIntMin0(res.config.crudeMaxTradesDay, 4);
        }
        this.bankStrategy = res.config.bankStrategy === 'genie' ? 'genie' : 'trap';
        this.crudeStrategy = normalizeCrudeStrategy(res.config.crudeStrategy);
        this.dayProfitLock = res.config.dayProfitLock !== false;
        this.strictDayStop = res.config.strictDayStop !== false;
        if (res.config.bankOnlyAfterNifty != null) {
          this.bankOnlyAfterNifty = res.config.bankOnlyAfterNifty !== false;
        }
        if (res.config.crudeAfterIndexClose != null) {
          this.crudeAfterIndexClose = res.config.crudeAfterIndexClose !== false;
        }
        if (res.config.capitalRs != null || res.config.capital != null) {
          const cap = Math.floor(Number(res.config.capitalRs ?? res.config.capital) || 0);
          if (cap >= 10_000) {
            this.capitalRs = cap;
            this.capitalDraft = String(cap);
          }
        }
        this.mode.set(res.config.realOrders ? 'live' : 'paper');
      }

      // Prefer status.events; merge /live/events when useful.
      if (res.events?.length) {
        this.events.set(res.events);
      } else if (res.status === 'running') {
        await this.refreshEvents();
      } else {
        this.events.set([]);
      }
    } catch {
      this.status.set({
        status: 'unknown',
        message:
          'Live API unreachable. Start Order-API with /live routes (existing Kite order APIs untouched).',
        lastHeartbeatAt: null,
        stale: true,
      });
    }
  }

  /** Optional fuller stream from GET /live/events. */
  private async refreshEvents(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ events?: LiveEvent[] } | LiveEvent[]>(`${this.liveApiBase}/events`),
      );
      const list = Array.isArray(res) ? res : res?.events;
      if (list?.length) {
        this.events.set(list);
      }
    } catch {
      // status.events already applied when present
    }
  }

  protected async start(): Promise<void> {
    if (this.running()) {
      this.note.set('Already running — Stop first to change books/lots/trade counts (START_IGNORED).');
      return;
    }
    this.commitCapital();
    this.applyCapitalAllocation();
    if (!this.enableNifty && !this.enableBank && !this.enableCrude) {
      this.note.set('Desk plan has no books — check capital (min ₹10,000).');
      return;
    }
    const realOrders = this.mode() === 'live';
    if (realOrders && !this.authPresent()) {
      this.note.set(
        'Push Kite token to server first (authPresent=false). Get Token → Push Kite token to server → Start.',
      );
      return;
    }
    if (realOrders) {
      const riskBits = this.riskLabels().join(' · ');
      const ok = await this.uiDialog.confirm({
        title: 'Start server LIVE with real money?',
        message:
          `Real Kite MIS via DigitalOcean Order-API.\n` +
          `Books: ${this.allocationSummary()} · ${this.deskLabel}.\n` +
          `Lots: Nifty ${this.asIntMin1(this.niftyLots, 1)} · Bank ${this.asIntMin1(this.bankLots, 1)} · Crude ${this.asIntMin1(this.crudeLots, 1)}.\n` +
          `Crude: live-crude-green · 1 lot = Kite qty 1 (MCX).\n` +
          `Path: ${this.deskSupportLine}.\n` +
          `Max trades today: Nifty ${this.tradeCountLabel(this.niftyMaxTradesDay)} · Bank ${this.tradeCountLabel(this.bankMaxTradesDay)} · Crude ${this.tradeCountLabel(this.crudeMaxTradesDay)}.\n` +
          (riskBits ? `Risk: ${riskBits}.\n` : '') +
          `\nChrome can close — the server worker keeps scanning.`,
        confirmLabel: 'Start live',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) {
        return;
      }
    }
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ status?: string; message?: string; ignored?: boolean }>(
          `${this.liveApiBase}/start`,
          this.buildLivePayload(realOrders),
        ),
      );
      const msg = res?.message || '';
      if (
        res?.ignored ||
        /START_IGNORED|already running/i.test(msg) ||
        /START_IGNORED/i.test(String(res?.status || ''))
      ) {
        this.note.set(msg || 'START_IGNORED — Stop first to change books/lots.');
      } else {
        this.note.set(
          `Server ${realOrders ? 'LIVE' : 'PAPER'} started — All3 worker on DO. Watch ENTRY / SKIP / ERROR (SIGNAL alone ≠ order).`,
        );
      }
      await this.refreshStatus();
    } catch (err) {
      const backendMsg = (err as { error?: { message?: string; code?: string } })?.error?.message;
      const code = (err as { error?: { code?: string } })?.error?.code;
      if (code === 'START_IGNORED' || /START_IGNORED|already running/i.test(backendMsg || '')) {
        this.note.set(backendMsg || 'START_IGNORED — Stop first to change books/lots.');
      } else {
        this.note.set(`Start failed: ${backendMsg || formatUnknownError(err, 'Start')}`);
      }
      await this.refreshStatus();
    } finally {
      this.busy.set(false);
    }
  }

  protected async stop(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post(`${this.liveApiBase}/stop`, {}));
      this.note.set('Stop requested. Change lots, then Start again.');
      await this.refreshStatus();
    } catch (err) {
      this.note.set(`Stop failed: ${formatUnknownError(err, 'Stop')}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected async pushKiteAuth(): Promise<void> {
    const session = this.kiteSession.getSession();
    const apiKey = session?.data.api_key;
    const accessToken = session?.data.access_token;
    if (!apiKey || !accessToken) {
      this.note.set('No Kite session in this browser. Open Get Token first.');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.put(`${this.liveApiBase}/auth`, {
          apiKey,
          accessToken,
        }),
      );
      this.note.set('Kite token pushed to server (encrypted in Mongo).');
      await this.refreshStatus();
    } catch (err) {
      this.note.set(`Auth push failed: ${formatUnknownError(err, 'Auth')}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected fmtTime(ts: string | null | undefined): string {
    if (!ts) {
      return '—';
    }
    return ts.replace('T', ' ').slice(0, 16);
  }

  protected async pingOrderApi(): Promise<void> {
    this.orderBusy.set(true);
    this.pushOrderLog('info', `GET ${this.orderApiBase}/health`);
    try {
      const res = await firstValueFrom(this.kiteApi.pingOrderBackend());
      this.pushOrderLog('ok', `Order-API health OK · ${JSON.stringify(res)}`);
    } catch (err) {
      this.pushOrderLog('err', this.fmtOrderErr(err));
    } finally {
      this.orderBusy.set(false);
    }
  }

  protected async pingLiveHealth(): Promise<void> {
    this.orderBusy.set(true);
    this.pushOrderLog('info', `GET ${this.liveApiBase}/health`);
    try {
      const res = await firstValueFrom(this.http.get<LiveHealth>(`${this.liveApiBase}/health`));
      if (res.appBuild) {
        this.serverAppBuild.set(String(res.appBuild));
      }
      if (res.version) {
        this.serverVersion.set(String(res.version));
      }
      if (res.crudeAllowed != null) {
        this.crudeAllowed = res.crudeAllowed !== false;
      }
      if (res.bankAllowed != null) {
        this.bankAllowed = res.bankAllowed !== false;
      }
      this.pushOrderLog('ok', `Live health OK · ${JSON.stringify(res)}`);
    } catch (err) {
      this.pushOrderLog('err', this.fmtOrderErr(err));
    } finally {
      this.orderBusy.set(false);
    }
  }

  protected async placeTestBuy(): Promise<void> {
    const qty = Math.max(1, Math.floor(Number(this.testQty)) || 1);
    const ok = await this.uiDialog.confirm({
      title: 'Place real test MARKET BUY?',
      message: `${this.testExchange}:${this.testSymbol}\nQty ${qty} · MIS\n\nUses existing Order-API (static IP). Flatten with Test SELL after.`,
      confirmLabel: 'Place buy',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) {
      return;
    }
    const authorization = this.requireAuth();
    if (!authorization) {
      return;
    }
    this.orderBusy.set(true);
    this.pushOrderLog(
      'info',
      `TEST BUY ${this.testExchange}:${this.testSymbol} qty=${qty} MIS via ${this.orderApiBase}`,
    );
    try {
      const res = (await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: this.testExchange,
          tradingsymbol: this.testSymbol,
          transaction_type: 'BUY',
          order_type: 'MARKET',
          quantity: String(qty),
          product: 'MIS',
          validity: 'DAY',
          market_protection: '-1',
          tag: 'PALAGAI_AT',
        }),
      )) as { data?: { order_id?: string }; status?: string; message?: string };
      const orderId = res?.data?.order_id ?? null;
      this.lastTestOrderId.set(orderId);
      this.pushOrderLog('ok', `BUY response: ${JSON.stringify(res)}`);
      if (orderId) {
        this.pushOrderLog('ok', `Order id ${orderId} — path works if Kite status is success`);
      }
    } catch (err) {
      this.pushOrderLog('err', this.fmtOrderErr(err));
    } finally {
      this.orderBusy.set(false);
    }
  }

  protected async placeTestSell(): Promise<void> {
    const qty = Math.max(1, Math.floor(Number(this.testQty)) || 1);
    const ok = await this.uiDialog.confirm({
      title: 'Place real test MARKET SELL?',
      message: `${this.testExchange}:${this.testSymbol}\nQty ${qty} · MIS\n\nUse to flatten the test buy.`,
      confirmLabel: 'Place sell',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) {
      return;
    }
    const authorization = this.requireAuth();
    if (!authorization) {
      return;
    }
    this.orderBusy.set(true);
    this.pushOrderLog(
      'info',
      `TEST SELL ${this.testExchange}:${this.testSymbol} qty=${qty} MIS via ${this.orderApiBase}`,
    );
    try {
      const res = (await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: this.testExchange,
          tradingsymbol: this.testSymbol,
          transaction_type: 'SELL',
          order_type: 'MARKET',
          quantity: String(qty),
          product: 'MIS',
          validity: 'DAY',
          market_protection: '-1',
          tag: 'PALAGAI_AT',
        }),
      )) as { data?: { order_id?: string } };
      const orderId = res?.data?.order_id ?? null;
      this.lastTestOrderId.set(orderId);
      this.pushOrderLog('ok', `SELL response: ${JSON.stringify(res)}`);
    } catch (err) {
      this.pushOrderLog('err', this.fmtOrderErr(err));
    } finally {
      this.orderBusy.set(false);
    }
  }

  private requireAuth(): string | null {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      this.pushOrderLog('err', 'No Kite session — open Get Token first');
      return null;
    }
    return authorization;
  }

  private pushOrderLog(level: OrderCheckLine['level'], message: string): void {
    const at = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    });
    this.orderCheckLog.update((rows) => [{ at, level, message }, ...rows].slice(0, 40));
  }

  private fmtOrderErr(err: unknown): string {
    const msg = formatUnknownError(err, 'Order check');
    if (/Failed to fetch|NetworkError|ERR_CONNECTION|mixed content/i.test(msg)) {
      return `${msg} · Check /api/order-kite reaches the droplet.`;
    }
    return msg;
  }
}

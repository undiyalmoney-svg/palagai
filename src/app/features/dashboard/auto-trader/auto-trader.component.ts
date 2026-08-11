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
  CapitalLotPlan,
  DEFAULT_TRADING_CAPITAL_RS,
  planLotsForCapital,
} from '../../../core/paper-desk/capital-plan.util';
import { CapitalPreferenceService } from '../../../core/services/capital-preference.service';

type BankStrategy = 'trap' | 'genie';
type CrudeStrategy = 'live-crude-green' | 'selective' | 'all-green';
type RunStatus = 'running' | 'stopping' | 'stopped' | 'error' | 'unknown';

/** Same ₹ bands as Trade Desk + Order-API daily-desk-defaults (1-lot base). */
const DAY_PROFIT_LOCK_PER_LOT_RS = 3_000;
const STRICT_DAY_STOP_PER_LOT_RS = 2_950;
/** Same option-₹ stand-down as Trade Desk / Order-API (doc 51). */
const OPTION_DAY_LOSS_PER_LOT_RS = 350;

/** Server All3 capital ladder (one-leg: same capital rotates across books). */
const ALL3_LOTS_CAPITAL_2X_RS = 75_000;

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
}

interface LivePreset {
  enableNifty?: boolean;
  enableBank?: boolean;
  enableCrude?: boolean;
  niftyLots?: number;
  bankLots?: number;
  crudeLots?: number;
  crudeStrategy?: CrudeStrategy | string;
  crudeAfterIndexClose?: boolean;
  bankOnlyAfterNifty?: boolean;
  paperLivePath?: boolean;
  dayProfitLock?: boolean;
  strictDayStop?: boolean;
  dnaId?: string;
  label?: string;
}

interface LiveDefaults {
  appBuild?: string;
  version?: string;
  preset?: LivePreset;
  books?: LiveBooks;
  uiHint?: string;
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
  defaults?: LivePreset;
  books?: LiveBooks;
}

interface LiveStatus {
  status: RunStatus;
  message?: string;
  lastHeartbeatAt?: string | null;
  heartbeatAgeSec?: number | null;
  stale?: boolean;
  appBuild?: string;
  books?: LiveBooks;
  config?: {
    enableNifty: boolean;
    enableBank: boolean;
    enableCrude: boolean;
    niftyLots: number;
    bankLots: number;
    crudeLots: number;
    bankStrategy: BankStrategy;
    niftyStrategy: 'trap';
    crudeStrategy: CrudeStrategy;
    crudeAfterIndexClose?: boolean;
    bankOnlyAfterNifty?: boolean;
    dayProfitLock?: boolean;
    strictDayStop?: boolean;
    realOrders: boolean;
    capital?: number;
    capitalRs?: number;
  } | null;
  events?: Array<{ at: string; action: string; detail: string }>;
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
  const s = String(raw || '').toLowerCase();
  if (s === 'all-green') {
    return 'all-green';
  }
  if (s === 'selective') {
    return 'selective';
  }
  return 'live-crude-green';
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

  /** Same-origin proxy → DO Order-API /live (server-side control plane). */
  private readonly liveApiBase =
    (environment as { liveApiBaseUrl?: string }).liveApiBaseUrl || '/api/live';

  private readonly orderApiBase =
    (environment as { orderApiBaseUrl?: string }).orderApiBaseUrl || '/api/order-kite';

  /** Cheap equity smoke test — same path Trade Desk / Order Test use. */
  private readonly testSymbol = 'RELIANCE';
  private readonly testExchange = 'NSE';

  /**
   * Capital → lots. All3 one-leg desk reuses the same capital across Nifty → Bank → Crude;
   * do not hard-off Crude/Bank from capital heuristics.
   */
  protected capitalRs = DEFAULT_TRADING_CAPITAL_RS;
  protected capitalDraft = String(DEFAULT_TRADING_CAPITAL_RS);
  protected capitalPlan: CapitalLotPlan = planLotsForCapital(DEFAULT_TRADING_CAPITAL_RS);

  /** All3 books — Nifty Trap → Bank after Nifty → Crude LIVE_CRUDE_GREEN after NSE. */
  protected enableNifty = true;
  protected enableBank = true;
  protected enableCrude = true;
  protected niftyLots = 1;
  protected bankLots = 1;
  protected crudeLots = 1;
  /** From /live/defaults|/live/health — controls row visibility (not capital heuristics). */
  protected bankAllowed = true;
  protected crudeAllowed = true;
  protected bankOnlyAfterNifty = true;
  protected crudeAfterIndexClose = true;
  protected paperLivePath = true;
  protected crudeWindow = '16:00–21:00 IST (gate 15:30)';
  protected deskLabel = 'All3 · Nifty→Bank→Crude';
  protected deskSupportLine = 'Nifty → Bank after Nifty → Crude after NSE · Paper≡Live';
  /** Daily path: Trap (Genie only if explicitly chosen). */
  protected bankStrategy: BankStrategy = 'trap';
  protected crudeStrategy: CrudeStrategy = 'live-crude-green';
  /** Desk risk guards — on by default (capital must not drain). */
  protected dayProfitLock = true;
  protected strictDayStop = true;
  /**
   * Paper vs Live — same two modes as Trade Desk, both run on the backend:
   *  - paper: server worker fetches data (instruments + 5m candles) and
   *    simulates the same Trap replay — no real orders.
   *  - live: DigitalOcean Order-API places real MIS orders on ATM options.
   */
  protected readonly mode = signal<'paper' | 'live'>('paper');
  protected testQty = 1;

  /** Paper backtest window (IST). Paper runs a From→To replay on the backend. */
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
  protected readonly note = signal(
    'All3 server desk: Nifty Trap → Bank after Nifty → Crude after NSE. Paper≡Live path. Get Token first, then run.',
  );

  protected readonly running = computed(() => this.status().status === 'running');
  protected readonly locked = computed(() => this.busy() || this.running());

  /** Build stamp: prefer live server appBuild so deploy is verifiable. */
  protected readonly displayAppBuild = computed(() => {
    const server = this.serverAppBuild() || this.status().appBuild;
    return server ? String(server) : this.appBuildLabel;
  });

  /** Visibility from server allow-flags — not capital heuristics. */
  protected showBankBook(): boolean {
    return this.bankAllowed !== false;
  }

  protected showCrudeBook(): boolean {
    return this.crudeAllowed !== false;
  }

  /** Crude status chip — ON when config/books say so; never imply off just because before 15:30. */
  protected crudeStatusChip(): string | null {
    const s = this.status();
    const on =
      s.config?.enableCrude === true ||
      s.books?.crude === true ||
      (this.showCrudeBook() && this.enableCrude);
    if (!on) {
      return null;
    }
    return 'Crude ON · after 15:30';
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
    this.capitalRs = next;
    this.capitalDraft = String(next);
    this.capitalPreference.set(next);
    if (this.locked()) {
      return;
    }
    this.applyCapitalAllocation();
  }

  protected onCapitalDraftChange(raw: string): void {
    this.capitalDraft = raw;
  }

  /**
   * Size lots from capital. Crude stays ON when server-allowed (one-leg reuses capital);
   * Bank lots resize but user can uncheck Bank. Never hard-hide Crude for low capital.
   */
  private applyCapitalAllocation(opts?: { armAllowedBooks?: boolean }): void {
    const plan = planLotsForCapital(this.capitalRs);
    this.capitalPlan = plan;

    // All3 ladder (server maps capital alone): ₹12k+ → 1/1/1, ₹75k+ → 2/2/2.
    // Prefer plan lots when larger (higher capital scales N/B); Crude matches that lot count.
    const ladderLots = this.capitalRs >= ALL3_LOTS_CAPITAL_2X_RS ? 2 : 1;
    const niftyLots = Math.max(ladderLots, plan.niftyLots || 1);
    const bankLots = Math.max(ladderLots, plan.bankLots || 1);

    this.enableNifty = true;
    this.niftyLots = niftyLots;

    if (this.bankAllowed !== false) {
      this.bankLots = bankLots;
      if (opts?.armAllowedBooks) {
        this.enableBank = true;
      }
    } else {
      this.enableBank = false;
      this.bankLots = Math.max(1, bankLots);
    }

    if (this.crudeAllowed !== false) {
      // Server forces Crude ON when crudeAllowed — keep checked even at low capital.
      this.enableCrude = true;
      this.crudeLots = Math.max(ladderLots, niftyLots);
    } else {
      this.enableCrude = false;
      this.crudeLots = Math.max(1, this.crudeLots || 1);
    }
  }

  protected allocationSummary(): string {
    const bits = [
      this.enableNifty ? `Nifty ×${this.niftyLots}` : null,
      this.showBankBook() && this.enableBank ? `Bank ×${this.bankLots}` : null,
      this.showCrudeBook() && this.enableCrude ? `Crude ×${this.crudeLots}` : null,
    ].filter(Boolean);
    return bits.join(' · ') || 'no books';
  }

  protected hasKiteSession(): boolean {
    return !!this.kiteSession.getAuthorizationHeader();
  }

  /** Lots used for ₹ lock/stop labels (Nifty when on; else Bank). */
  protected deskRiskLots(): number {
    if (this.enableBank && !this.enableNifty) {
      return Math.max(1, Math.floor(Number(this.bankLots)) || 1);
    }
    return Math.max(1, Math.floor(Number(this.niftyLots)) || 1);
  }

  protected profitLockMoneyRs(): number {
    if (this.capitalPlan.dayProfitLockRs > 0) {
      return this.capitalPlan.dayProfitLockRs;
    }
    return DAY_PROFIT_LOCK_PER_LOT_RS * this.deskRiskLots();
  }

  protected strictStopMoneyRs(): number {
    return STRICT_DAY_STOP_PER_LOT_RS * this.deskRiskLots();
  }

  protected optionDayLossMoneyRs(): number {
    return OPTION_DAY_LOSS_PER_LOT_RS * this.deskRiskLots();
  }

  protected riskLabels(): string[] {
    const parts: string[] = [];
    if (this.strictDayStop) {
      parts.push(`strict −₹${this.strictStopMoneyRs().toLocaleString('en-IN')}`);
    }
    if (this.dayProfitLock) {
      parts.push(`profit lock +₹${this.profitLockMoneyRs().toLocaleString('en-IN')}`);
    }
    parts.push(`option stop −₹${this.optionDayLossMoneyRs().toLocaleString('en-IN')}`);
    return parts;
  }

  // ── Paper backtest (date range, backend-driven — same engine as Live) ──
  protected setTestingToday(): void {
    this.fromDate = todayIso();
    this.toDate = todayIso();
  }

  protected setTestingRange(daysBack: number): void {
    this.fromDate = shiftDays(-Math.abs(daysBack));
    this.toDate = todayIso();
  }

  /** One Profit ₹ — charges-adjusted option money (Trade Desk basis). */
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

  /** Normalize book label for trade rows (Nifty / Bank / Crude). */
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
    // Replace the ISO 'T' with a space so HH:MM sits on a word boundary.
    const norm = String(ts).replace('T', ' ');
    const m = norm.match(/\b(\d{2}:\d{2})\b/);
    return m?.[1] ?? (norm.slice(11, 16) || '—');
  }

  protected fmtDay(ts: string | null | undefined): string {
    return ts ? String(ts).slice(0, 10) : '—';
  }

  protected isNotableEvent(e: { action: string; detail: string }): boolean {
    const action = String(e.action || '').toUpperCase();
    const detail = String(e.detail || '');
    if (action === 'CRUDE_ON') {
      return true;
    }
    return /crude|wait nifty|nifty first/i.test(`${action} ${detail}`);
  }

  /** Build Start / Paper payload aligned with Order-API All3 normalizeStartConfig. */
  private buildLivePayload(realOrders: boolean): Record<string, unknown> {
    const enableCrude = this.showCrudeBook() ? true : !!this.enableCrude;
    const enableBank = this.showBankBook() ? !!this.enableBank : false;
    return {
      enableNifty: true,
      enableBank,
      enableCrude,
      niftyLots: Math.max(1, Math.floor(this.niftyLots) || 1),
      bankLots: Math.max(1, Math.floor(this.bankLots) || 1),
      crudeLots: Math.max(1, Math.floor(this.crudeLots) || 1),
      crudeStrategy: this.crudeStrategy || 'live-crude-green',
      crudeAfterIndexClose: this.crudeAfterIndexClose !== false,
      bankOnlyAfterNifty: this.bankOnlyAfterNifty !== false,
      dayProfitLock: this.dayProfitLock,
      strictDayStop: this.strictDayStop,
      realOrders,
      capital: this.capitalRs,
      capitalRs: this.capitalRs,
      bankStrategy: this.bankStrategy,
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

      const label = preset?.label || books?.label;
      if (label) {
        this.deskLabel = String(label);
      }
      if (books?.label) {
        this.deskSupportLine = `${books.label} · Paper≡Live`;
      } else {
        this.deskSupportLine = 'Nifty → Bank after Nifty → Crude after NSE · Paper≡Live';
      }

      if (preset) {
        this.enableNifty = preset.enableNifty !== false;
        this.enableBank = this.bankAllowed ? preset.enableBank !== false : false;
        // Server forces Crude ON when allowed — bind enableCrude from defaults.
        this.enableCrude = this.crudeAllowed ? preset.enableCrude !== false : false;
        if (this.crudeAllowed && preset.enableCrude == null) {
          this.enableCrude = true;
        }
        this.niftyLots = Math.max(1, Math.floor(Number(preset.niftyLots)) || this.niftyLots);
        this.bankLots = Math.max(1, Math.floor(Number(preset.bankLots)) || this.bankLots);
        this.crudeLots = Math.max(1, Math.floor(Number(preset.crudeLots)) || this.crudeLots);
        this.crudeStrategy = normalizeCrudeStrategy(preset.crudeStrategy);
        this.dayProfitLock = preset.dayProfitLock !== false;
        this.strictDayStop = preset.strictDayStop !== false;
      } else if (this.crudeAllowed) {
        this.enableCrude = true;
        this.crudeStrategy = 'live-crude-green';
      }

      // Re-apply capital sizing; arm Bank/Crude from server allow-flags.
      this.applyCapitalAllocation({ armAllowedBooks: true });
    } catch {
      // Keep local All3 defaults when defaults/health are unreachable.
      if (this.crudeAllowed) {
        this.enableCrude = true;
      }
    }
  }

  /**
   * Paper Start = backend backtest over From→To. The browser's Kite session is
   * sent via X-Kite-Authorization so the server can pull historical candles;
   * it is read-only (no orders). Same replay engine Live uses.
   */
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
    // Send the browser Kite session if present; otherwise the backend falls back
    // to the token pushed via "Push Kite token to server".
    const kite = this.kiteSession.getAuthorizationHeader();
    const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};
    this.backtestBusy.set(true);
    try {
      const body = {
        ...this.buildLivePayload(false),
        fromDate: this.fromDate,
        toDate: this.toDate,
      };
      // Backtest is always paper — strip realOrders confusion if server ignores it.
      delete (body as { realOrders?: boolean }).realOrders;
      const res = await firstValueFrom(
        this.http.post<BacktestResult>(`${this.liveApiBase}/backtest`, body, { headers }),
      );
      this.backtest.set(res);
      if (res.paperLivePath != null) {
        this.paperLivePath = !!res.paperLivePath;
      }
      this.note.set(
        `Paper backtest ${res.fromDate} → ${res.toDate}: ${res.totals.trades} trades · net ₹${res.totals.optionNetAfterChargesRs.toLocaleString('en-IN')} (Paper≡Live backend replay).`,
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
          this.deskSupportLine = `${res.books.label} · Paper≡Live`;
        }
        if (res.books.crudeStrategy) {
          this.crudeStrategy = normalizeCrudeStrategy(res.books.crudeStrategy);
        }
      }
      // Mirror the running server config into the UI (so the desk shows truth).
      if (res.config && res.status === 'running') {
        this.enableNifty = !!res.config.enableNifty;
        this.enableBank = !!res.config.enableBank;
        this.enableCrude = !!res.config.enableCrude;
        this.niftyLots = res.config.niftyLots || 1;
        this.bankLots = res.config.bankLots || 1;
        this.crudeLots = res.config.crudeLots || 1;
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
        this.mode.set(res.config.realOrders ? 'live' : 'paper');
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

  protected async start(): Promise<void> {
    this.commitCapital();
    this.applyCapitalAllocation();
    if (!this.enableNifty && !this.enableBank && !this.enableCrude) {
      this.note.set('Desk plan has no books — check capital (min ₹10,000).');
      return;
    }
    const realOrders = this.mode() === 'live';
    if (realOrders) {
      const riskBits = this.riskLabels().join(' · ');
      const ok = await this.uiDialog.confirm({
        title: 'Start server LIVE with real money?',
        message:
          `Real Kite MIS orders on ATM options via the DigitalOcean static-IP Order-API.\n` +
          `Books: ${this.allocationSummary()} · ${this.deskLabel}.\n` +
          `Path: Nifty → Bank after Nifty → Crude after NSE.\n` +
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
      await firstValueFrom(
        this.http.post(`${this.liveApiBase}/start`, this.buildLivePayload(realOrders)),
      );
      this.note.set(
        `Server ${realOrders ? 'LIVE' : 'PAPER'} started — All3 worker on DO (60s). Watch events for DATA / SIGNAL / CRUDE_ON / ENTRY${realOrders ? ' / order fills' : ' (simulated)'}.`,
      );
      await this.refreshStatus();
    } catch (err) {
      this.note.set(`Start failed: ${formatUnknownError(err, 'Start')}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected async stop(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post(`${this.liveApiBase}/stop`, {}));
      this.note.set('Stop requested.');
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

  /** 1) Order-API health — proves static-IP door is up (no money). */
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

  /** Also ping /live/health so All3 flags (crudeAllowed) are visible in the log. */
  protected async pingLiveHealth(): Promise<void> {
    this.orderBusy.set(true);
    this.pushOrderLog('info', `GET ${this.liveApiBase}/health`);
    try {
      const res = await firstValueFrom(this.http.get<LiveHealth>(`${this.liveApiBase}/health`));
      if (res.appBuild) {
        this.serverAppBuild.set(String(res.appBuild));
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

  /** 2) Real MARKET BUY smoke — same /api/order-kite path as Trade Desk. */
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

  /** 3) Flatten the smoke buy. */
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

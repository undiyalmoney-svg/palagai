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
type RunStatus = 'running' | 'stopping' | 'stopped' | 'error' | 'unknown';

/** Same ₹ bands as Trade Desk + Order-API daily-desk-defaults (1-lot base). */
const DAY_PROFIT_LOCK_PER_LOT_RS = 3_000;
const STRICT_DAY_STOP_PER_LOT_RS = 2_950;

interface LiveStatus {
  status: RunStatus;
  message?: string;
  lastHeartbeatAt?: string | null;
  heartbeatAgeSec?: number | null;
  stale?: boolean;
  config?: {
    enableNifty: boolean;
    enableBank: boolean;
    enableCrude: boolean;
    niftyLots: number;
    bankLots: number;
    crudeLots: number;
    bankStrategy: BankStrategy;
    niftyStrategy: 'trap';
    crudeStrategy: 'selective' | 'all-green';
    dayProfitLock?: boolean;
    strictDayStop?: boolean;
    realOrders: boolean;
  } | null;
  events?: Array<{ at: string; action: string; detail: string }>;
}

interface OrderCheckLine {
  at: string;
  level: 'info' | 'ok' | 'err';
  message: string;
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

  /** Visible build stamp — same badge as Trade Desk so deploys are verifiable. */
  protected readonly appBuildLabel = APP_BUILD_LABEL;

  /** Same-origin proxy → DO Order-API /live (server-side control plane). */
  private readonly liveApiBase =
    (environment as { liveApiBaseUrl?: string }).liveApiBaseUrl || '/api/live';

  private readonly orderApiBase =
    (environment as { orderApiBaseUrl?: string }).orderApiBaseUrl || '/api/order-kite';

  /** Cheap equity smoke test — same path Trade Desk / Order Test use. */
  private readonly testSymbol = 'RELIANCE';
  private readonly testExchange = 'NSE';

  /**
   * Capital → lots, exactly like Trade Desk. Client sets capital once; the
   * desk plan sizes Nifty + Bank books and the ₹ lock / strict-stop bands.
   */
  protected capitalRs = DEFAULT_TRADING_CAPITAL_RS;
  protected capitalDraft = String(DEFAULT_TRADING_CAPITAL_RS);
  protected capitalPlan: CapitalLotPlan = planLotsForCapital(DEFAULT_TRADING_CAPITAL_RS);

  /** Index books only — Crude is not on the desk (fee protection). */
  protected enableNifty = true;
  protected enableBank = true;
  protected niftyLots = 1;
  protected bankLots = 1;
  /** Daily path: Trap (Genie only if explicitly chosen). */
  protected bankStrategy: BankStrategy = 'trap';
  /** Desk risk guards — on by default (capital must not drain). */
  protected dayProfitLock = true;
  protected strictDayStop = true;
  /** When true, the server places real MIS orders via the static-IP Order-API. */
  protected realOrders = false;
  protected testQty = 1;

  protected readonly busy = signal(false);
  protected readonly orderBusy = signal(false);
  protected readonly lastTestOrderId = signal<string | null>(null);
  protected readonly orderCheckLog = signal<OrderCheckLine[]>([]);
  protected readonly status = signal<LiveStatus>({
    status: 'unknown',
    message: 'Not connected yet',
  });
  protected readonly note = signal(
    'Server Live on DigitalOcean keeps scanning after Chrome / Wi‑Fi dies. Same desk DNA as Trade Desk: Trap · pierce20/B40 · peak ₹100 · max 3 · lock ₹3k. Set capital → Push Kite token → Start.',
  );

  protected readonly running = computed(() => this.status().status === 'running');
  protected readonly locked = computed(() => this.busy() || this.running());

  ngOnInit(): void {
    this.capitalRs = this.capitalPreference.get() || DEFAULT_TRADING_CAPITAL_RS;
    if (this.capitalRs < 10_000) {
      this.capitalRs = DEFAULT_TRADING_CAPITAL_RS;
    }
    this.capitalDraft = String(this.capitalRs);
    this.applyCapitalAllocation();
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

  /** Size Nifty + Bank from total capital — more capital → more lots. */
  private applyCapitalAllocation(): void {
    const plan = planLotsForCapital(this.capitalRs);
    this.capitalPlan = plan;
    this.enableNifty = plan.enableNifty;
    this.enableBank = plan.enableBank;
    this.niftyLots = plan.enableNifty ? Math.max(1, plan.niftyLots) : 0;
    this.bankLots = plan.enableBank ? Math.max(1, plan.bankLots) : 0;
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

  protected riskLabels(): string[] {
    const parts: string[] = [];
    if (this.strictDayStop) {
      parts.push(`strict −₹${this.strictStopMoneyRs().toLocaleString('en-IN')}`);
    }
    if (this.dayProfitLock) {
      parts.push(`profit lock +₹${this.profitLockMoneyRs().toLocaleString('en-IN')}`);
    }
    return parts;
  }

  protected async refreshStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<LiveStatus>(`${this.liveApiBase}/status`),
      );
      this.status.set(res);
      // Mirror the running server config into the UI (so the desk shows truth).
      if (res.config && res.status === 'running') {
        this.enableNifty = !!res.config.enableNifty;
        this.enableBank = !!res.config.enableBank;
        this.niftyLots = res.config.niftyLots || 1;
        this.bankLots = res.config.bankLots || 1;
        this.bankStrategy = res.config.bankStrategy === 'genie' ? 'genie' : 'trap';
        this.dayProfitLock = res.config.dayProfitLock !== false;
        this.strictDayStop = res.config.strictDayStop !== false;
        this.realOrders = !!res.config.realOrders;
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
    if (!this.enableNifty && !this.enableBank) {
      this.note.set('Desk plan has no books — check capital (min ₹10,000).');
      return;
    }
    if (this.realOrders) {
      const riskBits = this.riskLabels().join(' · ');
      const ok = await this.uiDialog.confirm({
        title: 'Start server live with real money?',
        message:
          `Real Kite MIS orders on ATM options via the DigitalOcean static-IP Order-API.\n` +
          `Books: ${this.allocationSummary()} · Trap DNA.\n` +
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
        this.http.post(`${this.liveApiBase}/start`, {
          enableNifty: this.enableNifty,
          enableBank: this.enableBank,
          enableCrude: false,
          niftyLots: Math.max(1, Math.floor(this.niftyLots) || 1),
          bankLots: Math.max(1, Math.floor(this.bankLots) || 1),
          crudeLots: 1,
          bankStrategy: this.bankStrategy,
          niftyStrategy: 'trap',
          crudeStrategy: 'selective',
          dayProfitLock: this.dayProfitLock,
          strictDayStop: this.strictDayStop,
          realOrders: this.realOrders,
        }),
      );
      this.note.set(
        'Server Live started — strategy worker on DO (60s). Watch Recent events for DATA / SIGNAL / ENTRY.',
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

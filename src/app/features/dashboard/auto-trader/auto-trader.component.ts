import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { KiteApiService } from '../../../core/kite/kite-api.service';
import { formatUnknownError } from '../../../core/utils/kite-error.util';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';

type BankStrategy = 'trap' | 'genie';
type RunStatus = 'running' | 'stopping' | 'stopped' | 'error' | 'unknown';

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
  imports: [FormsModule, MatButtonModule],
  templateUrl: './auto-trader.component.html',
  styleUrl: './auto-trader.component.css',
})
export class AutoTraderComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly kiteApi = inject(KiteApiService);
  private readonly uiDialog = inject(UiDialogService);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Same-origin proxy → DO Order-API /live (new paths only). */
  private readonly liveApiBase =
    (environment as { liveApiBaseUrl?: string }).liveApiBaseUrl || '/api/live';

  private readonly orderApiBase =
    (environment as { orderApiBaseUrl?: string }).orderApiBaseUrl || '/api/order-kite';

  /** Cheap equity smoke test — same path Trade Desk / Order Test use. */
  private readonly testSymbol = 'RELIANCE';
  private readonly testExchange = 'NSE';

  protected enableNifty = true;
  protected enableBank = true;
  protected enableCrude = true;
  protected niftyLots = 1;
  protected bankLots = 1;
  protected crudeLots = 1;
  /** Only Bank is selectable — Nifty=Trap, Crude=Selective (charge-aware) fixed. */
  protected bankStrategy: BankStrategy = 'trap';
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
    'Server Live runs Trap / Genie / Crude Selective on DigitalOcean every 60s. Push Kite token, then Start. Uncheck real money first to watch SIGNAL events.',
  );

  ngOnInit(): void {
    void this.refreshStatus();
    this.pollTimer = setInterval(() => void this.refreshStatus(), 15_000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  protected async refreshStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<LiveStatus>(`${this.liveApiBase}/status`),
      );
      this.status.set(res);
      if (res.config) {
        this.enableNifty = !!res.config.enableNifty;
        this.enableBank = !!res.config.enableBank;
        this.enableCrude = !!res.config.enableCrude;
        this.niftyLots = res.config.niftyLots || 1;
        this.bankLots = res.config.bankLots || 1;
        this.crudeLots = res.config.crudeLots || 1;
        this.bankStrategy = res.config.bankStrategy === 'genie' ? 'genie' : 'trap';
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
    if (this.realOrders) {
      const ok = await this.uiDialog.confirm({
        title: 'Start server live with real money?',
        message:
          'Orders go via DigitalOcean static IP Order-API.\nChrome can close — worker keeps scanning.\n\nNifty = Trap · Bank = ' +
          (this.bankStrategy === 'genie' ? 'Genie' : 'Trap') +
          ' · Crude = Selective (max 1/day)',
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
          enableCrude: this.enableCrude,
          niftyLots: Math.max(1, Math.floor(this.niftyLots) || 1),
          bankLots: Math.max(1, Math.floor(this.bankLots) || 1),
          crudeLots: Math.max(1, Math.floor(this.crudeLots) || 1),
          bankStrategy: this.bankStrategy,
          niftyStrategy: 'trap',
          crudeStrategy: 'selective',
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

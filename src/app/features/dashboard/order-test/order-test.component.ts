import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../../../core/kite/kite-api.service';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { environment } from '../../../../environments/environment';

interface LogLine {
  at: string;
  level: 'info' | 'ok' | 'err';
  message: string;
}

@Component({
  selector: 'app-order-test',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './order-test.component.html',
  styleUrl: './order-test.component.css',
})
export class OrderTestComponent {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);

  protected readonly busy = signal(false);
  protected readonly logs = signal<LogLine[]>([]);
  protected readonly lastOrderId = signal<string | null>(null);

  protected readonly symbol = 'RELIANCE';
  protected readonly exchange = 'NSE';
  protected quantity = 1;
  protected product: 'MIS' | 'CNC' = 'MIS';

  protected readonly orderApiBase =
    (environment as { orderApiBaseUrl?: string }).orderApiBaseUrl || '/api/kite';

  protected clearLogs(): void {
    this.logs.set([]);
  }

  protected async pingHealth(): Promise<void> {
    this.busy.set(true);
    this.log('info', `GET ${this.orderApiBase}/health`);
    try {
      const res = await firstValueFrom(this.kiteApi.pingOrderBackend());
      this.log('ok', `Health OK · ${JSON.stringify(res)}`);
    } catch (err) {
      this.log('err', this.fmtErr(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async placeBuy(): Promise<void> {
    const qty = Math.max(1, Math.floor(Number(this.quantity)) || 1);
    const ok = window.confirm(
      `Place REAL MARKET BUY?\n\n${this.exchange}:${this.symbol}\nQty ${qty} · ${this.product}\n\nThis verifies the DigitalOcean IP with Kite.`,
    );
    if (!ok) {
      return;
    }

    const authorization = this.requireAuth();
    if (!authorization) {
      return;
    }

    this.busy.set(true);
    this.log(
      'info',
      `PLACE BUY ${this.exchange}:${this.symbol} qty=${qty} ${this.product} MARKET via ${this.orderApiBase}`,
    );
    try {
      const res = (await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: this.exchange,
          tradingsymbol: this.symbol,
          transaction_type: 'BUY',
          order_type: 'MARKET',
          quantity: String(qty),
          product: this.product,
          validity: 'DAY',
          tag: 'PALAGAI_IP',
        }),
      )) as { data?: { order_id?: string }; status?: string; message?: string };

      const orderId = res?.data?.order_id ?? null;
      this.lastOrderId.set(orderId);
      this.log('ok', `Response: ${JSON.stringify(res)}`);
      if (orderId) {
        this.log('ok', `Order id ${orderId} — IP whitelist path works if status is success`);
      }
    } catch (err) {
      this.log('err', this.fmtErr(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async placeSell(): Promise<void> {
    const qty = Math.max(1, Math.floor(Number(this.quantity)) || 1);
    const ok = window.confirm(
      `Place REAL MARKET SELL?\n\n${this.exchange}:${this.symbol}\nQty ${qty} · ${this.product}\n\nUse this to flatten the IP-test buy.`,
    );
    if (!ok) {
      return;
    }

    const authorization = this.requireAuth();
    if (!authorization) {
      return;
    }

    this.busy.set(true);
    this.log(
      'info',
      `PLACE SELL ${this.exchange}:${this.symbol} qty=${qty} ${this.product} MARKET via ${this.orderApiBase}`,
    );
    try {
      const res = (await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: this.exchange,
          tradingsymbol: this.symbol,
          transaction_type: 'SELL',
          order_type: 'MARKET',
          quantity: String(qty),
          product: this.product,
          validity: 'DAY',
          tag: 'PALAGAI_IP',
        }),
      )) as { data?: { order_id?: string } };

      const orderId = res?.data?.order_id ?? null;
      this.lastOrderId.set(orderId);
      this.log('ok', `Response: ${JSON.stringify(res)}`);
    } catch (err) {
      this.log('err', this.fmtErr(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async refreshOrders(): Promise<void> {
    const authorization = this.requireAuth();
    if (!authorization) {
      return;
    }

    this.busy.set(true);
    this.log('info', `GET orders via ${this.orderApiBase}`);
    try {
      const res = await firstValueFrom(this.kiteApi.getOrders(authorization));
      this.log('ok', `Orders: ${JSON.stringify(res)}`);
    } catch (err) {
      this.log('err', this.fmtErr(err));
    } finally {
      this.busy.set(false);
    }
  }

  private requireAuth(): string | null {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      this.log('err', 'No Kite session — open Get Token first');
      return null;
    }
    return authorization;
  }

  private log(level: LogLine['level'], message: string): void {
    const at = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    });
    this.logs.update((rows) => [{ at, level, message }, ...rows].slice(0, 80));
  }

  private fmtErr(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const httpErr = err as { status?: number; error?: unknown; message?: string };
      return `HTTP ${httpErr.status ?? '?'} · ${JSON.stringify(httpErr.error ?? httpErr.message)}`;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }
}

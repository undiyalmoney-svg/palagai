import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface KiteSessionTokenRequest {
  apiKey: string;
  requestToken: string;
  checksum?: string;
  apiSecret?: string;
}

export interface KiteHistoricalRequest {
  instrumentToken: string;
  interval: string;
  from: string;
  to: string;
  authorization: string;
}

@Injectable({ providedIn: 'root' })
export class KiteApiService {
  private readonly http = inject(HttpClient);
  /** Candles, quotes, instruments, token — Vercel / local proxy. */
  private readonly kiteApiBaseUrl = '/api/kite';
  /**
   * Order APIs only — DigitalOcean fixed-IP backend
   * (or same-origin `/api/order-kite` forwarder in production).
   */
  private readonly orderApiBaseUrl =
    (environment as { orderApiBaseUrl?: string }).orderApiBaseUrl || '/api/order-kite';

  exchangeSessionToken(payload: KiteSessionTokenRequest): Observable<unknown> {
    const params = new URLSearchParams();
    params.set('api_key', payload.apiKey.trim());
    params.set('request_token', payload.requestToken.trim());
    if (payload.checksum?.trim()) {
      params.set('checksum', payload.checksum.trim());
    }
    // Sent only to our SSR proxy (stripped before Kite). Skip on local ng-serve proxy.
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    if (!isLocalHost && payload.apiSecret?.trim()) {
      params.set('api_secret', payload.apiSecret.trim());
    }

    const headers = new HttpHeaders({
      'X-Kite-Version': '3',
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    return this.http.post(`${this.kiteApiBaseUrl}/session/token`, params.toString(), { headers });
  }

  getHistoricalData(payload: KiteHistoricalRequest): Observable<unknown> {
    const params = new URLSearchParams({
      from: payload.from,
      to: payload.to,
    });

    const url = `${this.kiteApiBaseUrl}/instruments/historical/${payload.instrumentToken}/${payload.interval}?${params.toString()}`;

    const headers = new HttpHeaders({
      'X-Kite-Version': '3',
      Authorization: payload.authorization,
    });

    return this.http.get(url, { headers });
  }

  getInstrumentsCsv(authorization: string): Observable<string> {
    const headers = new HttpHeaders({
      'X-Kite-Version': '3',
      Authorization: authorization,
    });

    return this.http
      .get(`${this.kiteApiBaseUrl}/instruments`, { headers, responseType: 'arraybuffer' })
      .pipe(mergeMap((buffer) => from(this.decompressIfGzip(buffer))));
  }

  /** Kite quote — keys like NSE:NIFTY 50 or NFO:SYMBOL */
  getQuotes(authorization: string, instruments: string[]): Observable<unknown> {
    const params = new URLSearchParams();
    for (const i of instruments) {
      params.append('i', i);
    }
    const headers = new HttpHeaders({
      'X-Kite-Version': '3',
      Authorization: authorization,
    });
    return this.http.get(`${this.kiteApiBaseUrl}/quote?${params.toString()}`, { headers });
  }

  // --- Orders (https://kite.trade/docs/connect/v3/orders) ---

  /** POST /orders/:variety — place order (regular | amo | co | iceberg | auction). */
  placeOrder(
    authorization: string,
    variety: 'regular' | 'amo' | 'co' | 'iceberg' | 'auction',
    fields: Record<string, string>,
  ): Observable<unknown> {
    return this.postForm(authorization, `/orders/${variety}`, fields);
  }

  /** Convenience: POST /orders/regular */
  placeRegularOrder(
    authorization: string,
    fields: Record<string, string>,
  ): Observable<unknown> {
    return this.placeOrder(authorization, 'regular', fields);
  }

  /** PUT /orders/:variety/:order_id — modify open/pending order. */
  modifyOrder(
    authorization: string,
    variety: 'regular' | 'amo' | 'co' | 'iceberg' | 'auction',
    orderId: string,
    fields: Record<string, string>,
  ): Observable<unknown> {
    return this.putForm(
      authorization,
      `/orders/${variety}/${encodeURIComponent(orderId)}`,
      fields,
    );
  }

  /** DELETE /orders/:variety/:order_id */
  cancelOrder(
    authorization: string,
    variety: 'regular' | 'amo' | 'co' | 'iceberg' | 'auction',
    orderId: string,
  ): Observable<unknown> {
    const headers = this.authHeaders(authorization);
    return this.http.delete(
      `${this.orderApiBaseUrl}/orders/${variety}/${encodeURIComponent(orderId)}`,
      { headers },
    );
  }

  cancelRegularOrder(authorization: string, orderId: string): Observable<unknown> {
    return this.cancelOrder(authorization, 'regular', orderId);
  }

  /** GET /orders — day order book */
  getOrders(authorization: string): Observable<unknown> {
    return this.http.get(`${this.orderApiBaseUrl}/orders`, {
      headers: this.authHeaders(authorization),
    });
  }

  /** GET /orders/:order_id — status history for one order */
  getOrderHistory(authorization: string, orderId: string): Observable<unknown> {
    return this.http.get(`${this.orderApiBaseUrl}/orders/${encodeURIComponent(orderId)}`, {
      headers: this.authHeaders(authorization),
    });
  }

  /** GET /trades — all executed trades for the day */
  getTrades(authorization: string): Observable<unknown> {
    return this.http.get(`${this.orderApiBaseUrl}/trades`, {
      headers: this.authHeaders(authorization),
    });
  }

  /** GET /orders/:order_id/trades */
  getOrderTrades(authorization: string, orderId: string): Observable<unknown> {
    return this.http.get(
      `${this.orderApiBaseUrl}/orders/${encodeURIComponent(orderId)}/trades`,
      { headers: this.authHeaders(authorization) },
    );
  }

  /** GET /portfolio/positions */
  getPositions(authorization: string): Observable<unknown> {
    return this.http.get(`${this.orderApiBaseUrl}/portfolio/positions`, {
      headers: this.authHeaders(authorization),
    });
  }

  /** Order-backend health (droplet or `/api/order-kite` proxy). */
  pingOrderBackend(): Observable<unknown> {
    return this.http.get(`${this.orderApiBaseUrl}/health`);
  }

  private authHeaders(authorization: string, withForm = false): HttpHeaders {
    let headers = new HttpHeaders({
      'X-Kite-Version': '3',
      Authorization: authorization,
    });
    if (withForm) {
      headers = headers.set('Content-Type', 'application/x-www-form-urlencoded');
    }
    return headers;
  }

  private toFormBody(fields: Record<string, string>): string {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
      if (value != null && String(value).length) {
        body.set(key, String(value));
      }
    }
    return body.toString();
  }

  private postForm(
    authorization: string,
    path: string,
    fields: Record<string, string>,
  ): Observable<unknown> {
    return this.http.post(`${this.orderApiBaseUrl}${path}`, this.toFormBody(fields), {
      headers: this.authHeaders(authorization, true),
    });
  }

  private putForm(
    authorization: string,
    path: string,
    fields: Record<string, string>,
  ): Observable<unknown> {
    return this.http.put(`${this.orderApiBaseUrl}${path}`, this.toFormBody(fields), {
      headers: this.authHeaders(authorization, true),
    });
  }

  private async decompressIfGzip(buffer: ArrayBuffer): Promise<string> {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    }
    return new TextDecoder().decode(bytes);
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

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
  private readonly kiteApiBaseUrl = '/api/kite';

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

  private async decompressIfGzip(buffer: ArrayBuffer): Promise<string> {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    }
    return new TextDecoder().decode(bytes);
  }
}

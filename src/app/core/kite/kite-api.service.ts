import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

export interface KiteSessionTokenRequest {
  apiKey: string;
  requestToken: string;
  checksum: string;
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
    const body = new URLSearchParams({
      api_key: payload.apiKey.trim(),
      request_token: payload.requestToken.trim(),
      checksum: payload.checksum.trim(),
    }).toString();

    const headers = new HttpHeaders({
      'X-Kite-Version': '3',
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    return this.http.post(`${this.kiteApiBaseUrl}/session/token`, body, { headers });
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

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { KiteSessionService } from '../kite/kite-session.service';
import {
  DEFAULT_DESK_SETTINGS,
  MarketDeskCandles,
  MarketDeskSettings,
  MarketDeskSnapshot,
} from './market-desk.models';

@Injectable({ providedIn: 'root' })
export class MarketDeskApiService {
  private readonly http = inject(HttpClient);
  private readonly kite = inject(KiteSessionService);
  private readonly base =
    (environment as { marketDeskApiBaseUrl?: string }).marketDeskApiBaseUrl || '/api/market-desk';

  snapshot(settings: Partial<MarketDeskSettings> = {}): Promise<MarketDeskSnapshot> {
    let params = new HttpParams();
    const merged = { ...DEFAULT_DESK_SETTINGS, ...settings };
    for (const [k, v] of Object.entries(merged)) {
      params = params.set(k, String(v));
    }
    return firstValueFrom(
      this.http.get<MarketDeskSnapshot>(this.base, { params, headers: this.kiteHeader() }),
    );
  }

  candles(symbol: string, interval: string): Promise<MarketDeskCandles> {
    return firstValueFrom(
      this.http.get<MarketDeskCandles>(`${this.base}/candles`, {
        params: { symbol, interval },
        headers: this.kiteHeader(),
      }),
    );
  }

  private kiteHeader(): Record<string, string> {
    const kite = this.kite.getAuthorizationHeader();
    return kite ? { 'X-Kite-Authorization': kite } : {};
  }
}

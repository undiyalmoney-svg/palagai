import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { HeatmapApiService } from '../../features/heatmap/heatmap-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { deskSnapshotFromPublicHeatmaps, isDeskRouteMissing } from './market-desk-fallback';
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
  private readonly heatmap = inject(HeatmapApiService);
  private readonly base =
    (environment as { marketDeskApiBaseUrl?: string }).marketDeskApiBaseUrl || '/api/market-desk';

  async snapshot(settings: Partial<MarketDeskSettings> = {}): Promise<MarketDeskSnapshot> {
    const merged = { ...DEFAULT_DESK_SETTINGS, ...settings };
    let params = new HttpParams();
    for (const [k, v] of Object.entries(merged)) {
      params = params.set(k, String(v));
    }
    try {
      return await firstValueFrom(
        this.http.get<MarketDeskSnapshot>(this.base, { params, headers: this.kiteHeader() }),
      );
    } catch (err) {
      if (!isDeskRouteMissing(err) && !(err instanceof HttpErrorResponse && err.status === 404)) {
        throw err;
      }
      const [nifty, bank, sensex] = await Promise.all([
        this.heatmap.snapshot('NIFTY50'),
        this.heatmap.snapshot('BANKNIFTY'),
        this.heatmap.snapshot('SENSEX'),
      ]);
      return deskSnapshotFromPublicHeatmaps(nifty, bank, sensex, merged);
    }
  }

  async candles(symbol: string, interval: string): Promise<MarketDeskCandles> {
    try {
      return await firstValueFrom(
        this.http.get<MarketDeskCandles>(`${this.base}/candles`, {
          params: { symbol, interval },
          headers: this.kiteHeader(),
        }),
      );
    } catch (err) {
      if (!isDeskRouteMissing(err) && !(err instanceof HttpErrorResponse && err.status === 404)) {
        throw err;
      }
      return {
        candles: [],
        message:
          'Historical candles need /market-desk on the trading server. Pull Order-API on the droplet and restart trading-backend.',
      };
    }
  }

  private kiteHeader(): Record<string, string> {
    const kite = this.kite.getAuthorizationHeader();
    return kite ? { 'X-Kite-Authorization': kite } : {};
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { BacktestJob } from './historical-backtest.models';

@Injectable({ providedIn: 'root' })
export class HistoricalBacktestApiService {
  private readonly http = inject(HttpClient);
  private readonly kite = inject(KiteSessionService);
  private readonly base =
    (environment as { orbBacktestApiBaseUrl?: string }).orbBacktestApiBaseUrl || '/api/orb-backtest';

  start(body: {
    from: string;
    to: string;
    capital: number;
    maxStocksPerDay: number;
  }): Promise<BacktestJob> {
    return firstValueFrom(
      this.http.post<BacktestJob>(`${this.base}/run`, body, { headers: this.headers() }),
    );
  }

  job(id: string): Promise<BacktestJob> {
    return firstValueFrom(
      this.http.get<BacktestJob>(`${this.base}/jobs/${encodeURIComponent(id)}`, {
        headers: this.headers(),
      }),
    );
  }

  universe(): Promise<{ count: number; symbols: string[] }> {
    return firstValueFrom(
      this.http.get<{ count: number; symbols: string[] }>(`${this.base}/universe`, {
        headers: this.headers(),
      }),
    );
  }

  private headers(): Record<string, string> {
    const kite = this.kite.getAuthorizationHeader();
    return kite ? { 'X-Kite-Authorization': kite } : {};
  }
}

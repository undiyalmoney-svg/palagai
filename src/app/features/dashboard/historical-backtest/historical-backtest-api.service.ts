import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import {
  BacktestJob,
  LiveMoneyResponse,
  DiscoverCandidateDetail,
  DiscoverExperimentRow,
  DiscoverJob,
  DiscoverSpace,
  DailyProfitJob,
} from './historical-backtest.models';

@Injectable({ providedIn: 'root' })
export class HistoricalBacktestApiService {
  private readonly http = inject(HttpClient);
  private readonly kite = inject(KiteSessionService);
  private readonly base =
    (environment as { orbBacktestApiBaseUrl?: string }).orbBacktestApiBaseUrl || '/api/orb-backtest';
  private readonly dailyProfitBase =
    (environment as { dailyProfitApiBaseUrl?: string }).dailyProfitApiBaseUrl || '/api/daily-profit';

  startLiveToday(): Promise<BacktestJob> {
    return firstValueFrom(
      this.http.post<BacktestJob>(`${this.base}/live-today`, {}, { headers: this.headers() }),
    );
  }

  liveMoneyStatus(): Promise<LiveMoneyResponse> {
    return firstValueFrom(
      this.http.get<LiveMoneyResponse>(`${this.base}/live-today/status`, { headers: this.headers() }),
    );
  }

  startLiveMoney(): Promise<LiveMoneyResponse> {
    return firstValueFrom(
      this.http.post<LiveMoneyResponse>(
        `${this.base}/live-today/start`,
        { confirm: true },
        { headers: this.headers() },
      ),
    );
  }

  stopLiveMoney(): Promise<LiveMoneyResponse> {
    return firstValueFrom(
      this.http.post<LiveMoneyResponse>(`${this.base}/live-today/stop`, {}, { headers: this.headers() }),
    );
  }

  start(body: {
    from: string;
    to: string;
    capital: number;
    maxStocksPerDay?: number;
    rankBy?: string;
    crowdFilter?: string | null;
    preset?: string;
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

  startDiscover(body: {
    from: string;
    to: string;
    capital: number;
    budget: number;
  }): Promise<DiscoverJob> {
    return firstValueFrom(
      this.http.post<DiscoverJob>(`${this.base}/discover`, body, { headers: this.headers() }),
    );
  }

  discoverJob(id: string): Promise<DiscoverJob> {
    return firstValueFrom(
      this.http.get<DiscoverJob>(`${this.base}/discover/${encodeURIComponent(id)}`, {
        headers: this.headers(),
      }),
    );
  }

  discoverSpace(): Promise<DiscoverSpace> {
    return firstValueFrom(
      this.http.get<DiscoverSpace>(`${this.base}/discover/space`, { headers: this.headers() }),
    );
  }

  listDiscoveries(): Promise<{ experiments: DiscoverExperimentRow[] }> {
    return firstValueFrom(
      this.http.get<{ experiments: DiscoverExperimentRow[] }>(`${this.base}/discover`, {
        headers: this.headers(),
      }),
    );
  }

  discoverCandidate(jobId: string, candidateId: string): Promise<DiscoverCandidateDetail> {
    return firstValueFrom(
      this.http.get<DiscoverCandidateDetail>(
        `${this.base}/discover/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(candidateId)}`,
        { headers: this.headers() },
      ),
    );
  }

  startDailyProfit(body: {
    from: string;
    to: string;
    capital: number;
    budget: number;
  }): Promise<DailyProfitJob> {
    return firstValueFrom(
      this.http.post<DailyProfitJob>(`${this.dailyProfitBase}/run`, body, { headers: this.headers() }),
    );
  }

  dailyProfitJob(id: string): Promise<DailyProfitJob> {
    return firstValueFrom(
      this.http.get<DailyProfitJob>(`${this.dailyProfitBase}/jobs/${encodeURIComponent(id)}`, {
        headers: this.headers(),
      }),
    );
  }

  dailyProfitSpace(): Promise<{ liveOrders: boolean; count: number; families: string[] }> {
    return firstValueFrom(
      this.http.get<{ liveOrders: boolean; count: number; families: string[] }>(`${this.dailyProfitBase}/space`, {
        headers: this.headers(),
      }),
    );
  }

  private headers(): Record<string, string> {
    const kite = this.kite.getAuthorizationHeader();
    return kite ? { 'X-Kite-Authorization': kite } : {};
  }
}

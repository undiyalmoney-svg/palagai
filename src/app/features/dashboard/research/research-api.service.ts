import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ReadinessCheck,
  ResearchCandidate,
  ResearchPosition,
  ResearchStatus,
  ResearchStrategy,
  ResearchSummary,
  ResearchTrade,
  SystemEvent,
  WeeklyRow,
} from './research.models';

export interface TradeQuery {
  from?: string;
  to?: string;
  symbol?: string;
  strategyId?: string;
  direction?: string;
  status?: string;
  page?: number;
}

@Injectable({ providedIn: 'root' })
export class ResearchApiService {
  private readonly http = inject(HttpClient);
  private readonly base =
    (environment as { researchApiBaseUrl?: string }).researchApiBaseUrl || '/api/research';

  status(): Promise<ResearchStatus> {
    return this.get<ResearchStatus>('/status');
  }

  readiness(): Promise<{ ready: boolean; checks: ReadinessCheck[]; paperOnly: boolean }> {
    return this.get('/readiness');
  }

  strategies(): Promise<ResearchStrategy[]> {
    return this.get<{ strategies: ResearchStrategy[] }>('/strategies').then((r) => r.strategies);
  }

  candidates(q: TradeQuery = {}): Promise<ResearchCandidate[]> {
    return this.get<{ candidates: ResearchCandidate[] }>('/candidates', q).then((r) => r.candidates);
  }

  positions(): Promise<ResearchPosition[]> {
    return this.get<{ positions: ResearchPosition[] }>('/positions').then((r) => r.positions);
  }

  trades(q: TradeQuery): Promise<{ trades: ResearchTrade[]; total: number; page: number }> {
    return this.get('/trades', q);
  }

  summary(q: TradeQuery): Promise<ResearchSummary> {
    return this.get('/summary', q);
  }

  weekly(q: TradeQuery): Promise<WeeklyRow[]> {
    return this.get<{ weeks: WeeklyRow[] }>('/weekly', q).then((r) => r.weeks);
  }

  events(): Promise<SystemEvent[]> {
    return this.get<{ events: SystemEvent[] }>('/events').then((r) => r.events);
  }

  start(confirm: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base}/start`, { confirm, mode: 'PAPER' }));
  }

  stop(): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base}/stop`, {}));
  }

  saveConfig(body: Record<string, number>): Promise<unknown> {
    return firstValueFrom(this.http.put(`${this.base}/config`, body));
  }

  setEnabled(strategyId: string, enabled: boolean, version: number): Promise<unknown> {
    const action = enabled ? 'enable' : 'disable';
    return firstValueFrom(this.http.post(`${this.base}/strategies/${strategyId}/${action}`, { version }));
  }

  optimize(strategyId: string): Promise<{ candidate?: { version: number; optimizationNotes: string } }> {
    return firstValueFrom(
      this.http.post<{ candidate?: { version: number; optimizationNotes: string } }>(
        `${this.base}/optimization/run`,
        { strategyId },
      ),
    );
  }

  exportCsv(q: TradeQuery): Promise<string> {
    return firstValueFrom(
      this.http.get(`${this.base}/export.csv`, { params: this.params(q), responseType: 'text' }),
    );
  }

  exportXlsx(q: TradeQuery): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`${this.base}/export.xlsx`, { params: this.params(q), responseType: 'blob' }),
    );
  }

  private get<T>(path: string, q: TradeQuery = {}): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params: this.params(q) }));
  }

  private params(q: TradeQuery): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(q)) {
      if (value != null && value !== '') params = params.set(key, String(value));
    }
    return params;
  }
}

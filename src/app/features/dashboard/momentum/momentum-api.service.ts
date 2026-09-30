import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  Backtest,
  BacktestListItem,
  BrokerStatus,
  CompareRow,
  DecisionResult,
  DecisionRunRow,
  ExecuteResponse,
  ExecutionOutcome,
  JobRun,
  MomentumConfig,
  MomentumStatus,
  NarratorAnswer,
  Order,
  OrderEvent,
  Performance,
  PortfolioMode,
  PortfolioView,
  RankRow,
  RegimeHistoryRow,
  RegimeReading,
  ResearchRun,
  Signal,
  StockDetail,
  StrategySummary,
  Trade,
  WhatIfResponse,
} from './momentum.models';

export interface DashboardResponse {
  asOf: string;
  strategy: { id: string; name: string };
  horizon: string;
  regime: RegimeReading;
  regimeHistory: RegimeHistoryRow[];
  topRanked: RankRow[];
  pendingSignals: Signal[];
  paper: { id: number; equity: number; cash: number; invested: number; unrealized: number; positionCount: number } | null;
  live: { id: number; equity: number; cash: number; invested: number; unrealized: number; positionCount: number } | null;
  recentTrades: Trade[];
}

export interface ScreenerResponse {
  asOf: string;
  regime: RegimeReading;
  universeSize: number;
  sectors: string[];
  rows: RankRow[];
}

export interface CapitalChangeResponse {
  kind: 'DEPOSIT' | 'WITHDRAWAL';
  before?: number;
  amount: number;
  status?: string;
  message?: string;
  run?: DecisionResult;
  runId?: number;
  execution?: ExecutionOutcome | null;
}

export interface BacktestRequest {
  name?: string;
  strategyId?: string;
  capital: number;
  from?: string;
  to?: string;
  rebalance?: string;
  numStocks?: number;
  slippageBps?: number;
  costs?: { extraBps?: number };
  capitalEvents?: Array<{ date: string; amount: number }>;
}

/** Thin, typed wrapper over the Order API `/momentum` endpoints. */
@Injectable({ providedIn: 'root' })
export class MomentumApiService {
  private readonly http = inject(HttpClient);
  private readonly base =
    (environment as { momentumApiBaseUrl?: string }).momentumApiBaseUrl || '/api/momentum';

  private get<T>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    }
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params }));
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }

  private put<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.put<T>(`${this.base}${path}`, body));
  }

  private del<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }

  // ---- read models
  status = () => this.get<MomentumStatus>('/status');
  dashboard = () => this.get<DashboardResponse>('/dashboard');
  screener = () => this.get<ScreenerResponse>('/screener');
  stock = (symbol: string) => this.get<StockDetail>(`/stocks/${encodeURIComponent(symbol)}`);
  regime = () => this.get<{ current: RegimeReading; history: RegimeHistoryRow[] }>('/regime');
  config = () => this.get<MomentumConfig>('/config');

  // ---- settings
  saveSettings = (patch: unknown) => this.put<MomentumConfig>('/settings', patch);
  saveRisk = (patch: Record<string, number>) => this.put<MomentumConfig>('/risk', patch);
  saveStrategy = (body: { name: string; basePreset?: string; overrides?: Record<string, unknown>; description?: string }) =>
    this.post<{ strategy: StrategySummary }>('/strategies', body);
  deleteStrategy = (id: string) => this.del<{ deleted: boolean }>(`/strategies/${encodeURIComponent(id)}`);

  // ---- portfolios
  portfolio = (mode: PortfolioMode) => this.get<PortfolioView>('/portfolio', { mode });
  initPaper = (capital: number, reset = false) => this.post<{ portfolio: PortfolioView['portfolio'] }>('/portfolio/paper', { capital, reset });
  setAutoExecute = (mode: PortfolioMode, enabled: boolean, phrase?: string) =>
    this.put<{ portfolio: PortfolioView['portfolio'] }>('/portfolio/auto-execute', { mode, enabled, phrase });
  changeCapital = (mode: PortfolioMode, amount: number, note?: string) => this.post<CapitalChangeResponse>('/portfolio/capital', { mode, amount, note });
  performance = (mode: PortfolioMode) => this.get<Performance>('/performance', { mode });
  trades = (mode: PortfolioMode) => this.get<{ trades: Trade[] }>('/trades', { mode });

  // ---- decisions
  advice = (body: { capital?: number; useExisting?: boolean; mode?: PortfolioMode }) => this.post<DecisionResult>('/advice', body);
  decisionPreview = (mode: PortfolioMode) => this.get<DecisionResult>('/decisions', { mode });
  runDecision = (mode: PortfolioMode, forceReview: boolean) => this.post<DecisionResult>('/decisions/run', { mode, forceReview });
  decisionHistory = (mode: PortfolioMode) => this.get<{ runs: DecisionRunRow[] }>('/decisions/history', { mode });
  decisionRun = (id: number) => this.get<{ run: DecisionRunRow }>(`/decisions/runs/${id}`);

  // ---- signals & orders
  signals = (query: { portfolioId?: number; status?: string; actionable?: boolean; limit?: number } = {}) =>
    this.get<{ signals: Signal[] }>('/signals', { portfolioId: query.portfolioId, status: query.status, actionable: query.actionable ? '1' : undefined, limit: query.limit });
  executeSignal = (id: number) => this.post<ExecuteResponse>(`/signals/${id}/execute`);
  executeSignals = (ids: number[]) => this.post<ExecutionOutcome>('/signals/execute', { ids });
  skipSignal = (id: number) => this.post<{ signal: Signal }>(`/signals/${id}/skip`);
  orders = (portfolioId?: number) => this.get<{ orders: Order[] }>('/orders', { portfolioId });
  order = (id: number) => this.get<{ order: Order; events: OrderEvent[] }>(`/orders/${id}`);
  cancelOrder = (id: number) => this.post<{ order: Order }>(`/orders/${id}/cancel`);
  reconcile = () => this.post<{ results: Array<{ id: number; status: string }> }>('/orders/reconcile');

  // ---- research
  backtest = (body: BacktestRequest) => this.post<{ backtest: Backtest }>('/backtests', body);
  backtests = () => this.get<{ backtests: BacktestListItem[] }>('/backtests');
  getBacktest = (id: number) => this.get<{ backtest: Backtest }>(`/backtests/${id}`);
  whatIf = (body: { date: string; capital: number; strategyId?: string }) => this.post<WhatIfResponse>('/whatif', body);
  compare = (body: { capital: number; from?: string; to?: string; strategyIds?: string[] }) =>
    this.post<{ from: string; to: string; capital: number; rows: CompareRow[] }>('/lab/compare', body);
  optimize = (body: Record<string, unknown>) => this.post<{ run: ResearchRun }>('/lab/optimize', body);
  walkForward = (body: Record<string, unknown>) => this.post<{ run: ResearchRun }>('/lab/walk-forward', body);
  runs = () => this.get<{ runs: ResearchRun[] }>('/lab/runs');
  getRun = (id: number) => this.get<{ run: ResearchRun }>(`/lab/runs/${id}`);
  cancelRun = (id: number) => this.post<{ cancelled: boolean }>(`/lab/runs/${id}/cancel`);
  applyRun = (id: number, name?: string) => this.post<{ strategy: StrategySummary }>(`/lab/runs/${id}/apply`, { name });

  // ---- AI narrator (explains stored decisions only)
  ask = (question: string, mode: PortfolioMode = 'PAPER') => this.post<NarratorAnswer>('/ai/ask', { question, mode });

  // ---- data & jobs
  syncData = () => this.post<{ sync: { newRows: number; last: string | null; failures: unknown[] } }>('/data/sync');
  resetData = () => this.post<{ reset: boolean }>('/data/reset');
  jobs = () => this.get<{ jobs: JobRun[] }>('/jobs');
  runJob = (name: 'daily' | 'weekly' | 'monthly', force = false) => this.post<{ outcome: { skipped?: boolean; status?: string; reason?: string } }>(`/jobs/${name}/run`, { force });

  // ---- broker / live
  brokerStatus = () => this.get<BrokerStatus>('/broker/status');
  brokerFunds = () => this.get<{ equityCash?: number; equityNet?: number; capitalRs?: number; fetchedAt?: string }>('/broker/funds');
  enableLive = (phrase: string) => this.post<{ enabled: boolean }>('/live/enable', { phrase });
  disableLive = () => this.post<{ enabled: boolean }>('/live/disable');
  syncFunds = () => this.post<{ cash: number }>('/live/sync-funds');
}

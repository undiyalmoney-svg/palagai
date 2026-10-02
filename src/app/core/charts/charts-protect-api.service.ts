import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { KiteSessionService } from '../kite/kite-session.service';
import { ChartBookId } from '../charts/live-chart-data.service';

export interface ChartsProtectView {
  enabled: boolean;
  date?: string;
  nseBook?: string | null;
  openFills?: string[];
  lastTick?: string | null;
  lastError?: string | null;
  lastMessage?: string | null;
  dropletWatching?: boolean;
  dropletPlacing?: boolean;
  sessionOk?: boolean;
}

/**
 * Talks to the droplet Charts Protect watcher. Failures are swallowed so a
 * down API never blocks the Charts tab from placing or flattening locally.
 */
@Injectable({ providedIn: 'root' })
export class ChartsProtectApiService {
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly base =
    (environment as { momentumApiBaseUrl?: string }).momentumApiBaseUrl || '/api/momentum';

  async get(): Promise<ChartsProtectView | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ protect?: ChartsProtectView }>(`${this.base}/charts-protect`, {
          headers: this.kiteHeader(),
        }),
      );
      return res?.protect ?? null;
    } catch {
      return null;
    }
  }

  async setEnabled(enabled: boolean): Promise<ChartsProtectView | null> {
    try {
      const res = await firstValueFrom(
        this.http.put<{ protect?: ChartsProtectView }>(
          `${this.base}/charts-protect`,
          { enabled },
          { headers: this.kiteHeader() },
        ),
      );
      return res?.protect ?? null;
    } catch {
      return null;
    }
  }

  async registerFill(fill: {
    instrument: string;
    exchange?: string | null;
    book: ChartBookId;
    qty: number;
    entry: number | null;
    stop: number | null;
    target: number | null;
  }): Promise<void> {
    if (!fill.instrument || !(fill.qty > 0) || !(fill.entry != null && fill.entry > 0)) return;
    try {
      await firstValueFrom(
        this.http.post(
          `${this.base}/charts-protect/fill`,
          fill,
          { headers: this.kiteHeader() },
        ),
      );
    } catch {
      // Local flatten still runs on this tab.
    }
  }

  private kiteHeader(): Record<string, string> {
    const kite = this.kiteSession.getAuthorizationHeader();
    return kite ? { 'X-Kite-Authorization': kite } : {};
  }
}

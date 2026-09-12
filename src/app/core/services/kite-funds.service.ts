import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { KiteSessionService } from '../kite/kite-session.service';
import { CapitalPreferenceService } from './capital-preference.service';

export interface KiteFundsSnapshot {
  status?: string;
  source?: string;
  equityCash?: number;
  equityNet?: number;
  commodityCash?: number;
  commodityNet?: number;
  capitalRs?: number;
  fetchedAt?: string;
  error?: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class KiteFundsService {
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly capitalPreference = inject(CapitalPreferenceService);
  private readonly liveApiBase =
    (environment as { liveApiBaseUrl?: string }).liveApiBaseUrl || '/api/live';

  readonly busy = signal(false);
  readonly error = signal('');
  readonly funds = signal<KiteFundsSnapshot | null>(null);

  equityAvailable(): number | null {
    const f = this.funds();
    const n = Math.floor(Number(f?.equityCash || f?.capitalRs) || 0);
    if (!f) return null;
    return Number.isFinite(n) ? n : null;
  }

  apply(snapshot: KiteFundsSnapshot | null | undefined): void {
    if (!snapshot) return;
    const n = Math.floor(Number(snapshot.capitalRs || snapshot.equityCash) || 0);
    this.funds.set(snapshot);
    this.error.set('');
    if (n > 0) this.capitalPreference.set(n);
  }

  async refresh(): Promise<void> {
    await this.pushToken();
    const kite = this.kiteSession.getAuthorizationHeader();
    const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(
        this.http.get<KiteFundsSnapshot>(`${this.liveApiBase}/funds`, { headers }),
      );
      this.apply({ ...res, fetchedAt: res.fetchedAt || new Date().toISOString() });
      if (!this.equityAvailable() && res.message) this.error.set(res.message);
    } catch (err) {
      this.funds.set(null);
      this.error.set(this.fmtErr(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async pushToken(): Promise<void> {
    const data = this.kiteSession.getSession()?.data;
    if (!data?.api_key || !data.access_token) return;
    try {
      await firstValueFrom(
        this.http.put(`${this.liveApiBase}/auth`, {
          apiKey: data.api_key,
          accessToken: data.access_token,
        }),
      );
    } catch {
      /* server may already have a pushed token */
    }
  }

  private fmtErr(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { message?: string; error?: string } | string;
      if (typeof body === 'string' && body.trim()) return body;
      if (body && typeof body === 'object') {
        return body.message || body.error || err.message || 'Request failed';
      }
      return err.message || 'Request failed';
    }
    return err instanceof Error ? err.message : 'Request failed';
  }
}

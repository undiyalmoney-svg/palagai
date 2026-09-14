import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { KiteSessionService } from '../kite/kite-session.service';
import { CapitalPreferenceService } from './capital-preference.service';
import { formatUnknownError } from '../utils/kite-error.util';

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

  async pushToken(): Promise<boolean> {
    const data = this.kiteSession.getSession()?.data;
    if (!data?.api_key || !data.access_token) return false;
    try {
      await firstValueFrom(
        this.http.put(`${this.liveApiBase}/auth`, {
          apiKey: data.api_key,
          accessToken: data.access_token,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private fmtErr(err: unknown): string {
    return formatUnknownError(err, 'Funds');
  }
}

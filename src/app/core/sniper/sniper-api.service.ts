import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { SniperSession } from './sniper.models';

export interface SniperView {
  running?: boolean;
  live?: boolean;
  lastTick?: string | null;
  lastError?: string | null;
  lastMessage?: string | null;
  sessionOk?: boolean;
  dropletWatching?: boolean;
  dropletPlacing?: boolean;
  session?: SniperSession | null;
}

@Injectable({ providedIn: 'root' })
export class SniperApiService {
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly auth = inject(AuthService);
  private readonly base =
    (environment as { momentumApiBaseUrl?: string }).momentumApiBaseUrl || '/api/momentum';

  async get(): Promise<SniperView | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ sniper?: SniperView }>(`${this.base}/sniper`, { headers: this.kiteHeader() }),
      );
      return res?.sniper ?? null;
    } catch {
      return null;
    }
  }

  async set(body: { running?: boolean; live?: boolean; session?: SniperSession | null; mode?: string }): Promise<SniperView | null> {
    try {
      const res = await firstValueFrom(
        this.http.put<{ sniper?: SniperView }>(`${this.base}/sniper`, body, { headers: this.kiteHeader() }),
      );
      return res?.sniper ?? null;
    } catch {
      return null;
    }
  }

  beacon(body: { running?: boolean; live?: boolean; session?: SniperSession | null; mode?: string }): void {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const site = this.auth.getToken();
      if (site) headers['Authorization'] = `Bearer ${site}`;
      const kite = this.kiteSession.getAuthorizationHeader();
      if (kite) headers['X-Kite-Authorization'] = kite;
      void fetch(`${this.base}/sniper`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch {
      /* closing */
    }
  }

  private kiteHeader(): Record<string, string> {
    const kite = this.kiteSession.getAuthorizationHeader();
    return kite ? { 'X-Kite-Authorization': kite } : {};
  }
}

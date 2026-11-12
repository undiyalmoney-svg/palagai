import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { LivePaperSession } from './live-paper.engine';
import { PaperLiveBooks } from './paper-live-order.util';

export interface PaperLiveView {
  running?: boolean;
  live?: boolean;
  books?: PaperLiveBooks;
  lastTick?: string | null;
  lastError?: string | null;
  lastMessage?: string | null;
  sessionOk?: boolean;
  dropletWatching?: boolean;
  dropletPlacing?: boolean;
  session?: LivePaperSession | null;
}

/**
 * Talks to the droplet Paper Live worker. Failures are swallowed so a down
 * API never blocks the tab from ticking paper or placing locally.
 */
@Injectable({ providedIn: 'root' })
export class PaperLiveApiService {
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly auth = inject(AuthService);
  private readonly base =
    (environment as { momentumApiBaseUrl?: string }).momentumApiBaseUrl || '/api/momentum';

  async get(): Promise<PaperLiveView | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ paperLive?: PaperLiveView }>(`${this.base}/paper-live`, {
          headers: this.kiteHeader(),
        }),
      );
      return res?.paperLive ?? null;
    } catch {
      return null;
    }
  }

  async set(body: {
    running?: boolean;
    live?: boolean;
    books?: PaperLiveBooks;
    session?: LivePaperSession | null;
  }): Promise<PaperLiveView | null> {
    try {
      const res = await firstValueFrom(
        this.http.put<{ paperLive?: PaperLiveView }>(`${this.base}/paper-live`, body, {
          headers: this.kiteHeader(),
        }),
      );
      return res?.paperLive ?? null;
    } catch {
      return null;
    }
  }

  /** Tab close / hide — droplet keeps the last arm even if this request is cancelled. */
  beacon(body: {
    running?: boolean;
    live?: boolean;
    books?: PaperLiveBooks;
    session?: LivePaperSession | null;
  }): void {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const site = this.auth.getToken();
      if (site) headers['Authorization'] = `Bearer ${site}`;
      const kite = this.kiteSession.getAuthorizationHeader();
      if (kite) headers['X-Kite-Authorization'] = kite;
      void fetch(`${this.base}/paper-live`, {
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

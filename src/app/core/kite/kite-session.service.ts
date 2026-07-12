import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface KiteSessionData {
  user_id: string;
  api_key: string;
  access_token: string;
  public_token?: string;
  refresh_token?: string;
  enctoken?: string;
  login_time?: string;
  avatar_url?: string | null;
  meta?: Record<string, unknown>;
}

export interface KiteSession {
  data: KiteSessionData;
  savedAt: string;
}

interface KiteSessionTokenResponse {
  status?: string;
  data?: KiteSessionData;
}

const STORAGE_KEY = 'palagai_kite_session';

@Injectable({ providedIn: 'root' })
export class KiteSessionService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly session = signal<KiteSession | null>(this.readFromStorage());

  readonly storedSession = this.session.asReadonly();

  hasSession(): boolean {
    return this.session() !== null;
  }

  getSession(): KiteSession | null {
    return this.session();
  }

  getAuthorizationHeader(): string | null {
    const session = this.session();
    if (!session?.data.api_key || !session.data.access_token) {
      return null;
    }

    return `token ${session.data.api_key}:${session.data.access_token}`;
  }

  saveFromTokenResponse(response: unknown): boolean {
    const parsed = response as KiteSessionTokenResponse;
    if (parsed?.status !== 'success' || !parsed.data?.access_token || !parsed.data?.api_key) {
      return false;
    }

    const session: KiteSession = {
      data: parsed.data,
      savedAt: new Date().toISOString(),
    };

    this.persistToStorage(session);
    this.session.set(session);
    return true;
  }

  clearSession(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(STORAGE_KEY);
    }
    this.session.set(null);
  }

  private readFromStorage(): KiteSession | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as KiteSession;
      if (!parsed?.data?.access_token || !parsed?.data?.api_key) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private persistToStorage(session: KiteSession): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
}

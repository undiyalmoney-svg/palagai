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
  /** Palagai site user id — prevents Devil/customer Kite bleed. */
  siteUserId?: string;
}

interface KiteSessionTokenResponse {
  status?: string;
  data?: KiteSessionData;
}

const LEGACY_STORAGE_KEY = 'palagai_kite_session';
const STORAGE_PREFIX = 'palagai_kite_session:';

@Injectable({ providedIn: 'root' })
export class KiteSessionService {
  private readonly platformId = inject(PLATFORM_ID);
  private activeSiteUserId: string | null = null;
  private readonly session = signal<KiteSession | null>(null);

  readonly storedSession = this.session.asReadonly();

  /**
   * Load this site user's Kite session only.
   * Clears in-memory session when switching users so customers never inherit Devil's token.
   */
  bindSiteUser(siteUserId: string | null | undefined): void {
    const id = String(siteUserId || '').trim();
    if (!id) {
      this.activeSiteUserId = null;
      this.session.set(null);
      return;
    }
    // Already bound with an in-memory session — keep it (e.g. just exchanged).
    if (this.activeSiteUserId === id && this.session()) {
      return;
    }
    // Was unbound but we already hold a session in memory (persist was skipped) —
    // stamp the user id and write localStorage now so UI + reloads keep the token.
    const mem = this.session();
    if (!this.activeSiteUserId && mem?.data?.access_token) {
      this.activeSiteUserId = id;
      this.persist({ ...mem, siteUserId: id });
      this.session.set({ ...mem, siteUserId: id });
      return;
    }
    this.activeSiteUserId = id;
    const scoped = this.readKey(this.keyFor(id));
    if (scoped) {
      this.session.set({ ...scoped, siteUserId: id });
      this.purgeLegacyIfForeign(id);
      return;
    }
    // Do not reuse unscoped legacy session for another account.
    this.purgeLegacyIfForeign(id);
    this.session.set(null);
  }

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
      siteUserId: this.activeSiteUserId || undefined,
    };
    this.persist(session);
    this.session.set(session);
    return true;
  }

  /** Manual paste (local/dev) — skips Kite redirect exchange. */
  saveManualAccessToken(params: {
    apiKey: string;
    accessToken: string;
    userId?: string;
  }): boolean {
    const apiKey = params.apiKey.trim();
    const accessToken = params.accessToken.trim();
    if (!apiKey || !accessToken) {
      return false;
    }
    const session: KiteSession = {
      data: {
        user_id: params.userId?.trim() || 'manual',
        api_key: apiKey,
        access_token: accessToken,
        login_time: new Date().toISOString(),
      },
      savedAt: new Date().toISOString(),
      siteUserId: this.activeSiteUserId || undefined,
    };
    this.persist(session);
    this.session.set(session);
    return true;
  }

  clearSession(): void {
    if (isPlatformBrowser(this.platformId)) {
      if (this.activeSiteUserId) {
        localStorage.removeItem(this.keyFor(this.activeSiteUserId));
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    this.session.set(null);
  }

  /** Wipe every stored Kite access token (e.g. different Palagai username logged in). */
  clearAllSessions(): void {
    if (isPlatformBrowser(this.platformId)) {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key === LEGACY_STORAGE_KEY || key.startsWith(STORAGE_PREFIX))) {
          toRemove.push(key);
        }
      }
      for (const key of toRemove) {
        localStorage.removeItem(key);
      }
    }
    this.session.set(null);
  }

  /** Drop active memory without deleting other users' stored sessions. */
  detach(): void {
    this.activeSiteUserId = null;
    this.session.set(null);
  }

  private keyFor(siteUserId: string): string {
    return `${STORAGE_PREFIX}${siteUserId}`;
  }

  private purgeLegacyIfForeign(siteUserId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const legacy = this.readKey(LEGACY_STORAGE_KEY);
    if (!legacy) return;
    if (legacy.siteUserId && legacy.siteUserId === siteUserId) {
      // Migrate legacy into scoped key once.
      this.persistToKey(this.keyFor(siteUserId), { ...legacy, siteUserId });
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  private persist(session: KiteSession): void {
    if (!this.activeSiteUserId) {
      // Refuse to write a shared global session — would leak across accounts.
      return;
    }
    const stamped = { ...session, siteUserId: this.activeSiteUserId };
    this.persistToKey(this.keyFor(this.activeSiteUserId), stamped);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  }

  private persistToKey(key: string, session: KiteSession): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(key, JSON.stringify(session));
  }

  private readKey(key: string): KiteSession | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as KiteSession;
      if (!parsed?.data?.access_token || !parsed?.data?.api_key) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

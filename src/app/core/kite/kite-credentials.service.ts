import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface KiteCredentials {
  apiKey: string;
  apiSecret: string;
  siteUserId?: string;
}

const LEGACY_STORAGE_KEY = 'palagai_kite_credentials';
const STORAGE_PREFIX = 'palagai_kite_credentials:';

@Injectable({ providedIn: 'root' })
export class KiteCredentialsService {
  private readonly platformId = inject(PLATFORM_ID);
  private activeSiteUserId: string | null = null;
  private readonly credentials = signal<KiteCredentials | null>(null);

  readonly storedCredentials = this.credentials.asReadonly();

  /** Load credentials for this Palagai user only (Devil vs customer isolation). */
  bindSiteUser(siteUserId: string | null | undefined): void {
    const id = String(siteUserId || '').trim();
    if (!id) {
      this.activeSiteUserId = null;
      this.credentials.set(null);
      return;
    }
    if (this.activeSiteUserId === id && this.credentials()) {
      return;
    }
    this.activeSiteUserId = id;
    const scoped = this.readKey(this.keyFor(id));
    if (scoped) {
      this.credentials.set({ ...scoped, siteUserId: id });
      this.purgeLegacy();
      return;
    }
    this.purgeLegacy();
    this.credentials.set(null);
  }

  hasCredentials(): boolean {
    return this.credentials() !== null;
  }

  getCredentials(): KiteCredentials | null {
    return this.credentials();
  }

  saveCredentials(credentials: KiteCredentials): void {
    const trimmed: KiteCredentials = {
      apiKey: credentials.apiKey.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
      apiSecret: credentials.apiSecret
        .replace(/^\uFEFF/, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim(),
      siteUserId: this.activeSiteUserId || undefined,
    };
    if (!this.activeSiteUserId) return;
    this.persistToKey(this.keyFor(this.activeSiteUserId), trimmed);
    this.purgeLegacy();
    this.credentials.set(trimmed);
  }

  clearCredentials(): void {
    if (isPlatformBrowser(this.platformId)) {
      if (this.activeSiteUserId) {
        localStorage.removeItem(this.keyFor(this.activeSiteUserId));
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    this.credentials.set(null);
  }

  detach(): void {
    this.activeSiteUserId = null;
    this.credentials.set(null);
  }

  private keyFor(siteUserId: string): string {
    return `${STORAGE_PREFIX}${siteUserId}`;
  }

  private purgeLegacy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  private persistToKey(key: string, credentials: KiteCredentials): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(key, JSON.stringify(credentials));
  }

  private readKey(key: string): KiteCredentials | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<KiteCredentials>;
      if (!parsed.apiKey?.trim() || !parsed.apiSecret?.trim()) return null;
      return {
        apiKey: parsed.apiKey.trim(),
        apiSecret: parsed.apiSecret.trim(),
        siteUserId: parsed.siteUserId,
      };
    } catch {
      return null;
    }
  }
}

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

  /**
   * Load credentials for this Palagai user only (Devil vs customer isolation).
   * Migrates legacy unscoped `palagai_kite_credentials` into the per-user key
   * instead of deleting it (that wipe caused OAuth “Key/Secret not saved”).
   */
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

    let scoped = this.readKey(this.keyFor(id));
    if (!scoped) {
      const legacy = this.readKey(LEGACY_STORAGE_KEY);
      if (legacy?.apiKey && legacy?.apiSecret) {
        const migrated: KiteCredentials = { ...legacy, siteUserId: id };
        this.persistToKey(this.keyFor(id), migrated);
        scoped = migrated;
      }
    }

    if (scoped) {
      this.credentials.set({ ...scoped, siteUserId: id });
      this.purgeLegacy();
      return;
    }

    this.credentials.set(null);
  }

  hasCredentials(): boolean {
    return this.credentials() !== null;
  }

  getCredentials(): KiteCredentials | null {
    return this.credentials();
  }

  /** Force re-read from localStorage for the bound user (or migrate legacy). */
  reloadForActiveUser(): KiteCredentials | null {
    if (!this.activeSiteUserId) {
      return this.credentials();
    }
    const id = this.activeSiteUserId;
    this.activeSiteUserId = null; // allow bind to re-run
    this.bindSiteUser(id);
    return this.credentials();
  }

  saveCredentials(credentials: KiteCredentials): void {
    const trimmed: KiteCredentials = {
      apiKey: sanitize(credentials.apiKey),
      apiSecret: sanitize(credentials.apiSecret),
      siteUserId: this.activeSiteUserId || undefined,
    };
    if (!trimmed.apiKey || !trimmed.apiSecret) {
      throw new Error('API Key and API Secret are both required.');
    }
    if (!this.activeSiteUserId) {
      throw new Error('Sign in to Palagai first — API credentials are saved per user.');
    }
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
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
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
      const apiKey = sanitize(parsed.apiKey ?? '');
      const apiSecret = sanitize(parsed.apiSecret ?? '');
      if (!apiKey || !apiSecret) return null;
      return {
        apiKey,
        apiSecret,
        siteUserId: parsed.siteUserId,
      };
    } catch {
      return null;
    }
  }
}

function sanitize(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

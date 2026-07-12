import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface KiteCredentials {
  apiKey: string;
  apiSecret: string;
}

const STORAGE_KEY = 'palagai_kite_credentials';

@Injectable({ providedIn: 'root' })
export class KiteCredentialsService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly credentials = signal<KiteCredentials | null>(this.readFromStorage());

  readonly storedCredentials = this.credentials.asReadonly();

  hasCredentials(): boolean {
    return this.credentials() !== null;
  }

  getCredentials(): KiteCredentials | null {
    return this.credentials();
  }

  saveCredentials(credentials: KiteCredentials): void {
    const trimmed: KiteCredentials = {
      apiKey: credentials.apiKey.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
      apiSecret: credentials.apiSecret.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
    };
    this.persistToStorage(trimmed);
    this.credentials.set(trimmed);
  }

  clearCredentials(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(STORAGE_KEY);
    }
    this.credentials.set(null);
  }

  private readFromStorage(): KiteCredentials | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<KiteCredentials>;
      if (!parsed.apiKey?.trim() || !parsed.apiSecret?.trim()) {
        return null;
      }

      return {
        apiKey: parsed.apiKey.trim(),
        apiSecret: parsed.apiSecret.trim(),
      };
    } catch {
      return null;
    }
  }

  private persistToStorage(credentials: KiteCredentials): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  }
}

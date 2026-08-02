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

  /** Re-read localStorage (call after hydration / on Get Token open). */
  reloadFromStorage(): KiteCredentials | null {
    const stored = this.readFromStorage();
    this.credentials.set(stored);
    return stored;
  }

  saveCredentials(credentials: KiteCredentials): void {
    const trimmed: KiteCredentials = {
      apiKey: sanitizeCredential(credentials.apiKey),
      apiSecret: sanitizeCredential(credentials.apiSecret),
    };
    if (!trimmed.apiKey || !trimmed.apiSecret) {
      throw new Error('API Key and API Secret are both required.');
    }
    this.persistToStorage(trimmed);
    this.credentials.set(trimmed);
  }

  clearCredentials(): void {
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
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
      const apiKey = sanitizeCredential(parsed.apiKey ?? '');
      const apiSecret = sanitizeCredential(parsed.apiSecret ?? '');
      if (!apiKey || !apiSecret) {
        return null;
      }

      return { apiKey, apiSecret };
    } catch {
      return null;
    }
  }

  private persistToStorage(credentials: KiteCredentials): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
      // Verify round-trip so silent quota / private-mode failures surface.
      const verify = localStorage.getItem(STORAGE_KEY);
      if (!verify) {
        throw new Error('localStorage write did not stick');
      }
      const parsed = JSON.parse(verify) as Partial<KiteCredentials>;
      if (
        sanitizeCredential(parsed.apiKey ?? '') !== credentials.apiKey ||
        sanitizeCredential(parsed.apiSecret ?? '') !== credentials.apiSecret
      ) {
        throw new Error('localStorage verify mismatch');
      }
    } catch (err) {
      const message =
        err instanceof Error && /quota|storage/i.test(err.message)
          ? 'Browser storage is full — clear Instruments cache in Settings, then save API credentials again.'
          : 'Could not save API credentials to browser storage. Check private mode / site data permissions.';
      throw new Error(message);
    }
  }
}

function sanitizeCredential(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

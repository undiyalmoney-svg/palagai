import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';

const STORAGE_KEY = 'palagai_lots_multiplier';

@Injectable({ providedIn: 'root' })
export class LotsPreferenceService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly lots = signal(this.readInitial());

  readonly value = this.lots.asReadonly();

  get(): number {
    return this.lots();
  }

  set(lots: number): void {
    const normalized = Math.max(1, Math.floor(Number(lots)) || 1);
    this.lots.set(normalized);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(STORAGE_KEY, String(normalized));
    }
  }

  private readInitial(): number {
    const envDefault = (environment as { defaultLots?: number }).defaultLots;
    const fallback = envDefault && envDefault > 0 ? Math.floor(envDefault) : 1;

    if (!isPlatformBrowser(this.platformId)) {
      return fallback;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return fallback;
      }
      const parsed = Math.floor(Number(raw));
      return parsed > 0 ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
}

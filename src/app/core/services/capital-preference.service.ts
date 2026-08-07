import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DEFAULT_TRADING_CAPITAL_RS } from '../paper-desk/capital-plan.util';

const STORAGE_KEY = 'palagai_trading_capital_rs';

@Injectable({ providedIn: 'root' })
export class CapitalPreferenceService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly capital = signal(this.readInitial());

  readonly value = this.capital.asReadonly();

  get(): number {
    return this.capital();
  }

  set(capitalRs: number): void {
    const normalized = Math.max(
      10_000,
      Math.floor(Number(capitalRs) || DEFAULT_TRADING_CAPITAL_RS),
    );
    this.capital.set(normalized);
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(STORAGE_KEY, String(normalized));
      } catch {
        // ignore quota / private mode
      }
    }
  }

  private readInitial(): number {
    if (!isPlatformBrowser(this.platformId)) {
      return DEFAULT_TRADING_CAPITAL_RS;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return DEFAULT_TRADING_CAPITAL_RS;
      }
      const parsed = Math.floor(Number(raw));
      return parsed >= 10_000 ? parsed : DEFAULT_TRADING_CAPITAL_RS;
    } catch {
      return DEFAULT_TRADING_CAPITAL_RS;
    }
  }
}

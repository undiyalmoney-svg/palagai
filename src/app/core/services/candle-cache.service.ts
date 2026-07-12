import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Candle, Timeframe } from '../models/candle.model';

const CACHE_PREFIX = 'palagai_candle_cache_';

@Injectable({ providedIn: 'root' })
export class CandleCacheService {
  private readonly platformId = inject(PLATFORM_ID);

  private cacheKey(
    instrumentToken: number,
    timeframe: Timeframe,
    fromDateTime: string,
    toDateTime: string,
  ): string {
    return `${CACHE_PREFIX}${instrumentToken}_${timeframe}_${fromDateTime}_${toDateTime}`;
  }

  get(
    instrumentToken: number,
    timeframe: Timeframe,
    fromDateTime: string,
    toDateTime: string,
  ): Candle[] | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    try {
      const raw = localStorage.getItem(
        this.cacheKey(instrumentToken, timeframe, fromDateTime, toDateTime),
      );
      return raw ? (JSON.parse(raw) as Candle[]) : null;
    } catch {
      return null;
    }
  }

  set(
    instrumentToken: number,
    timeframe: Timeframe,
    fromDateTime: string,
    toDateTime: string,
    candles: Candle[],
  ): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    localStorage.setItem(
      this.cacheKey(instrumentToken, timeframe, fromDateTime, toDateTime),
      JSON.stringify(candles),
    );
  }

  clearAll(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    Object.keys(localStorage)
      .filter((key) => key.startsWith(CACHE_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  }
}

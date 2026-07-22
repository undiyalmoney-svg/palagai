import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const STORAGE_KEY = 'palagai_ruler_mtd_v1';

interface TradeRecord {
  /** Unique key: channel|date|entryTime */
  key: string;
  channel: 'nifty' | 'bank';
  date: string;
  inr: number;
}

interface PersistedState {
  yearMonth: string;
  trades: TradeRecord[];
}

/**
 * Persists Ruler month-to-date ₹ PnL (Nifty + Bank combined).
 * Idempotent by trade key so live day-replays do not double-count.
 */
@Injectable({ providedIn: 'root' })
export class RulerMonthStateService {
  private readonly platformId = inject(PLATFORM_ID);
  private yearMonth = this.currentYearMonth();
  private trades = new Map<string, TradeRecord>();

  constructor() {
    this.load();
  }

  /** Combined Nifty + Bank MTD in ₹ for the current calendar month. */
  combinedMtdInr(): number {
    this.rollMonthIfNeeded();
    let sum = 0;
    for (const t of this.trades.values()) {
      sum += t.inr;
    }
    return sum;
  }

  mtdInr(channel: 'nifty' | 'bank'): number {
    this.rollMonthIfNeeded();
    let sum = 0;
    for (const t of this.trades.values()) {
      if (t.channel === channel) {
        sum += t.inr;
      }
    }
    return sum;
  }

  /**
   * Record (or replace) a closed trade's ₹ PnL.
   * Safe to call on every live replay tick.
   */
  recordTrade(params: {
    channel: 'nifty' | 'bank';
    date: string;
    entryTime: string;
    inr: number;
  }): void {
    this.rollMonthIfNeeded(params.date);
    if (params.date.slice(0, 7) !== this.yearMonth) {
      return;
    }
    const key = `${params.channel}|${params.date}|${params.entryTime}`;
    this.trades.set(key, {
      key,
      channel: params.channel,
      date: params.date,
      inr: params.inr,
    });
    this.persist();
  }

  clear(): void {
    this.trades.clear();
    this.yearMonth = this.currentYearMonth();
    this.persist();
  }

  private rollMonthIfNeeded(refDate?: string): void {
    const ym = (refDate ?? this.currentYearMonth()).slice(0, 7);
    if (ym !== this.yearMonth) {
      this.yearMonth = ym;
      this.trades.clear();
      this.persist();
    }
  }

  private currentYearMonth(): string {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${m}`;
  }

  private load(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as PersistedState;
      const ym = this.currentYearMonth();
      if (parsed.yearMonth !== ym) {
        this.yearMonth = ym;
        this.trades.clear();
        this.persist();
        return;
      }
      this.yearMonth = parsed.yearMonth;
      this.trades.clear();
      for (const t of parsed.trades ?? []) {
        if (t?.key) {
          this.trades.set(t.key, t);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private persist(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const payload: PersistedState = {
      yearMonth: this.yearMonth,
      trades: [...this.trades.values()],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}

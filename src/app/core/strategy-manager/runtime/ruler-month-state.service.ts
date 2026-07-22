import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { clipRulerDayInr } from '../engines/ruler-morning.util';

const STORAGE_KEY = 'palagai_ruler_mtd_v2';
const LEGACY_KEY = 'palagai_ruler_mtd_v1';

interface TradeRecord {
  /** Unique key: channel|date|entryTime */
  key: string;
  channel: 'nifty' | 'bank';
  date: string;
  inr: number;
}

interface PersistedState {
  /** yearMonth → trades */
  months: Record<string, TradeRecord[]>;
}

/**
 * Persists Ruler month-to-date ₹ PnL (Nifty + Bank combined), keyed by calendar month.
 * Idempotent by trade key so live day-replays do not double-count.
 * Reads always use the as-of trade date's month (so June paper tests are not
 * poisoned by July live ticks).
 *
 * `combinedMtdInr` applies research dyn0 day-clip on prior days (not raw trail sums).
 */
@Injectable({ providedIn: 'root' })
export class RulerMonthStateService {
  private readonly platformId = inject(PLATFORM_ID);
  /** yearMonth → tradeKey → record */
  private readonly months = new Map<string, Map<string, TradeRecord>>();

  constructor() {
    this.load();
  }

  /**
   * Combined Nifty + Bank MTD in ₹ for the month of `asOfDate` (YYYY-MM-DD).
   * When `asOfDate` is set, only **prior** calendar days are included (research witch/MTD).
   * Each prior day is dyn0-clipped before summing.
   */
  combinedMtdInr(asOfDate?: string): number {
    const ym = this.yearMonthOf(asOfDate);
    const byDate = new Map<string, number>();
    for (const t of this.monthTrades(ym).values()) {
      if (asOfDate && t.date >= asOfDate) {
        continue;
      }
      byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.inr);
    }
    const dates = [...byDate.keys()].sort();
    let mtd = 0;
    for (const d of dates) {
      mtd += clipRulerDayInr(byDate.get(d) ?? 0, mtd);
    }
    return mtd;
  }

  /** Raw combined ₹ for one calendar day (both channels). */
  dayInr(date: string): number {
    const ym = date.slice(0, 7);
    let sum = 0;
    for (const t of this.monthTrades(ym).values()) {
      if (t.date === date) {
        sum += t.inr;
      }
    }
    return sum;
  }

  mtdInr(channel: 'nifty' | 'bank', asOfDate?: string): number {
    const ym = this.yearMonthOf(asOfDate);
    let sum = 0;
    for (const t of this.monthTrades(ym).values()) {
      if (asOfDate && t.date >= asOfDate) {
        continue;
      }
      if (t.channel === channel) {
        sum += t.inr;
      }
    }
    return sum;
  }

  /**
   * Record (or replace) a closed trade's ₹ PnL into that trade's calendar month.
   * Safe to call on every live replay tick.
   */
  recordTrade(params: {
    channel: 'nifty' | 'bank';
    date: string;
    entryTime: string;
    inr: number;
  }): void {
    const ym = params.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      return;
    }
    const key = `${params.channel}|${params.date}|${params.entryTime}`;
    this.monthTrades(ym).set(key, {
      key,
      channel: params.channel,
      date: params.date,
      inr: params.inr,
    });
    this.persist();
  }

  clear(): void {
    this.months.clear();
    this.persist();
  }

  private monthTrades(ym: string): Map<string, TradeRecord> {
    let m = this.months.get(ym);
    if (!m) {
      m = new Map();
      this.months.set(ym, m);
    }
    return m;
  }

  private yearMonthOf(asOfDate?: string): string {
    if (asOfDate && asOfDate.length >= 7) {
      return asOfDate.slice(0, 7);
    }
    return this.currentYearMonth();
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
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedState;
        this.months.clear();
        for (const [ym, trades] of Object.entries(parsed.months ?? {})) {
          const map = new Map<string, TradeRecord>();
          for (const t of trades ?? []) {
            if (t?.key) {
              map.set(t.key, t);
            }
          }
          this.months.set(ym, map);
        }
        return;
      }
      // One-time migrate v1 (single-month) if present.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy) as { yearMonth?: string; trades?: TradeRecord[] };
        if (parsed.yearMonth && parsed.trades?.length) {
          const map = new Map<string, TradeRecord>();
          for (const t of parsed.trades) {
            if (t?.key) {
              map.set(t.key, t);
            }
          }
          this.months.set(parsed.yearMonth, map);
        }
        localStorage.removeItem(LEGACY_KEY);
        this.persist();
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    }
  }

  private persist(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const months: Record<string, TradeRecord[]> = {};
    for (const [ym, map] of this.months) {
      months[ym] = [...map.values()];
    }
    const payload: PersistedState = { months };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}

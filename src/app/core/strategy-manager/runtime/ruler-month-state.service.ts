import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { clipRulerDayInr } from '../engines/ruler-morning.util';

export type RulerRiskScope = 'live' | 'testing';

const LIVE_STORAGE_KEY = 'palagai_ruler_mtd_live_v2';
/** Legacy shared key — migrated into live once, never written by Testing. */
const LEGACY_SHARED_KEY = 'palagai_ruler_mtd_v2';
const LEGACY_V1_KEY = 'palagai_ruler_mtd_v1';

interface TradeRecord {
  /** Unique key: channel|date|entryTime */
  key: string;
  channel: 'nifty' | 'bank';
  date: string;
  inr: number;
}

interface PersistedState {
  months: Record<string, TradeRecord[]>;
}

/**
 * Ruler month-to-date ₹ (Nifty + Bank), scoped so Testing cannot poison Live.
 *
 * - `live` scope: persisted (broker-day continuity for witch / day-cap)
 * - `testing` scope: memory only, cleared at each Testing Start
 *
 * `combinedMtdInr(asOf)` = dyn0-clipped sum of **prior** days in that month.
 */
@Injectable({ providedIn: 'root' })
export class RulerMonthStateService {
  private readonly platformId = inject(PLATFORM_ID);
  private scope: RulerRiskScope = 'live';
  private readonly liveMonths = new Map<string, Map<string, TradeRecord>>();
  private readonly testingMonths = new Map<string, Map<string, TradeRecord>>();

  constructor() {
    this.loadLive();
  }

  getScope(): RulerRiskScope {
    return this.scope;
  }

  /** Switch active scope (Testing vs Live). Does not clear the other scope. */
  setScope(scope: RulerRiskScope): void {
    this.scope = scope;
  }

  /**
   * Combined Nifty + Bank MTD in ₹ for the month of `asOfDate`.
   * When `asOfDate` is set, only prior calendar days count (research witch/MTD).
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

  /** Raw combined ₹ for one calendar day (both channels) in the active scope. */
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
    if (this.scope === 'live') {
      this.persistLive();
    }
  }

  /** Clear testing memory only — never touches live persistence. */
  clearTesting(): void {
    this.testingMonths.clear();
  }

  /**
   * @deprecated Prefer clearTesting() / never clear live from paper runs.
   * Kept for callers: only clears the active scope.
   */
  clear(): void {
    if (this.scope === 'testing') {
      this.clearTesting();
      return;
    }
    this.liveMonths.clear();
    this.persistLive();
  }

  private activeMonths(): Map<string, Map<string, TradeRecord>> {
    return this.scope === 'testing' ? this.testingMonths : this.liveMonths;
  }

  private monthTrades(ym: string): Map<string, TradeRecord> {
    const root = this.activeMonths();
    let m = root.get(ym);
    if (!m) {
      m = new Map();
      root.set(ym, m);
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

  private loadLive(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const raw =
        localStorage.getItem(LIVE_STORAGE_KEY) ?? localStorage.getItem(LEGACY_SHARED_KEY);
      if (raw) {
        this.hydrateLive(JSON.parse(raw) as PersistedState);
        // Migrate legacy shared key into live-only key and drop shared writes.
        if (!localStorage.getItem(LIVE_STORAGE_KEY) && localStorage.getItem(LEGACY_SHARED_KEY)) {
          this.persistLive();
          localStorage.removeItem(LEGACY_SHARED_KEY);
        }
        return;
      }
      const legacy = localStorage.getItem(LEGACY_V1_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy) as { yearMonth?: string; trades?: TradeRecord[] };
        if (parsed.yearMonth && parsed.trades?.length) {
          const map = new Map<string, TradeRecord>();
          for (const t of parsed.trades) {
            if (t?.key) {
              map.set(t.key, t);
            }
          }
          this.liveMonths.set(parsed.yearMonth, map);
        }
        localStorage.removeItem(LEGACY_V1_KEY);
        this.persistLive();
      }
    } catch {
      localStorage.removeItem(LIVE_STORAGE_KEY);
      localStorage.removeItem(LEGACY_SHARED_KEY);
      localStorage.removeItem(LEGACY_V1_KEY);
    }
  }

  private hydrateLive(parsed: PersistedState): void {
    this.liveMonths.clear();
    for (const [ym, trades] of Object.entries(parsed.months ?? {})) {
      const map = new Map<string, TradeRecord>();
      for (const t of trades ?? []) {
        if (t?.key) {
          map.set(t.key, t);
        }
      }
      this.liveMonths.set(ym, map);
    }
  }

  private persistLive(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const months: Record<string, TradeRecord[]> = {};
    for (const [ym, map] of this.liveMonths) {
      months[ym] = [...map.values()];
    }
    localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify({ months } satisfies PersistedState));
  }
}

import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HistoricalTest } from '../models/historical-test.model';
import { ACTIVE_STRATEGY_IDS, PAUSED_STRATEGY_IDS } from '../config/strategy-ids.config';

const STORAGE_KEY = 'palagai_historical_tests';

@Injectable({ providedIn: 'root' })
export class ResultsStoreService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly tests = signal<HistoricalTest[]>([]);

  readonly allTests = this.tests.asReadonly();

  constructor() {
    const loaded = this.readFromStorage();
    this.tests.set(loaded);
    if (isPlatformBrowser(this.platformId)) {
      this.purgeLegacyFromStorage();
    }
  }

  getById(id: string): HistoricalTest | undefined {
    return this.tests().find((t) => t.id === id);
  }

  save(test: HistoricalTest): void {
    const sanitized = this.sanitizeTest(test);
    const list = [sanitized, ...this.tests().filter((t) => t.id !== sanitized.id)];
    this.persist(list);
  }

  search(filters: {
    date?: string;
    instrument?: string;
    strategy?: string;
  }): HistoricalTest[] {
    return this.tests().filter((test) => {
      if (filters.date && !test.replayDate.includes(filters.date)) {
        return false;
      }
      if (
        filters.instrument &&
        !test.instrumentSymbol.toLowerCase().includes(filters.instrument.toLowerCase())
      ) {
        return false;
      }
      if (filters.strategy) {
        const match = test.strategyResults.some((r) =>
          r.strategyName.toLowerCase().includes(filters.strategy!.toLowerCase()),
        );
        if (!match) {
          return false;
        }
      }
      return true;
    });
  }

  clearAll(): void {
    this.persist([]);
  }

  /** Remove saved runs that used legacy research strategies (Strategy 1/2/3). */
  purgeLegacyTests(): number {
    const kept = this.tests().filter((test) => !this.isLegacyTest(test));
    const removed = this.tests().length - kept.length;
    if (removed > 0) {
      this.persist(kept);
    }
    return removed;
  }

  private purgeLegacyFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as HistoricalTest[];
      const kept = parsed.filter((test) => !this.isLegacyTest(test));
      if (kept.length !== parsed.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
        this.tests.set(kept);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      this.tests.set([]);
    }
  }

  isLegacyTest(test: HistoricalTest): boolean {
    return test.strategyResults.some(
      (r) =>
        PAUSED_STRATEGY_IDS.has(r.strategyId) ||
        r.strategyName.startsWith('Strategy 1') ||
        r.strategyName.startsWith('Strategy 2') ||
        r.strategyName.startsWith('Strategy 3'),
    );
  }

  clearTradesOnly(): void {
    const cleared = this.tests().map((test) => ({ ...test, trades: [] }));
    this.persist(cleared);
  }

  private readFromStorage(): HistoricalTest[] {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as HistoricalTest[]) : [];
      return parsed.filter((test) => !this.isLegacyTest(test));
    } catch {
      return [];
    }
  }

  private sanitizeTest(test: HistoricalTest): HistoricalTest {
    const strategyResults = test.strategyResults.filter((r) => ACTIVE_STRATEGY_IDS.has(r.strategyId));
    const trades = test.trades.filter((t) => ACTIVE_STRATEGY_IDS.has(t.strategyId));
    return {
      ...test,
      strategyResults,
      trades,
      bestStrategyName: strategyResults[0]?.strategyName ?? test.bestStrategyName,
    };
  }

  private persist(list: HistoricalTest[]): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
    this.tests.set(list);
  }
}

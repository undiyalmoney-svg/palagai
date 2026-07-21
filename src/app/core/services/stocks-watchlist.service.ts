import { Injectable, signal } from '@angular/core';

export interface StocksWatchItem {
  symbol: string;
  name: string;
  instrumentToken: number;
  enabled: boolean;
  /** From research or custom */
  source: 'treasure' | 'custom';
  strategyId?: string;
}

const STORAGE_KEY = 'palagai_stocks_watchlist_v3';

/**
 * ₹500/day champion book — all use GAP_FADE_500 (desk caps max 3 by gap rank).
 * See docs/owner-private/08-STOCKS-500-DAY-HUNT.md
 */
const DEFAULT_WATCH: StocksWatchItem[] = [
  {
    symbol: 'APOLLOHOSP',
    name: 'Apollo Hospitals',
    instrumentToken: 40193,
    enabled: true,
    source: 'treasure',
    strategyId: 'GAP_FADE_500',
  },
  {
    symbol: 'BRITANNIA',
    name: 'Britannia Industries',
    instrumentToken: 140033,
    enabled: true,
    source: 'treasure',
    strategyId: 'GAP_FADE_500',
  },
  {
    symbol: 'CIPLA',
    name: 'Cipla',
    instrumentToken: 177665,
    enabled: true,
    source: 'treasure',
    strategyId: 'GAP_FADE_500',
  },
  {
    symbol: 'HDFCLIFE',
    name: 'HDFC Life Insurance',
    instrumentToken: 119553,
    enabled: true,
    source: 'treasure',
    strategyId: 'GAP_FADE_500',
  },
  {
    symbol: 'NESTLEIND',
    name: 'Nestle India',
    instrumentToken: 4598529,
    enabled: true,
    source: 'treasure',
    strategyId: 'GAP_FADE_500',
  },
  {
    symbol: 'NTPC',
    name: 'NTPC',
    instrumentToken: 2977281,
    enabled: true,
    source: 'treasure',
    strategyId: 'GAP_FADE_500',
  },
  {
    symbol: 'SUNPHARMA',
    name: 'Sun Pharmaceutical',
    instrumentToken: 857857,
    enabled: true,
    source: 'treasure',
    strategyId: 'GAP_FADE_500',
  },
  {
    symbol: 'TATACONSUM',
    name: 'Tata Consumer Products',
    instrumentToken: 878593,
    enabled: true,
    source: 'treasure',
    strategyId: 'GAP_FADE_500',
  },
];

@Injectable({ providedIn: 'root' })
export class StocksWatchlistService {
  private readonly items = signal<StocksWatchItem[]>(this.read());

  readonly watchlist = this.items.asReadonly();

  enabledItems(): StocksWatchItem[] {
    return this.items().filter((x) => x.enabled && x.instrumentToken > 0);
  }

  setEnabled(symbol: string, enabled: boolean): void {
    this.items.update((list) =>
      list.map((x) => (x.symbol === symbol ? { ...x, enabled } : x)),
    );
    this.persist();
  }

  remove(symbol: string): void {
    this.items.update((list) => list.filter((x) => x.symbol !== symbol));
    this.persist();
  }

  upsertCustom(item: Omit<StocksWatchItem, 'source' | 'enabled'> & { enabled?: boolean }): void {
    const next: StocksWatchItem = {
      ...item,
      symbol: item.symbol.toUpperCase(),
      enabled: item.enabled ?? true,
      source: 'custom',
    };
    this.items.update((list) => {
      const without = list.filter((x) => x.symbol !== next.symbol);
      return [...without, next];
    });
    this.persist();
  }

  applyTreasure(
    treasure: Array<{ symbol: string; name?: string; instrumentToken: number; strategyId?: string }>,
  ): void {
    const customs = this.items().filter((x) => x.source === 'custom');
    const treasureItems: StocksWatchItem[] = treasure.map((t) => ({
      symbol: t.symbol.toUpperCase(),
      name: t.name ?? t.symbol,
      instrumentToken: t.instrumentToken,
      enabled: true,
      source: 'treasure',
      strategyId: t.strategyId,
    }));
    const customSyms = new Set(customs.map((c) => c.symbol));
    this.items.set([...treasureItems.filter((t) => !customSyms.has(t.symbol)), ...customs]);
    this.persist();
  }

  resetToTreasure(): void {
    const customs = this.items().filter((x) => x.source === 'custom');
    this.items.set([...DEFAULT_WATCH.map((x) => ({ ...x })), ...customs]);
    this.persist();
  }

  private read(): StocksWatchItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return DEFAULT_WATCH.map((x) => ({ ...x }));
      }
      const parsed = JSON.parse(raw) as StocksWatchItem[];
      if (!Array.isArray(parsed) || !parsed.length) {
        return DEFAULT_WATCH.map((x) => ({ ...x }));
      }
      return parsed;
    } catch {
      return DEFAULT_WATCH.map((x) => ({ ...x }));
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items()));
    } catch {
      /* ignore quota */
    }
  }
}

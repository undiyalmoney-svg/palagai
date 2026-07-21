import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DeskChannel } from '../models/desk-channel.model';

export interface StrategyPerfTrade {
  strategyId: string;
  channel: DeskChannel;
  mode: 'paper' | 'live' | 'shadow' | 'backtest';
  direction: 'BUY' | 'SELL';
  entryTime: string;
  exitTime: string;
  points: number;
  exitReason: string;
  instrumentId: string;
}

export interface StrategyPerformance {
  strategyId: string;
  trades: number;
  wins: number;
  losses: number;
  netPoints: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdown: number | null;
}

const STORAGE_KEY = 'palagai_strategy_perf_v1';

@Injectable({ providedIn: 'root' })
export class StrategyPerformanceService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly tradesSignal = signal<StrategyPerfTrade[]>([]);
  readonly trades = this.tradesSignal.asReadonly();

  constructor() {
    this.load();
  }

  record(trade: StrategyPerfTrade): void {
    this.tradesSignal.update((xs) => [trade, ...xs].slice(0, 5000));
    this.persist();
  }

  recordMany(trades: StrategyPerfTrade[]): void {
    if (!trades.length) {
      return;
    }
    this.tradesSignal.update((xs) => [...trades, ...xs].slice(0, 5000));
    this.persist();
  }

  clear(strategyId?: string): void {
    if (!strategyId) {
      this.tradesSignal.set([]);
    } else {
      this.tradesSignal.update((xs) => xs.filter((t) => t.strategyId !== strategyId));
    }
    this.persist();
  }

  performance(strategyId: string, channel?: DeskChannel): StrategyPerformance {
    let rows = this.tradesSignal().filter((t) => t.strategyId === strategyId);
    if (channel) {
      rows = rows.filter((t) => t.channel === channel);
    }
    // chronological for DD
    const chrono = [...rows].reverse();
    const wins = chrono.filter((t) => t.points > 0);
    const losses = chrono.filter((t) => t.points <= 0);
    const net = chrono.reduce((a, t) => a + t.points, 0);
    const winSum = wins.reduce((a, t) => a + t.points, 0);
    const lossSum = Math.abs(losses.reduce((a, t) => a + t.points, 0));
    let eq = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of chrono) {
      eq += t.points;
      peak = Math.max(peak, eq);
      maxDd = Math.min(maxDd, eq - peak);
    }
    return {
      strategyId,
      trades: chrono.length,
      wins: wins.length,
      losses: losses.length,
      netPoints: Math.round(net * 10) / 10,
      winRate: chrono.length ? Math.round((wins.length / chrono.length) * 1000) / 10 : null,
      profitFactor: lossSum > 0 ? Math.round((winSum / lossSum) * 1000) / 1000 : wins.length ? 999 : null,
      expectancy: chrono.length ? Math.round((net / chrono.length) * 100) / 100 : null,
      maxDrawdown: chrono.length ? Math.round(maxDd * 10) / 10 : null,
    };
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
      this.tradesSignal.set(JSON.parse(raw) as StrategyPerfTrade[]);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private persist(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tradesSignal()));
  }
}

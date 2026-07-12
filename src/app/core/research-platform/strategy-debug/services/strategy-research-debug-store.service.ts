import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { StrategyResearchDebugRun } from '../models/strategy-research-debug.model';

const STORAGE_KEY = 'palagai_strategy_research_debug_runs';

@Injectable({ providedIn: 'root' })
export class StrategyResearchDebugStoreService {
  private readonly platformId = inject(PLATFORM_ID);
  readonly runs = signal<StrategyResearchDebugRun[]>(this.load());

  save(run: StrategyResearchDebugRun): void {
    const list = [run, ...this.load().filter((r) => r.id !== run.id)].slice(0, 10);
    this.runs.set(list);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // storage full
    }
  }

  getById(id: string): StrategyResearchDebugRun | undefined {
    return this.load().find((r) => r.id === id);
  }

  private load(): StrategyResearchDebugRun[] {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StrategyResearchDebugRun[]) : [];
    } catch {
      return [];
    }
  }
}

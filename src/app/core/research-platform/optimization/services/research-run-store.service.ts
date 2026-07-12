import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ResearchOptimizationRun } from '../models/research-optimization.model';

const STORAGE_KEY = 'palagai_research_optimization_runs';

@Injectable({ providedIn: 'root' })
export class ResearchRunStoreService {
  private readonly platformId = inject(PLATFORM_ID);
  readonly runs = signal<ResearchOptimizationRun[]>(this.load());

  save(run: ResearchOptimizationRun): void {
    const list = [run, ...this.load().filter((r) => r.id !== run.id)].slice(0, 20);
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

  getById(id: string): ResearchOptimizationRun | undefined {
    return this.load().find((r) => r.id === id);
  }

  private load(): ResearchOptimizationRun[] {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ResearchOptimizationRun[]) : [];
    } catch {
      return [];
    }
  }
}

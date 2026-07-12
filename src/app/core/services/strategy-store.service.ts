import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Strategy, StrategyType } from '../models/strategy.model';
import { createId } from '../utils/id.util';

const STORAGE_KEY = 'palagai_strategies';

function emptyRules(): Strategy['rules'] {
  return {
    trend: {},
    pattern: {},
    momentum: {},
    marketStructure: {},
    volume: {},
    entry: {},
    exit: {},
    confidence: {},
  };
}

function createDefaultStrategy(
  type: StrategyType,
  name: string,
  description: string,
  rules: Partial<Strategy['rules']>,
): Strategy {
  const now = new Date().toISOString();
  return {
    id: createId('strategy'),
    version: 1,
    name,
    description,
    enabled: true,
    type,
    stopLossMethod: 'fixed_points',
    stopLossValue: 20,
    targetMethod: 'risk_reward',
    targetValue: 2,
    riskRewardRatio: 2,
    rules: { ...emptyRules(), ...rules },
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

@Injectable({ providedIn: 'root' })
export class StrategyStoreService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly strategies = signal<Strategy[]>(this.readFromStorage());

  readonly allStrategies = this.strategies.asReadonly();

  enabledStrategies(): Strategy[] {
    return this.strategies().filter((s) => s.enabled);
  }

  getById(id: string): Strategy | undefined {
    return this.strategies().find((s) => s.id === id);
  }

  save(strategy: Strategy): void {
    const list = [...this.strategies()];
    const index = list.findIndex((s) => s.id === strategy.id);
    const updated = { ...strategy, updatedAt: new Date().toISOString() };
    if (index >= 0) {
      list[index] = updated;
    } else {
      list.push(updated);
    }
    this.persist(list);
  }

  create(strategy: Omit<Strategy, 'id' | 'version' | 'createdAt' | 'updatedAt'>): Strategy {
    const now = new Date().toISOString();
    const created: Strategy = {
      ...strategy,
      id: createId('strategy'),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.persist([...this.strategies(), created]);
    return created;
  }

  duplicate(id: string): Strategy | null {
    const source = this.getById(id);
    if (!source) {
      return null;
    }
    const now = new Date().toISOString();
    const copy: Strategy = {
      ...structuredClone(source),
      id: createId('strategy'),
      name: `${source.name} (Copy)`,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.persist([...this.strategies(), copy]);
    return copy;
  }

  delete(id: string): void {
    this.persist(this.strategies().filter((s) => s.id !== id));
  }

  toggleEnabled(id: string, enabled: boolean): void {
    const strategy = this.getById(id);
    if (!strategy) {
      return;
    }
    this.save({ ...strategy, enabled });
  }

  ensureDefaults(): void {
    if (this.strategies().length > 0) {
      return;
    }
    const defaults = [
      createDefaultStrategy(
        'ema_crossover',
        'EMA Crossover Trend',
        'Buys when fast EMA crosses above slow EMA and sells on reverse crossover.',
        {
          trend: { fastPeriod: 9, slowPeriod: 21 },
          momentum: { minConfidence: 55 },
        },
      ),
      createDefaultStrategy(
        'rsi_momentum',
        'RSI Momentum Reversal',
        'Buys oversold RSI reversals and sells overbought reversals.',
        {
          momentum: { rsiPeriod: 14, oversold: 30, overbought: 70 },
        },
      ),
      createDefaultStrategy(
        'breakout_structure',
        'Breakout Structure',
        'Trades breakouts above recent swing high with volume confirmation.',
        {
          marketStructure: { lookback: 20, volumeMultiplier: 1.2 },
          volume: { minVolume: 1000 },
        },
      ),
    ];
    this.persist(defaults);
  }

  clearAll(): void {
    this.persist([]);
  }

  private readFromStorage(): Strategy[] {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Strategy[]) : [];
    } catch {
      return [];
    }
  }

  private persist(list: Strategy[]): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
    this.strategies.set(list);
  }
}

import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { IStrategyPlugin } from '../interfaces/strategy-plugin.interface';
import { TradingStrategyPlugin } from '../adapters/trading-strategy.plugin';
import { PdhlOpeningRangeStrategy } from '../../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.strategy';
import { SESSION_CLOSE_EXIT_POLICY } from '../../trading/models/exit-policy.model';
import { AppLoggerService } from '../../shared/logging/app-logger.service';
import { ACTIVE_STRATEGY_IDS, STRATEGY_IDS } from '../../config/strategy-ids.config';

const STORAGE_KEY = 'palagai_strategy_registry';

export interface ActiveStrategyInfo {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  [STRATEGY_IDS.PDHL_OPENING_RANGE]:
    'OR bias + swing breakout · SL Nifty 30 / Bank 45 · 1R · EMA-20 · day −60 · Tue/Fri 11:30 caps · Wed Nifty OR<90 / Bank 11:30×2.',
};

/**
 * Central strategy engine — registers active strategy plugins.
 */
@Injectable({ providedIn: 'root' })
export class StrategyEngineService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly pdhlOpeningRange = inject(PdhlOpeningRangeStrategy);
  private readonly logger = inject(AppLoggerService);

  private readonly plugins: IStrategyPlugin[];

  constructor() {
    this.plugins = [
      new TradingStrategyPlugin(this.pdhlOpeningRange, SESSION_CLOSE_EXIT_POLICY.policy),
    ];
    this.resetEnabledStateIfLegacy();
    this.loadEnabledState();
    this.logger.info('StrategyEngine', `Registered ${this.plugins.length} strategy plugin(s)`);
  }

  getAll(): IStrategyPlugin[] {
    return [...this.plugins];
  }

  getEnabled(): IStrategyPlugin[] {
    return this.plugins.filter((p) => p.enabled);
  }

  getById(id: string): IStrategyPlugin | undefined {
    return this.plugins.find((p) => p.id === id);
  }

  getActiveStrategyInfo(): ActiveStrategyInfo[] {
    return this.plugins.map((p) => ({
      id: p.id,
      name: p.name,
      description: STRATEGY_DESCRIPTIONS[p.id] ?? '',
      enabled: p.enabled,
    }));
  }

  setEnabled(id: string, enabled: boolean): void {
    const plugin = this.getById(id);
    if (!plugin) {
      return;
    }
    plugin.enabled = enabled;
    this.persistEnabledState();
  }

  initializeAll(): void {
    for (const plugin of this.plugins) {
      plugin.initialize();
    }
  }

  resetAll(): void {
    for (const plugin of this.plugins) {
      plugin.reset();
    }
  }

  private resetEnabledStateIfLegacy(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const enabledMap = JSON.parse(raw) as Record<string, boolean>;
      const hasLegacyKeys = Object.keys(enabledMap).some((id) => !ACTIVE_STRATEGY_IDS.has(id));
      if (hasLegacyKeys) {
        localStorage.removeItem(STORAGE_KEY);
        for (const plugin of this.plugins) {
          plugin.enabled = true;
        }
        this.persistEnabledState();
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private loadEnabledState(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const enabledMap = JSON.parse(raw) as Record<string, boolean>;
      for (const plugin of this.plugins) {
        if (typeof enabledMap[plugin.id] === 'boolean') {
          plugin.enabled = enabledMap[plugin.id]!;
        }
      }
    } catch {
      // Ignore corrupt storage — defaults stay enabled.
    }
  }

  private persistEnabledState(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const enabledMap = Object.fromEntries(this.plugins.map((p) => [p.id, p.enabled]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabledMap));
  }
}

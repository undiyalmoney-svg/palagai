import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  DeskChannel,
  DESK_CHANNELS,
  ExecutionMode,
} from '../models/desk-channel.model';
import {
  DEFAULT_CHANNEL_ASSIGNMENTS,
  MANAGED_STRATEGY_IDS,
} from '../config/managed-strategy-ids';
import { StrategySettings } from '../models/strategy-settings.model';
import { StrategyRegistryService } from '../registry/strategy-registry.service';

const STORAGE_KEY = 'palagai_strategy_assignments_v11';
const LEGACY_STORAGE_KEYS = [
  'palagai_strategy_assignments_v1',
  'palagai_strategy_assignments_v2',
  'palagai_strategy_assignments_v3',
  'palagai_strategy_assignments_v4',
  'palagai_strategy_assignments_v5',
  'palagai_strategy_assignments_v6',
  'palagai_strategy_assignments_v7',
  'palagai_strategy_assignments_v8',
  'palagai_strategy_assignments_v9',
  'palagai_strategy_assignments_v10',
] as const;

export interface ChannelAssignment {
  paper: string;
  live: string;
  /** Shadow strategy id — signals only, no orders. null = off. */
  shadow: string | null;
}

export type AssignmentMap = Record<DeskChannel, ChannelAssignment>;

export type SettingsMap = Record<string, Partial<StrategySettings>>;

interface PersistedState {
  assignments: AssignmentMap;
  settings: SettingsMap;
}

function defaultAssignments(): AssignmentMap {
  return {
    nifty: { ...DEFAULT_CHANNEL_ASSIGNMENTS.nifty },
    bank: { ...DEFAULT_CHANNEL_ASSIGNMENTS.bank },
    stocks: { ...DEFAULT_CHANNEL_ASSIGNMENTS.stocks },
  };
}

/**
 * Persists paper/live/shadow strategy selection and per-strategy settings.
 * Selection never requires code changes.
 */
@Injectable({ providedIn: 'root' })
export class StrategyAssignmentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly registry = inject(StrategyRegistryService);

  private readonly assignmentsSignal = signal<AssignmentMap>(defaultAssignments());
  private settingsMap: SettingsMap = {};

  readonly assignments = this.assignmentsSignal.asReadonly();

  constructor() {
    this.load();
  }

  getAssignment(channel: DeskChannel): ChannelAssignment {
    return this.assignmentsSignal()[channel];
  }

  getStrategyId(channel: DeskChannel, mode: ExecutionMode): string {
    const a = this.getAssignment(channel);
    return mode === 'live' ? a.live : a.paper;
  }

  getShadowStrategyId(channel: DeskChannel): string | null {
    return this.getAssignment(channel).shadow;
  }

  setStrategy(
    channel: DeskChannel,
    mode: ExecutionMode | 'shadow',
    strategyId: string | null,
  ): void {
    if (mode !== 'shadow' && !strategyId) {
      return;
    }
    if (strategyId) {
      const mod = this.registry.getById(strategyId);
      if (!mod || !mod.supports.includes(channel)) {
        return;
      }
    }
    const next = { ...this.assignmentsSignal() };
    const cur = { ...next[channel] };
    if (mode === 'paper') {
      cur.paper = strategyId!;
    } else if (mode === 'live') {
      cur.live = strategyId!;
    } else {
      cur.shadow = strategyId;
    }
    next[channel] = cur;
    this.assignmentsSignal.set(next);
    this.persist();
  }

  getStrategySettings(strategyId: string): Partial<StrategySettings> {
    return { ...(this.settingsMap[strategyId] ?? {}) };
  }

  updateStrategySettings(
    strategyId: string,
    partial: Partial<StrategySettings>,
  ): void {
    const mod = this.registry.getById(strategyId);
    if (!mod) {
      return;
    }
    const merged = { ...(this.settingsMap[strategyId] ?? {}), ...partial };
    this.settingsMap[strategyId] = merged;
    // Always re-base from module defaults + overrides (same path as desk hydrate).
    mod.initialize(merged);
    this.persist();
  }

  resetStrategySettings(strategyId: string): void {
    delete this.settingsMap[strategyId];
    const mod = this.registry.getById(strategyId);
    mod?.initialize();
    this.persist();
  }

  /** Apply stored overrides onto a module before a run. */
  hydrateModule(strategyId: string): void {
    const mod = this.registry.getById(strategyId);
    if (!mod) {
      return;
    }
    const stored = this.settingsMap[strategyId];
    mod.initialize(stored);
  }

  resetAllAssignmentsToDefaults(): void {
    this.assignmentsSignal.set(defaultAssignments());
    this.settingsMap = {};
    for (const m of this.registry.getAll()) {
      m.initialize();
    }
    this.persist();
  }

  private load(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      // Drop legacy assignment keys so research defaults + trade-count settings apply once.
      for (const key of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(key);
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.persist();
        return;
      }
      const parsed = JSON.parse(raw) as PersistedState;
      const base = defaultAssignments();
      for (const ch of DESK_CHANNELS) {
        const a = parsed.assignments?.[ch];
        if (!a) {
          continue;
        }
        if (typeof a.paper === 'string' && this.registry.getById(a.paper)) {
          base[ch].paper = a.paper;
        }
        if (typeof a.live === 'string' && this.registry.getById(a.live)) {
          base[ch].live = a.live;
        }
        if (a.shadow == null || this.registry.getById(a.shadow)) {
          base[ch].shadow = a.shadow ?? null;
        }
      }
      this.assignmentsSignal.set(base);
      this.settingsMap = parsed.settings ?? {};
      for (const [id, partial] of Object.entries(this.settingsMap)) {
        this.registry.getById(id)?.initialize(partial);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      this.assignmentsSignal.set(defaultAssignments());
      this.persist();
    }
  }

  private persist(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const payload: PersistedState = {
      assignments: this.assignmentsSignal(),
      settings: this.settingsMap,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}

/** Default live strategy for Trade Desk resolution fallback. */
export const DEFAULT_LIVE_STRATEGY_ID = MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15;

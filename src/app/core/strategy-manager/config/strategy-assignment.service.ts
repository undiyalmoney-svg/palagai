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

/** v10: Nifty/Bank are Ruler-only (no competing strategy selection). */
const STORAGE_KEY = 'palagai_strategy_assignments_v10';
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
  /** Always true for Nifty/Bank Ruler-only product mode. */
  rulerEnabled?: boolean;
}

function defaultAssignments(): AssignmentMap {
  return {
    nifty: { ...DEFAULT_CHANNEL_ASSIGNMENTS.nifty },
    bank: { ...DEFAULT_CHANNEL_ASSIGNMENTS.bank },
    stocks: { ...DEFAULT_CHANNEL_ASSIGNMENTS.stocks },
  };
}

function isIndexChannel(channel: DeskChannel): boolean {
  return channel === 'nifty' || channel === 'bank';
}

/**
 * Persists stocks paper/live/shadow selection and per-strategy settings.
 * Nifty + Bank always resolve to Ruler flow (no alternate strategy UI).
 */
@Injectable({ providedIn: 'root' })
export class StrategyAssignmentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly registry = inject(StrategyRegistryService);

  private readonly assignmentsSignal = signal<AssignmentMap>(defaultAssignments());
  /** Always on — kept as a signal so existing templates keep working. */
  private readonly rulerEnabledSignal = signal(true);
  private settingsMap: SettingsMap = {};

  readonly assignments = this.assignmentsSignal.asReadonly();
  readonly rulerEnabled = this.rulerEnabledSignal.asReadonly();

  constructor() {
    this.load();
  }

  getAssignment(channel: DeskChannel): ChannelAssignment {
    return this.assignmentsSignal()[channel];
  }

  /** Nifty/Bank always run Ruler. */
  isRulerEnabled(): boolean {
    return true;
  }

  /** No-op: Ruler cannot be turned off for index desks. */
  setRulerEnabled(_enabled: boolean): void {
    this.rulerEnabledSignal.set(true);
    this.persist();
  }

  getStrategyId(channel: DeskChannel, mode: ExecutionMode): string {
    if (isIndexChannel(channel)) {
      return MANAGED_STRATEGY_IDS.RULER;
    }
    const a = this.getAssignment(channel);
    return mode === 'live' ? a.live : a.paper;
  }

  getShadowStrategyId(channel: DeskChannel): string | null {
    // Index desks stay Ruler-only — no shadow alternate.
    if (isIndexChannel(channel)) {
      return null;
    }
    return this.getAssignment(channel).shadow;
  }

  setStrategy(
    channel: DeskChannel,
    mode: ExecutionMode | 'shadow',
    strategyId: string | null,
  ): void {
    // Nifty/Bank assignments are locked to Ruler — ignore UI / legacy callers.
    if (isIndexChannel(channel)) {
      return;
    }
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
    this.rulerEnabledSignal.set(true);
    this.settingsMap = {};
    for (const m of this.registry.getAll()) {
      m.initialize();
    }
    this.persist();
  }

  private load(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.rulerEnabledSignal.set(true);
      return;
    }
    try {
      for (const key of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(key);
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.rulerEnabledSignal.set(true);
        this.persist();
        return;
      }
      const parsed = JSON.parse(raw) as PersistedState;
      const base = defaultAssignments();
      // Only restore stocks assignments — index channels stay Ruler defaults.
      const stocks = parsed.assignments?.stocks;
      if (stocks) {
        if (typeof stocks.paper === 'string' && this.registry.getById(stocks.paper)) {
          base.stocks.paper = stocks.paper;
        }
        if (typeof stocks.live === 'string' && this.registry.getById(stocks.live)) {
          base.stocks.live = stocks.live;
        }
        if (stocks.shadow == null || this.registry.getById(stocks.shadow)) {
          base.stocks.shadow = stocks.shadow ?? null;
        }
      }
      this.assignmentsSignal.set(base);
      this.rulerEnabledSignal.set(true);
      this.settingsMap = parsed.settings ?? {};
      for (const [id, partial] of Object.entries(this.settingsMap)) {
        this.registry.getById(id)?.initialize(partial);
      }
      this.persist();
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      this.assignmentsSignal.set(defaultAssignments());
      this.rulerEnabledSignal.set(true);
      this.settingsMap = {};
    }
  }

  private persist(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    // Always pin index channels to Ruler in storage.
    const assignments = defaultAssignments();
    assignments.stocks = { ...this.assignmentsSignal().stocks };
    const payload: PersistedState = {
      assignments,
      settings: this.settingsMap,
      rulerEnabled: true,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}

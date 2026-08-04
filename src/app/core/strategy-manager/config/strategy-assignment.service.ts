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
import {
  dnaCapsForStrategy,
  PROTECTION_DNA_EXTRAS,
  TRAP_ENTRY_DNA_EXTRAS,
  usesProtectionDna,
  usesTrapEntryDna,
} from '../config/strategy-dna-caps';
import { StrategySettings } from '../models/strategy-settings.model';
import { StrategyRegistryService } from '../registry/strategy-registry.service';

/**
 * v22 — Desk ₹3k hunt: Trap piercePts 5 + protect arm₹400 (doc 43).
 * Drops v21 so stale pierce 3 cannot stick.
 */
const STORAGE_KEY = 'palagai_strategy_assignments_v22';
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
  'palagai_strategy_assignments_v11',
  'palagai_strategy_assignments_v12',
  'palagai_strategy_assignments_v13',
  'palagai_strategy_assignments_v14',
  'palagai_strategy_assignments_v15',
  'palagai_strategy_assignments_v16',
  'palagai_strategy_assignments_v17',
  'palagai_strategy_assignments_v18',
  'palagai_strategy_assignments_v19',
  'palagai_strategy_assignments_v20',
  'palagai_strategy_assignments_v21',
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
    // Auto-sync DNA (unlimited max trades + research R) whenever assignment changes.
    if (strategyId && (mode === 'paper' || mode === 'live')) {
      this.applyDnaCaps(strategyId, channel);
    }
    this.persist();
  }

  /**
   * When user switches strategy, settings snap to research DNA.
   * Max trades are always unlimited (0); target R still channel-aware.
   */
  applyDnaCaps(strategyId: string, channel: DeskChannel): void {
    const mod = this.registry.getById(strategyId);
    if (!mod) {
      return;
    }
    const caps = dnaCapsForStrategy(strategyId, channel);
    const patch: Partial<StrategySettings> = {
      maxTradesPerDay: caps.maxTradesPerDay,
    };
    if (caps.targetRMultiple != null) {
      patch.targetRMultiple = caps.targetRMultiple;
    }
    if (usesProtectionDna(strategyId) || usesTrapEntryDna(strategyId)) {
      patch.extras = {
        ...(usesProtectionDna(strategyId) ? PROTECTION_DNA_EXTRAS : {}),
        ...(usesTrapEntryDna(strategyId) ? TRAP_ENTRY_DNA_EXTRAS : {}),
      };
    }
    // Persist under channel-scoped key so Nifty/Bank DNA do not overwrite each other.
    const key = settingsKey(strategyId, channel);
    const merged = { ...(this.settingsMap[strategyId] ?? {}), ...(this.settingsMap[key] ?? {}), ...patch };
    if (usesProtectionDna(strategyId) || usesTrapEntryDna(strategyId)) {
      merged.extras = {
        ...(merged.extras ?? {}),
        ...(usesProtectionDna(strategyId) ? PROTECTION_DNA_EXTRAS : {}),
        ...(usesTrapEntryDna(strategyId) ? TRAP_ENTRY_DNA_EXTRAS : {}),
      };
    }
    this.settingsMap[key] = merged;
    mod.initialize(merged);
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
    for (const ch of DESK_CHANNELS) {
      delete this.settingsMap[settingsKey(strategyId, ch)];
    }
    const mod = this.registry.getById(strategyId);
    mod?.initialize();
    this.persist();
  }

  /**
   * Apply stored overrides onto a module before a run.
   * When `channel` is set, DNA for THAT channel wins (unlimited max trades + research R).
   */
  hydrateModule(strategyId: string, channel?: DeskChannel): void {
    const mod = this.registry.getById(strategyId);
    if (!mod) {
      return;
    }
    const shared = this.settingsMap[strategyId] ?? {};
    if (!channel) {
      mod.initialize(shared);
      return;
    }
    const caps = dnaCapsForStrategy(strategyId, channel);
    const scoped = this.settingsMap[settingsKey(strategyId, channel)] ?? {};
    const merged: Partial<StrategySettings> = {
      ...shared,
      ...scoped,
      maxTradesPerDay: caps.maxTradesPerDay,
    };
    if (caps.targetRMultiple != null) {
      merged.targetRMultiple = caps.targetRMultiple;
    }
    // Force researched peak-trail / soft cutoff / Trap pierce (stale DNA must not stick).
    if (usesProtectionDna(strategyId) || usesTrapEntryDna(strategyId)) {
      merged.extras = {
        ...(merged.extras ?? {}),
        ...(usesProtectionDna(strategyId) ? PROTECTION_DNA_EXTRAS : {}),
        ...(usesTrapEntryDna(strategyId) ? TRAP_ENTRY_DNA_EXTRAS : {}),
      };
    }
    mod.initialize(merged);
  }

  /** Re-apply DNA caps for every assigned Paper/Live strategy (startup / storage migrate). */
  reapplyDnaCapsForAssignments(): void {
    const map = this.assignmentsSignal();
    for (const ch of DESK_CHANNELS) {
      const a = map[ch];
      if (a.paper) {
        this.applyDnaCaps(a.paper, ch);
      }
      if (a.live && a.live !== a.paper) {
        this.applyDnaCaps(a.live, ch);
      }
    }
  }

  resetAllAssignmentsToDefaults(): void {
    this.assignmentsSignal.set(defaultAssignments());
    this.settingsMap = {};
    for (const m of this.registry.getAll()) {
      m.initialize();
    }
    this.reapplyDnaCapsForAssignments();
    this.persist();
  }

  /**
   * Daily ₹3k desk: force Trap Paper+Live on Nifty/Bank and re-apply protect DNA.
   * Leaves stocks assignment untouched.
   */
  forceTrapDefaultsForDaily3k(): void {
    const trap = MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM;
    const next = { ...this.assignmentsSignal() };
    next.nifty = { paper: trap, live: trap, shadow: next.nifty.shadow };
    next.bank = { paper: trap, live: trap, shadow: next.bank.shadow };
    this.assignmentsSignal.set(next);
    this.applyDnaCaps(trap, 'nifty');
    this.applyDnaCaps(trap, 'bank');
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
        this.reapplyDnaCapsForAssignments();
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
      // DNA always wins for max trades after migrate — fixes Trap stuck at 1.
      this.reapplyDnaCapsForAssignments();
      for (const [id, partial] of Object.entries(this.settingsMap)) {
        if (id.includes('::')) {
          continue;
        }
        this.registry.getById(id)?.initialize(partial);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      this.assignmentsSignal.set(defaultAssignments());
      this.reapplyDnaCapsForAssignments();
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

/** Channel-scoped settings key — keeps Genie Nifty≠Bank DNA from clobbering. */
export function settingsKey(strategyId: string, channel: DeskChannel): string {
  return `${strategyId}::${channel}`;
}

/** Default live strategy for Trade Desk resolution fallback. */
export const DEFAULT_LIVE_STRATEGY_ID = MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM;

import { Injectable, inject, signal } from '@angular/core';
import { DeskChannel, ExecutionMode } from '../models/desk-channel.model';
import { IManagedStrategy } from '../models/strategy-module.interface';
import { StrategySettings } from '../models/strategy-settings.model';
import { StrategyRegistryService } from '../registry/strategy-registry.service';
import { StrategyAssignmentService } from '../config/strategy-assignment.service';
import { StrategyEventLogger } from '../runtime/strategy-event-logger.service';
import { ChampionPdhlManagedStrategy } from '../modules/champion-pdhl.managed-strategy';
import { PdhlOrParams } from '../../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';

export interface ResolvedStrategies {
  channel: DeskChannel;
  mode: ExecutionMode;
  primary: IManagedStrategy;
  primaryId: string;
  shadow: IManagedStrategy | null;
  shadowId: string | null;
}

/**
 * Strategy Manager — single entry point for desks and backtests.
 * Resolves paper/live/shadow assignments without embedding strategy logic.
 */
@Injectable({ providedIn: 'root' })
export class StrategyManagerService {
  private readonly registry = inject(StrategyRegistryService);
  private readonly assignments = inject(StrategyAssignmentService);
  private readonly logger = inject(StrategyEventLogger);
  private readonly champion = inject(ChampionPdhlManagedStrategy);

  /** Last resolved primary per channel (dashboard). */
  private readonly activeByChannel = signal<Record<DeskChannel, string | null>>({
    nifty: null,
    bank: null,
    stocks: null,
  });

  readonly activeStrategies = this.activeByChannel.asReadonly();

  listStrategies(): IManagedStrategy[] {
    return this.registry.getAll();
  }

  listForChannel(channel: DeskChannel): IManagedStrategy[] {
    return this.registry.listForChannel(channel);
  }

  getById(id: string): IManagedStrategy | undefined {
    return this.registry.getById(id);
  }

  /**
   * Resolve primary (+ optional shadow) for a desk channel and mode.
   * Always hydrates settings and resets day state for an isolated run.
   */
  resolve(channel: DeskChannel, mode: ExecutionMode): ResolvedStrategies {
    const primaryId = this.assignments.getStrategyId(channel, mode);
    const primary = this.prepareRunner(primaryId, channel);
    if (!primary) {
      // Fail-safe: never leave the desk without a strategy — Champion.
      const fallback = this.prepareRunner(MANAGED_STRATEGY_IDS.CHAMPION_PDHL, channel)!;
      this.logger.log({
        type: 'selected',
        strategyId: fallback.id,
        strategyName: fallback.name,
        channel,
        mode,
        message: `Fallback to Champion (missing ${primaryId})`,
      });
      this.patchActive(channel, fallback.id);
      return {
        channel,
        mode,
        primary: fallback,
        primaryId: fallback.id,
        shadow: null,
        shadowId: null,
      };
    }

    const shadowId = this.assignments.getShadowStrategyId(channel);
    let shadow: IManagedStrategy | null = null;
    if (shadowId && shadowId !== primaryId) {
      shadow = this.prepareRunner(shadowId, channel) ?? null;
    }

    this.logger.log({
      type: 'selected',
      strategyId: primary.id,
      strategyName: primary.name,
      channel,
      mode,
      message: shadow
        ? `Primary ${primary.name}; shadow ${shadow.name}`
        : `Primary ${primary.name}`,
    });
    this.patchActive(channel, primary.id);

    return {
      channel,
      mode,
      primary,
      primaryId: primary.id,
      shadow,
      shadowId: shadow?.id ?? null,
    };
  }

  /** Apply Trade Desk risk checkboxes onto Champion only (additive). */
  applyChampionDeskOverrides(overrides: Partial<PdhlOrParams> | null): void {
    this.champion.setPdhlDeskOverrides(overrides);
  }

  updateSettings(strategyId: string, partial: Partial<StrategySettings>): void {
    this.assignments.updateStrategySettings(strategyId, partial);
  }

  getAssignment(channel: DeskChannel) {
    return this.assignments.getAssignment(channel);
  }

  setAssignment(
    channel: DeskChannel,
    mode: ExecutionMode | 'shadow',
    strategyId: string | null,
  ): void {
    this.assignments.setStrategy(channel, mode, strategyId);
  }

  private prepareRunner(
    strategyId: string,
    channel: DeskChannel,
  ): IManagedStrategy | undefined {
    const mod = this.registry.getById(strategyId);
    if (!mod) {
      return undefined;
    }
    // Channel-aware DNA hydrate — Trap stays at 3; Genie Nifty 2 / Bank 1.
    this.assignments.hydrateModule(strategyId, channel);
    mod.reset();
    return mod;
  }

  private patchActive(channel: DeskChannel, id: string): void {
    this.activeByChannel.update((m) => ({ ...m, [channel]: id }));
  }
}

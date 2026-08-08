import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { DeskChannel } from './desk-channel.model';
import { StrategySettings } from './strategy-settings.model';

export type ManagedSignalAction =
  | 'BUY'
  | 'SELL'
  | 'NO_TRADE'
  | 'WAITING'
  | 'SKIPPED';

/** Normalized signal returned by every managed strategy. */
export interface ManagedStrategySignal {
  action: ManagedSignalAction;
  entryPrice: number;
  stopLoss: number;
  target: number;
  riskRewardRatio: number;
  reason: string;
  analysis: Record<string, unknown>;
}

export interface ManagedOpenPosition {
  direction: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  entryTime: string;
  /**
   * Research swing_trail: separate trailing level (does not replace hard `stop`).
   * Ratchets via confirmed swing3; null until first swing prints.
   */
  trail?: number | null;
  /** Running max favorable excursion in index points (desk feeds this). */
  peakMfePts?: number;
  /** Initial risk |entry − stop| at fill (for SL confirm cutoff; stop may ratchet later). */
  initialRiskPts?: number;
  /**
   * Option-premium peak MFE in ₹ (long option: (high−entry)×lot×lots).
   * When set, peak-trail arms only after this clears `profitLockArmRs`
   * (paper≡live — index-only arm caused Locked-green / option-red drains).
   * Omit / null when option marks are unknown → index-only arm (research Locked).
   */
  optionPeakMfeRs?: number | null;
}

export interface ManagedExitDecision {
  exitPrice: number;
  reason: string;
}

/**
 * Common strategy module contract.
 * Trading engine / desks call only this interface — never strategy-specific APIs.
 */
export interface IManagedStrategy {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  /** Channels this module may be assigned to. */
  readonly supports: readonly DeskChannel[];

  /** Factory defaults (immutable snapshot). */
  readonly defaultSettings: StrategySettings;

  initialize(settings?: Partial<StrategySettings>): void;
  reset(): void;

  /** Optional diagnostic snapshot (dashboard / logs). */
  analyze(ctx: StrategyContext): Record<string, unknown>;

  generateSignal(ctx: StrategyContext): ManagedStrategySignal;

  calculateStopLoss(
    ctx: StrategyContext,
    entryPrice: number,
    direction: 'BUY' | 'SELL',
  ): number;

  calculateTarget(
    ctx: StrategyContext,
    entryPrice: number,
    stopLoss: number,
    direction: 'BUY' | 'SELL',
  ): { target: number; riskRewardRatio: number };

  /**
   * Strategy-owned exit logic (SL / TP / EMA / EOD / trail).
   * Return null to keep the position open.
   */
  exitLogic(
    candle: Candle,
    open: ManagedOpenPosition,
    closes: number[],
    ctx: StrategyContext,
  ): ManagedExitDecision | null;

  /** Day P&L bookkeeping after a closed trade (points). */
  onTradeClosed?(points: number, tradingDate: string): void;

  getSettings(): StrategySettings;
  updateSettings(partial: Partial<StrategySettings>): void;
}

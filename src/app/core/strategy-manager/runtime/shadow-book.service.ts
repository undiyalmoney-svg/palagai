import { Injectable, signal } from '@angular/core';
import { DeskChannel, ExecutionMode } from '../models/desk-channel.model';

export interface ShadowSignalRecord {
  id: string;
  at: string;
  channel: DeskChannel;
  mode: ExecutionMode;
  strategyId: string;
  strategyName: string;
  action: string;
  entryPrice: number;
  stopLoss: number;
  target: number;
  reason: string;
  /** Primary strategy action at same bar (for comparison). */
  primaryAction?: string;
  instrumentId: string;
  barTime: string;
}

export interface ShadowTradeRecord {
  id: string;
  channel: DeskChannel;
  strategyId: string;
  strategyName: string;
  direction: 'BUY' | 'SELL';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  points: number;
  exitReason: string;
  instrumentId: string;
}

export interface ShadowComparisonStats {
  signals: number;
  trades: number;
  wins: number;
  losses: number;
  netPoints: number;
  winRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
}

/**
 * Shadow mode book — records signals/trades without placing orders.
 */
@Injectable({ providedIn: 'root' })
export class ShadowBookService {
  private readonly signalsSignal = signal<ShadowSignalRecord[]>([]);
  private readonly tradesSignal = signal<ShadowTradeRecord[]>([]);

  readonly signals = this.signalsSignal.asReadonly();
  readonly trades = this.tradesSignal.asReadonly();

  recordSignal(rec: Omit<ShadowSignalRecord, 'id' | 'at'> & { at?: string }): void {
    const row: ShadowSignalRecord = {
      id: `sh-sig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: rec.at ?? new Date().toISOString(),
      ...rec,
    };
    this.signalsSignal.update((xs) => [row, ...xs].slice(0, 1000));
  }

  recordTrade(rec: Omit<ShadowTradeRecord, 'id'>): void {
    const row: ShadowTradeRecord = {
      id: `sh-tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...rec,
    };
    this.tradesSignal.update((xs) => [row, ...xs].slice(0, 1000));
  }

  clear(channel?: DeskChannel): void {
    if (!channel) {
      this.signalsSignal.set([]);
      this.tradesSignal.set([]);
      return;
    }
    this.signalsSignal.update((xs) => xs.filter((s) => s.channel !== channel));
    this.tradesSignal.update((xs) => xs.filter((t) => t.channel !== channel));
  }

  statsFor(strategyId: string, channel?: DeskChannel): ShadowComparisonStats {
    let trades = this.tradesSignal().filter((t) => t.strategyId === strategyId);
    if (channel) {
      trades = trades.filter((t) => t.channel === channel);
    }
    const wins = trades.filter((t) => t.points > 0);
    const losses = trades.filter((t) => t.points <= 0);
    const net = trades.reduce((a, t) => a + t.points, 0);
    const winSum = wins.reduce((a, t) => a + t.points, 0);
    const lossSum = Math.abs(losses.reduce((a, t) => a + t.points, 0));
    const signals = this.signalsSignal().filter(
      (s) => s.strategyId === strategyId && (!channel || s.channel === channel),
    ).length;
    return {
      signals,
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      netPoints: Math.round(net * 10) / 10,
      winRate: trades.length ? Math.round((wins.length / trades.length) * 1000) / 10 : null,
      expectancy: trades.length ? Math.round((net / trades.length) * 100) / 100 : null,
      profitFactor: lossSum > 0 ? Math.round((winSum / lossSum) * 1000) / 1000 : wins.length ? 999 : null,
    };
  }
}

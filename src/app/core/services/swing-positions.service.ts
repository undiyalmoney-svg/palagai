import { Injectable, inject, signal } from '@angular/core';
import { SwingScannerService } from './swing-scanner.service';
import {
  SwingExitReason,
  evaluateSwingExit,
} from '../strategy-engine/strategies/swing-breakout/swing-breakout.evaluator';

const STORAGE_KEY = 'palagai_swing_positions_v1';

export interface SwingPosition {
  id: string;
  symbol: string;
  entryDate: string;
  entryPrice: number;
  qty: number;
  stop: number;
  target: number;
  addedAt: string;
  /** Set once the position is closed (SELL acted on) — kept for a simple history view. */
  closedAt?: string;
  closedReason?: SwingExitReason;
  closedPrice?: number;
}

export interface SwingPositionSignal {
  position: SwingPosition;
  action: 'HOLD' | 'SELL' | 'ERROR';
  reason: SwingExitReason | 'ERROR';
  currentPrice: number | null;
  daysHeld: number | null;
  pnlRs: number | null;
  pnlPct: number | null;
  message: string | null;
}

@Injectable({ providedIn: 'root' })
export class SwingPositionsService {
  private readonly scanner = inject(SwingScannerService);

  private readonly items = signal<SwingPosition[]>(this.read());
  readonly positions = this.items.asReadonly();

  readonly signals = signal<SwingPositionSignal[]>([]);
  readonly checking = signal(false);
  readonly checkError = signal('');

  add(input: {
    symbol: string;
    entryDate: string;
    entryPrice: number;
    qty: number;
    stop: number;
    target: number;
  }): void {
    const position: SwingPosition = {
      id: `${input.symbol}-${input.entryDate}-${Date.now()}`,
      symbol: input.symbol.trim().toUpperCase(),
      entryDate: input.entryDate,
      entryPrice: input.entryPrice,
      qty: input.qty,
      stop: input.stop,
      target: input.target,
      addedAt: new Date().toISOString(),
    };
    this.items.update((list) => [position, ...list]);
    this.persist();
  }

  remove(id: string): void {
    this.items.update((list) => list.filter((p) => p.id !== id));
    this.signals.update((list) => list.filter((s) => s.position.id !== id));
    this.persist();
  }

  markClosed(id: string, reason: SwingExitReason, price: number): void {
    this.items.update((list) =>
      list.map((p) =>
        p.id === id
          ? { ...p, closedAt: new Date().toISOString(), closedReason: reason, closedPrice: price }
          : p,
      ),
    );
    this.persist();
  }

  /** Re-fetches candles and re-evaluates exit signals for every open position. */
  async refreshSignals(): Promise<void> {
    if (this.checking()) {
      return;
    }
    this.checking.set(true);
    this.checkError.set('');
    const open = this.items().filter((p) => !p.closedAt);
    const out: SwingPositionSignal[] = [];
    try {
      for (const position of open) {
        try {
          const candles = await this.scanner.fetchDailyCandles(position.symbol);
          const check = evaluateSwingExit(candles, position.entryDate, position.stop, position.target);
          if (!check) {
            out.push({
              position,
              action: 'ERROR',
              reason: 'ERROR',
              currentPrice: null,
              daysHeld: null,
              pnlRs: null,
              pnlPct: null,
              message: 'Not enough candle history to evaluate.',
            });
            continue;
          }
          const pnlRs = (check.currentPrice - position.entryPrice) * position.qty;
          const pnlPct = ((check.currentPrice - position.entryPrice) / position.entryPrice) * 100;
          out.push({
            position,
            action: check.action,
            reason: check.reason,
            currentPrice: check.currentPrice,
            daysHeld: check.daysHeld,
            pnlRs,
            pnlPct,
            message: null,
          });
        } catch (err) {
          out.push({
            position,
            action: 'ERROR',
            reason: 'ERROR',
            currentPrice: null,
            daysHeld: null,
            pnlRs: null,
            pnlPct: null,
            message: err instanceof Error ? err.message : 'Failed to fetch candles.',
          });
        }
      }
      this.signals.set(out);
    } catch (err) {
      this.checkError.set(err instanceof Error ? err.message : 'Failed to refresh positions.');
    } finally {
      this.checking.set(false);
    }
  }

  private read(): SwingPosition[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SwingPosition[]) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items()));
    } catch {
      // ignore quota errors — in-memory state still works for this session
    }
  }
}

import { Injectable, signal } from '@angular/core';
import { DeskChannel, ExecutionMode } from '../models/desk-channel.model';

export type StrategyEventType =
  | 'selected'
  | 'signal'
  | 'entry'
  | 'exit'
  | 'stop'
  | 'shadow_signal'
  | 'error';

export interface StrategyEvent {
  at: string;
  type: StrategyEventType;
  strategyId: string;
  strategyName: string;
  channel?: DeskChannel;
  mode?: ExecutionMode | 'shadow';
  message: string;
  data?: Record<string, unknown>;
}

const MAX_EVENTS = 500;

/** Structured strategy execution log for dashboard + console. */
@Injectable({ providedIn: 'root' })
export class StrategyEventLogger {
  private readonly eventsSignal = signal<StrategyEvent[]>([]);
  readonly events = this.eventsSignal.asReadonly();

  log(partial: Omit<StrategyEvent, 'at'> & { at?: string }): void {
    const event: StrategyEvent = {
      at: partial.at ?? new Date().toISOString(),
      type: partial.type,
      strategyId: partial.strategyId,
      strategyName: partial.strategyName,
      channel: partial.channel,
      mode: partial.mode,
      message: partial.message,
      data: partial.data,
    };
    this.eventsSignal.update((list) => {
      const next = [event, ...list];
      return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
    });
    const prefix = `[Strategy:${event.strategyId}]`;
    // eslint-disable-next-line no-console
    console.info(prefix, event.type, event.message, event.data ?? '');
  }

  clear(): void {
    this.eventsSignal.set([]);
  }
}

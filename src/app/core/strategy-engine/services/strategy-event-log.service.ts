import { Injectable, signal } from '@angular/core';
import { StrategyEvent, StrategyEventType } from '../models/strategy-event.model';

const MAX_EVENTS = 200;

@Injectable({ providedIn: 'root' })
export class StrategyEventLogService {
  private readonly events = signal<StrategyEvent[]>([]);

  readonly allEvents = this.events.asReadonly();

  reset(): void {
    this.events.set([]);
  }

  log(params: {
    timestamp: string;
    strategyName: string;
    eventType: StrategyEventType;
    message: string;
  }): void {
    const entry: StrategyEvent = {
      timestamp: params.timestamp,
      strategyName: params.strategyName,
      eventType: params.eventType,
      message: params.message,
    };
    const next = [entry, ...this.events()].slice(0, MAX_EVENTS);
    this.events.set(next);
  }

  getRecent(limit = 50): StrategyEvent[] {
    return this.events().slice(0, limit);
  }
}

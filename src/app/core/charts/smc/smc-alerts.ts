/**
 * Fires each confirmed event once.
 *
 * The engine re-derives every alert from scratch on every poll, and the ids
 * are stable, so "have I told the user about this?" is a set lookup. The first
 * batch a book ever sees is history: it is remembered but never announced, so
 * opening the page does not replay the morning's signals.
 */
import { SmcAlertEvent, SmcAlertType } from './smc.types';

export class SmcAlertTracker {
  private readonly seen = new Map<string, Set<string>>();

  /**
   * @param scope    one stream, e.g. `nifty|15m`
   * @param events   every alert the engine currently derives for it
   * @param enabled  types the user wants to hear about
   * @returns        events not announced before, oldest first
   */
  ingest(
    scope: string,
    events: SmcAlertEvent[],
    enabled: ReadonlySet<SmcAlertType> | null = null,
  ): SmcAlertEvent[] {
    let known = this.seen.get(scope);
    if (!known) {
      known = new Set(events.map((e) => e.id));
      this.seen.set(scope, known);
      return [];
    }
    const fresh: SmcAlertEvent[] = [];
    for (const event of events) {
      if (known.has(event.id)) continue;
      known.add(event.id);
      if (!enabled || enabled.has(event.type)) fresh.push(event);
    }
    return fresh;
  }

  /** Forget a stream, e.g. after the timeframe or date changed. */
  reset(scope?: string): void {
    if (scope) this.seen.delete(scope);
    else this.seen.clear();
  }
}

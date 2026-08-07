import { parseIstTimestamp } from './live-start-guard.util';

/**
 * One round trip per bar, per book.
 *
 * The forming-bar repaint fix stops the churn at its source, but the broker
 * layer must never be able to exit and re-enter the same instrument inside one
 * 5-minute candle again. Each of those flips pays the bid/ask spread and
 * re-enters worse: on 2026-08-07 Bank went out at 603.95 and straight back in
 * at 605.45, twice, before the stop finally hit.
 */
export const REENTRY_BAR_MINUTES = 5;

/** Bucket a timestamp into its 5m bar start (epoch ms). 0 when unparseable. */
export function barBucket(
  timestamp: string | null | undefined,
  barMinutes: number = REENTRY_BAR_MINUTES,
): number {
  const ms = parseIstTimestamp(timestamp);
  if (!ms) {
    return 0;
  }
  const size = barMinutes * 60_000;
  return Math.floor(ms / size) * size;
}

export interface ReentryCheck {
  /** Bar time of the new signal (paper entryTime). */
  signalEntryTime: string | null | undefined;
  /** Bar time of the leg we just exited on this instrument. */
  lastExitEntryTime: string | null | undefined;
  barMinutes?: number;
}

/**
 * True when the new signal sits in the same bar as the leg we just closed,
 * i.e. a same-candle re-entry that only pays the spread.
 */
export function isSameBarReentry(params: ReentryCheck): boolean {
  const next = barBucket(params.signalEntryTime, params.barMinutes);
  const prev = barBucket(params.lastExitEntryTime, params.barMinutes);
  if (!next || !prev) {
    return false;
  }
  return next <= prev;
}

export function sameBarReentryReason(
  signalEntryTime: string | null | undefined,
  lastExitEntryTime: string | null | undefined,
): string {
  void signalEntryTime;
  void lastExitEntryTime;
  return (
    'Same-bar re-entry blocked — the desk already traded this 5m candle. ' +
    'Re-entering now only pays the spread; waiting for the next bar.'
  );
}

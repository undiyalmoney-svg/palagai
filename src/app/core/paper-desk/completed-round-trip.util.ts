/**
 * Never execute a trade that has already finished.
 *
 * The live bar hook was built to catch legs that "open and SL inside one poll".
 * That made sense while the desk read the forming bar and was therefore roughly
 * in sync with the market. Once Live moved to closed bars only (v1.3.79), a tick
 * can see a whole round trip at once: the strategy opened on the 12:05 bar and
 * closed on the 12:10 bar, both already history by the time the tick runs.
 *
 * The hook then dutifully placed a BUY and a SELL seconds apart at market. The
 * modelled trade was +37.5 futures points; what the account got was the spread.
 *
 * 2026-08-07, all on v1.3.80:
 *   BANKNIFTY 57800 PE  buy 12:16:29 @630.00  sell 12:16:47 @624.50   -165
 *   NIFTY    24600 PE   buy 11:54:04 @137.85  sell 11:56:17 @134.80   -198
 *
 * A round trip we only learned about after it ended is a **missed** trade, not a
 * trade to place. Report it and move on.
 */

export interface RoundTripEvent {
  kind: 'open' | 'close';
  instrumentId: string;
  instrumentName: string;
  open?: { entryTime: string } | null;
  entryTime?: string;
  exitReason?: string;
}

export interface RoundTripSplit<T extends RoundTripEvent> {
  /** Events safe to send to the broker. */
  actionable: T[];
  /** Opens whose close arrived in the same batch — already over. */
  missed: Array<{ instrumentId: string; instrumentName: string; entryTime: string; exitReason?: string }>;
}

function openKey(ev: RoundTripEvent): string {
  return `${ev.instrumentId}::${ev.open?.entryTime ?? ''}`;
}

function closeKey(ev: RoundTripEvent): string {
  return `${ev.instrumentId}::${ev.entryTime ?? ''}`;
}

/**
 * Split a tick's bar-hook events into ones worth placing and ones that already
 * completed. An open is dropped only when its matching close is in the same
 * batch; a close with no open here still runs, because it closes a live leg.
 */
export function splitCompletedRoundTrips<T extends RoundTripEvent>(
  events: T[],
): RoundTripSplit<T> {
  const closedKeys = new Map<string, T>();
  for (const ev of events) {
    if (ev.kind === 'close') {
      closedKeys.set(closeKey(ev), ev);
    }
  }

  const actionable: T[] = [];
  const missed: RoundTripSplit<T>['missed'] = [];
  const droppedOpenKeys = new Set<string>();

  for (const ev of events) {
    if (ev.kind === 'open') {
      const key = openKey(ev);
      const match = closedKeys.get(key);
      if (match) {
        droppedOpenKeys.add(key);
        missed.push({
          instrumentId: ev.instrumentId,
          instrumentName: ev.instrumentName,
          entryTime: ev.open?.entryTime ?? '',
          exitReason: match.exitReason,
        });
        continue;
      }
      actionable.push(ev);
      continue;
    }
    // Close: skip it only when we also dropped its open (nothing was placed).
    if (droppedOpenKeys.has(closeKey(ev))) {
      continue;
    }
    actionable.push(ev);
  }

  return { actionable, missed };
}

export function missedRoundTripReason(entryTime: string, exitReason?: string): string {
  const clock = entryTime.replace('T', ' ').slice(11, 16) || entryTime;
  return (
    `Signal opened ${clock} and closed on a later bar before this tick — ` +
    `already over, so no order placed${exitReason ? ` (${exitReason})` : ''}. ` +
    `Buying and selling it now would only pay the spread.`
  );
}

/**
 * "Start anytime" safety for Live money.
 *
 * Every live tick replays the whole day, so pressing Start at 14:50 can hand
 * the broker layer a leg the strategy opened at 10:30. Entering that now is
 * chasing: the edge is hours old and the option is priced at a level the
 * strategy never signalled. Take only signals born at or after Start; keep
 * managing anything already sitting at the broker.
 */

/** A bar that closed just before Start still counts as live (one 5m bar). */
export const START_SIGNAL_GRACE_MINUTES = 5;

/**
 * Parse desk/Kite timestamps to epoch ms.
 * Naive stamps ("YYYY-MM-DD HH:mm:ss") are IST — parsing them as UTC is the
 * bug that once made Trap think every bar was past its entry window.
 */
export function parseIstTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const raw = value.trim().replace(' ', 'T');
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const ms = Date.parse(hasZone ? raw : `${raw}+05:30`);
  return Number.isFinite(ms) ? ms : 0;
}

export interface StartSignalCheck {
  /** Replay entry time of the currently open desk leg. */
  signalEntryTime?: string | null;
  /** When the user pressed Start (IST). Null = not a live-money run. */
  deskStartedAt?: string | null;
  /** True when Kite already holds this leg (entered or adopted). */
  hasBrokerPosition: boolean;
  graceMinutes?: number;
}

/**
 * True when this open leg predates Start and is not already at the broker,
 * so it must not be sent as a fresh entry.
 */
export function isStaleStartSignal(params: StartSignalCheck): boolean {
  if (params.hasBrokerPosition) {
    return false;
  }
  const startedMs = parseIstTimestamp(params.deskStartedAt);
  const signalMs = parseIstTimestamp(params.signalEntryTime);
  if (startedMs <= 0 || signalMs <= 0) {
    return false;
  }
  const grace = (params.graceMinutes ?? START_SIGNAL_GRACE_MINUTES) * 60_000;
  return signalMs < startedMs - grace;
}

/** Clock label (IST HH:mm) for event log and UI. */
export function istClock(value: string | null | undefined): string {
  const ms = parseIstTimestamp(value);
  if (!ms) {
    return '—';
  }
  return new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function staleStartReason(
  signalEntryTime: string | null | undefined,
  deskStartedAt: string | null | undefined,
): string {
  return (
    `Signal opened ${istClock(signalEntryTime)} — before Start ${istClock(deskStartedAt)}. ` +
    `Not chased at market. Desk will take the next fresh signal.`
  );
}

/** Naive IST stamp ("YYYY-MM-DD HH:mm:ss") for "now". */
export function nowIstStamp(now: Date = new Date()): string {
  return now
    .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
    .replace('T', ' ')
    .slice(0, 19);
}

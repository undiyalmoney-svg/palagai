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

/**
 * How far price may drift from the signal before the edge is gone, as a
 * fraction of the trade's own stop distance. A Crude trade risking 50 points
 * can absorb ~16 points of drift; a Nifty trade risking 12 cannot absorb 16.
 */
export const MAX_ENTRY_DRIFT_FRACTION = 0.33;

export interface StartSignalCheck {
  /** Replay entry time of the currently open desk leg. */
  signalEntryTime?: string | null;
  /** When the user pressed Start (IST). Null = not a live-money run. */
  deskStartedAt?: string | null;
  /** True when Kite already holds this leg (entered or adopted). */
  hasBrokerPosition: boolean;
  graceMinutes?: number;
  /** Index/futures level the strategy entered at. */
  signalEntryPrice?: number | null;
  /** Index/futures stop for that leg — gives the risk the trade can absorb. */
  signalStopPrice?: number | null;
  /** Latest index/futures price. */
  currentPrice?: number | null;
  /** Long CE reads as BUY, long PE as SELL. */
  direction?: 'BUY' | 'SELL' | null;
  maxDriftFraction?: number;
}

/**
 * Points of the move that already happened without us.
 *
 * Positive means price has travelled toward the target since the signal, so
 * entering now buys what is left. Negative means price came back toward the
 * stop, which is a *better* entry: same target, less risk.
 */
export function missedMovePts(params: {
  signalEntryPrice: number;
  currentPrice: number;
  direction: 'BUY' | 'SELL';
}): number {
  return params.direction === 'BUY'
    ? params.currentPrice - params.signalEntryPrice
    : params.signalEntryPrice - params.currentPrice;
}

/**
 * True when this open leg predates Start and must not be sent as a fresh entry.
 *
 * When the leg's own levels are known, judge it on **price** rather than the
 * clock: a trade is still worth taking while price sits near the signal, and is
 * not worth taking once it has run away, whether that took one minute or thirty.
 * This is what lets Crude — which risks 50 points and holds for hours — join a
 * leg opened before Start, while a one-bar index trade still gets refused.
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
  if (signalMs >= startedMs - grace) {
    return false;
  }

  const { signalEntryPrice, signalStopPrice, currentPrice, direction } = params;
  if (
    signalEntryPrice != null &&
    signalStopPrice != null &&
    currentPrice != null &&
    direction &&
    signalEntryPrice > 0 &&
    currentPrice > 0
  ) {
    const risk = Math.abs(signalEntryPrice - signalStopPrice);
    if (risk > 0) {
      const missed = missedMovePts({ signalEntryPrice, currentPrice, direction });
      const allowed = risk * (params.maxDriftFraction ?? MAX_ENTRY_DRIFT_FRACTION);
      return missed > allowed;
    }
  }

  // No levels to judge with — fall back to the clock.
  return true;
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

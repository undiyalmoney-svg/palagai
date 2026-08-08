/**
 * Live money: peak-trail "Profit drained" is a resting SL-M on Kite — same as
 * paper `isRestingExit`. Never MARKET-dump that exit **during the session**.
 *
 * After a HOLD, the next status sync often calls syncInstrument({ open: null })
 * **without** closeReason. Latch restores the drain reason so we keep waiting
 * for SL-M (classic tiny −₹ came from dropping that latch).
 *
 * Exception: at/after index session close (15:15) or explicit EOD reasons,
 * HOLD is cancelled → MARKET flatten (owner Stop after 15:15 must square off).
 */

/** Index desk session exit (IST HH:mm) — force-close + stop. */
export const INDEX_SESSION_EXIT_HHMM = '15:15';

/** Reuse last drain reason when status sync omits closeReason after a HOLD. */
export function effectiveCloseReason(params: {
  closeReason?: string | null;
  drainHoldLatched: boolean;
  /** When true, never restore drain latch — session must flatten. */
  sessionClosed?: boolean;
}): string | null {
  if (params.sessionClosed) {
    const reason = (params.closeReason ?? '').trim();
    if (reason && isSessionCloseReason(reason)) {
      return reason;
    }
    return 'EOD / session exit';
  }
  const reason = (params.closeReason ?? '').trim();
  if (reason) {
    return reason;
  }
  return params.drainHoldLatched ? 'Profit drained — cut & rehunt' : null;
}

/**
 * Peak-trail / cut & rehunt — must match paper executable-fill resting exits.
 * Live holds for SL-M; paper fills intrabar at the trail level.
 */
export function isProfitDrainedReason(closeReason: string | null | undefined): boolean {
  const r = (closeReason ?? '').toLowerCase();
  return (
    r.includes('profit drained') ||
    r.includes('cut & rehunt') ||
    r.includes('cut and rehunt')
  );
}

/** Paper/Live EOD flatten reasons — never HOLD for SL-M. */
export function isSessionCloseReason(closeReason: string | null | undefined): boolean {
  const r = (closeReason ?? '').toLowerCase();
  return (
    r.includes('end of range') ||
    r.includes('eod') ||
    r.includes('session exit') ||
    r.includes('market close') ||
    r.includes('session closed') ||
    r.includes('force close') ||
    r.includes('flatten')
  );
}

/**
 * True when Live must NOT MARKET exit — let the protective SL-M work.
 * False at session close (15:15+) even if the reason is still profit-drained.
 */
export function shouldHoldForRestingSlm(
  closeReason: string | null | undefined,
  opts?: { sessionClosed?: boolean; nowHhMm?: string },
): boolean {
  if (opts?.sessionClosed) {
    return false;
  }
  const now = opts?.nowHhMm;
  if (now != null && now >= INDEX_SESSION_EXIT_HHMM) {
    return false;
  }
  if (isSessionCloseReason(closeReason)) {
    return false;
  }
  return isProfitDrainedReason(closeReason);
}

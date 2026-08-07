/**
 * Live money: peak-trail "Profit drained" is a resting SL-M on Kite — same as
 * paper `isRestingExit`. Never MARKET-dump that exit.
 *
 * After a HOLD, the next status sync often calls syncInstrument({ open: null })
 * **without** closeReason. Latch restores the drain reason so we keep waiting
 * for SL-M (classic tiny −₹ came from dropping that latch).
 */

/** Reuse last drain reason when status sync omits closeReason after a HOLD. */
export function effectiveCloseReason(params: {
  closeReason?: string | null;
  drainHoldLatched: boolean;
}): string | null {
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

/**
 * True when Live must NOT MARKET exit — let the protective SL-M work.
 * (Target / hard stop are also resting on Kite; those fill via SL/TP orders.)
 */
export function shouldHoldForRestingSlm(closeReason: string | null | undefined): boolean {
  return isProfitDrainedReason(closeReason);
}

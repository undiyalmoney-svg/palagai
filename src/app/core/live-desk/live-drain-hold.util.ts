/**
 * Live money: after a "Profit drained" HOLD (option still red), the next status
 * sync often calls syncInstrument({ open: null }) **without** closeReason.
 * Without a latch that becomes a MARKET dump of a red option — classic tiny −₹.
 *
 * Paper books the drain exit from candles; Live only differs by Kite I/O, so we
 * must keep HOLD until SL-M or a fresh close reason that is not drain-hold.
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

export function isProfitDrainedReason(closeReason: string | null | undefined): boolean {
  return (closeReason ?? '').toLowerCase().includes('profit drained');
}

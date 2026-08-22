/**
 * Capital → lots preview. MUST mirror the server's authoritative ladder in
 * Palagai-Order-API `live/daily-desk-defaults.js` (bookLotsFromCapitalRs).
 *
 * The old preview used a different formula (<75k→1, else max(2, capital/1L)),
 * which disagreed with the server above ₹1L — e.g. at ₹4L the UI showed 4 lots
 * while the desk would actually size 10. Lots are normally sent explicitly from
 * the Lots inputs, so the ladder is only the fallback, but a preview that
 * understates real position size is exactly the drift class that put the wrong
 * DNA live once already. Keep these two in lockstep.
 */

/** Server: CAPITAL_RS_PER_LOT. */
export const DESK_LOTS_PER_LOT_RS = 40_000;
/** Server: MAX_DESK_LOTS. */
export const DESK_LOTS_CAP = 10;

/**
 * ₹40k → 1 · ₹80k → 2 · ₹1.2L → 3 · ₹2L → 5 · ₹4L+ → 10 (cap).
 * Below ₹40k still gets the 1-lot band.
 */
export function deskLotsForCapital(capitalRs: number): number {
  const c = Math.max(0, Math.floor(Number(capitalRs) || 0));
  if (!(c > 0)) {
    return 1;
  }
  return Math.min(DESK_LOTS_CAP, Math.max(1, Math.floor(c / DESK_LOTS_PER_LOT_RS)));
}

/** One Nifty/Bank lot per ₹40,000 of available funds. Paper and live share this. */
export const RS_PER_LOT = 40_000;
/**
 * Zerodha commodity calculator 2026-11-02: CRUDEOILM Nov NRML ₹31,051.
 * Kite already rejects 1-lot MIS at ₹14,000 free. Do not size FUT below this.
 */
export const CRUDE_FUT_NRML_RS = 31_000;
export const CRUDE_MIN_CAPITAL_RS = CRUDE_FUT_NRML_RS;
/** Crude Bot: 3 Mini lots per ₹40,000 band. Below ₹40k the desk is 1 lot, not 3. */
export const CRUDE_LOTS_PER_BAND = 3;
export const MAX_DESK_LOTS = 10;
export const MAX_CRUDE_LOTS = MAX_DESK_LOTS * CRUDE_LOTS_PER_BAND;

/**
 * Funds ladder used by Charts and the Crude Oil tab.
 *
 * Below ₹40k, index ATM lots are 0 — a ₹14k account cannot buy one Nifty/Bank
 * premium without washing the cash. Crude Mini futures need ~₹31k NRML;
 * ₹14k is rejected. Cheap CE/PE is the 14k book. FUT lots start at ₹31k and
 * never exceed what the cash can margin (one lot per ₹31k), nor 3× the ₹40k band.
 */
export function lotsFromAvailableFunds(capitalRs: number, book: 'index' | 'crude' = 'index'): number {
  const c = Math.max(0, Math.floor(Number(capitalRs) || 0));
  if (book === 'crude') {
    if (c < CRUDE_MIN_CAPITAL_RS) return 0;
    if (c < RS_PER_LOT) return 1;
    const bands = Math.floor(c / RS_PER_LOT);
    const byBand = Math.min(MAX_CRUDE_LOTS, Math.max(1, bands * CRUDE_LOTS_PER_BAND));
    return Math.min(byBand, Math.floor(c / CRUDE_FUT_NRML_RS));
  }
  if (c < RS_PER_LOT) return 0;
  return Math.min(MAX_DESK_LOTS, Math.floor(c / RS_PER_LOT));
}

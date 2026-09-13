/** One Nifty/Bank lot per ₹40,000 of available funds. Paper and live share this. */
export const RS_PER_LOT = 40_000;
/** Crude Bot: 3 Mini lots per same ₹40,000 band (below ₹40k → 3, ₹80k → 6). */
export const CRUDE_LOTS_PER_BAND = 3;
export const MAX_DESK_LOTS = 10;
export const MAX_CRUDE_LOTS = MAX_DESK_LOTS * CRUDE_LOTS_PER_BAND;

export function lotsFromAvailableFunds(capitalRs: number, book: 'index' | 'crude' = 'index'): number {
  const c = Math.max(0, Math.floor(Number(capitalRs) || 0));
  const nifty = !(c > 0) ? 1 : Math.min(MAX_DESK_LOTS, Math.max(1, Math.floor(c / RS_PER_LOT)));
  if (book !== 'crude') return nifty;
  return Math.min(MAX_CRUDE_LOTS, Math.max(CRUDE_LOTS_PER_BAND, nifty * CRUDE_LOTS_PER_BAND));
}

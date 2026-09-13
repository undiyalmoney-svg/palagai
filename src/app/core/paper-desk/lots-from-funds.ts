/** One Nifty/Bank lot per ₹40,000 of available funds. Paper and live share this. */
export const RS_PER_LOT = 40_000;
/** Crude Mini is ₹10/pt (Nifty ₹65). ~5 lots at ₹25k so Crude Bot is not stuck at 1. */
export const RS_PER_CRUDE_LOT = 5_000;
export const MAX_DESK_LOTS = 10;

export function lotsFromAvailableFunds(capitalRs: number, book: 'index' | 'crude' = 'index'): number {
  const c = Math.max(0, Math.floor(Number(capitalRs) || 0));
  const band = book === 'crude' ? RS_PER_CRUDE_LOT : RS_PER_LOT;
  if (!(c > 0)) return 1;
  return Math.min(MAX_DESK_LOTS, Math.max(1, Math.floor(c / band)));
}

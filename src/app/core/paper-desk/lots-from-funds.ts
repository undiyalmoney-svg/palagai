/** One Nifty/Bank lot per ₹40,000 of available funds. Paper and live share this. */
export const RS_PER_LOT = 40_000;
export const MAX_DESK_LOTS = 10;

export function lotsFromAvailableFunds(capitalRs: number): number {
  const c = Math.max(0, Math.floor(Number(capitalRs) || 0));
  if (!(c > 0)) return 1;
  return Math.min(MAX_DESK_LOTS, Math.max(1, Math.floor(c / RS_PER_LOT)));
}

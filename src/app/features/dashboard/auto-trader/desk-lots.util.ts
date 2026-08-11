/** Capital ladder thresholds (Order-API 1.3.122+ / 1.3.124 deskLots). */
export const DESK_LOTS_MIN_2X_RS = 75_000;
export const DESK_LOTS_PER_LAKH_RS = 100_000;
export const DESK_LOTS_CAP = 10;

/**
 * Order-API capital → deskLots ladder (one shared size for all books):
 * <75k → 1; else min(10, max(2, floor(capitalRs / 100000))).
 * ₹40k→1 · ₹4L→4 · ₹6L→6 · ₹10L→10.
 */
export function deskLotsForCapital(capitalRs: number): number {
  const c = Math.floor(Number(capitalRs) || 0);
  if (c < DESK_LOTS_MIN_2X_RS) {
    return 1;
  }
  return Math.min(DESK_LOTS_CAP, Math.max(2, Math.floor(c / DESK_LOTS_PER_LAKH_RS)));
}

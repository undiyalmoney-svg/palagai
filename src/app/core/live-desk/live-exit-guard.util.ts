/**
 * Live option exit sizing helpers.
 * Closing a long CE/PE requires SELL of the same contract — never more than broker long qty.
 */

/** How many units we may SELL to close. null = skip (already flat / would naked-short). */
export function resolveExitSellQty(
  brokerLongQty: number,
  plannedQty: number,
): number | null {
  const long = Math.max(0, Math.floor(brokerLongQty) || 0);
  const planned = Math.max(0, Math.floor(plannedQty) || 0);
  if (long <= 0 || planned <= 0) {
    return null;
  }
  return Math.min(long, planned);
}

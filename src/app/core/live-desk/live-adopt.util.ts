/**
 * Helpers for Live money restart adopt — recover entry ids and decide
 * whether an orphan leg still belongs to an open paper signal.
 */

export interface AdoptOrderRow {
  order_id?: string;
  status?: string;
  tradingsymbol?: string;
  transaction_type?: string;
  order_type?: string;
  tag?: string;
  quantity?: number;
  order_timestamp?: string;
  exchange_timestamp?: string;
  average_price?: number;
}

/** Latest COMPLETE PALAGAI BUY for this option — used as entryOrderId on adopt. */
export function findCompletedEntryOrderId(
  orders: readonly AdoptOrderRow[],
  tradingSymbol: string,
): string | null {
  const sym = tradingSymbol.toUpperCase();
  let best: AdoptOrderRow | null = null;
  let bestTs = -1;
  for (const o of orders) {
    if ((o.tradingsymbol ?? '').toUpperCase() !== sym) continue;
    if ((o.transaction_type ?? '').toUpperCase() !== 'BUY') continue;
    if ((o.status ?? '').toUpperCase() !== 'COMPLETE') continue;
    const tag = (o.tag ?? '').toUpperCase();
    if (!tag.startsWith('PALAGAI')) continue;
    if (!(Number(o.quantity ?? 0) > 0)) continue;
    const ts = Date.parse(o.order_timestamp || o.exchange_timestamp || '') || 0;
    if (ts >= bestTs) {
      bestTs = ts;
      best = o;
    }
  }
  return best?.order_id ?? null;
}

/** Placeholder entry id so UI treats adopted legs as on Kite when book has no BUY id. */
export function adoptedEntryOrderPlaceholder(slOrderId?: string | null): string {
  return slOrderId ? `adopted:${slOrderId}` : 'adopted';
}

export function isAdoptedEntryOrderId(orderId?: string | null): boolean {
  return !!orderId && (orderId === 'adopted' || orderId.startsWith('adopted:'));
}

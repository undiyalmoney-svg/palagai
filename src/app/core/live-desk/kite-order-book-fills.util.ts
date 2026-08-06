import { LiveOrderSummaryRow } from './live-order-executor.service';

/** Kite order-book row fields we need to rebuild today's fills. */
export interface KiteOrderBookRow {
  order_id?: string;
  status?: string;
  average_price?: number;
  tradingsymbol?: string;
  exchange?: string;
  transaction_type?: string;
  quantity?: number;
  filled_quantity?: number;
  tag?: string;
  order_timestamp?: string;
  exchange_timestamp?: string;
}

/** Desk book id for a Kite option symbol. BANKNIFTY must be tested before NIFTY. */
export function instrumentIdForTradingSymbol(tradingSymbol?: string | null): string | null {
  const s = (tradingSymbol ?? '').toUpperCase();
  if (!s) {
    return null;
  }
  if (s.startsWith('BANKNIFTY')) {
    return 'bank-nifty';
  }
  if (s.startsWith('NIFTY')) {
    return 'nifty-50';
  }
  if (s.startsWith('CRUDEOILM')) {
    return 'crude-oil-mini';
  }
  if (s.startsWith('NATGASMINI') || s.startsWith('NATURALGASM')) {
    return 'natgas-mini';
  }
  return null;
}

function isPalagaiTag(tag?: string): boolean {
  return (tag ?? '').toUpperCase().startsWith('PALAGAI');
}

function isComplete(status?: string): boolean {
  return (status ?? '').trim().toUpperCase() === 'COMPLETE';
}

/**
 * Rebuild today's Live money fills straight from the Kite order book.
 *
 * The in-memory summary only holds orders placed since the app started, so a
 * refresh/restart used to drop earlier fills and understate Profit ₹. Kite is
 * the record of truth — read it back instead of trusting session memory.
 *
 * BUY → ENTRY, SELL → EXIT. Only COMPLETE, PALAGAI-tagged, priced rows count.
 */
export function summaryRowsFromKiteOrderBook(
  orders: KiteOrderBookRow[],
  instrumentNames?: ReadonlyMap<string, string>,
): LiveOrderSummaryRow[] {
  const out: LiveOrderSummaryRow[] = [];
  for (const o of orders) {
    if (!isComplete(o.status) || !isPalagaiTag(o.tag)) {
      continue;
    }
    const avg = Number(o.average_price ?? 0);
    if (!(avg > 0)) {
      continue;
    }
    const symbol = (o.tradingsymbol ?? '').toUpperCase();
    const instrumentId = instrumentIdForTradingSymbol(symbol);
    if (!instrumentId) {
      continue;
    }
    const side = (o.transaction_type ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const at = o.exchange_timestamp || o.order_timestamp || '';
    const qty = Number(o.filled_quantity ?? o.quantity ?? 0) || 0;
    const orderId = o.order_id || `${symbol}-${side}-${at}`;
    out.push({
      id: orderId,
      at,
      instrumentId,
      instrumentName: instrumentNames?.get(instrumentId) ?? instrumentId,
      tradingSymbol: symbol,
      quantity: qty,
      leg: side === 'SELL' ? 'EXIT' : 'ENTRY',
      side,
      orderId,
      status: 'COMPLETE',
      triggerPrice: null,
      averagePrice: avg,
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Merge broker-derived rows into session rows, preferring whichever has a
 * fill price. Same order id never duplicates.
 */
export function mergeSummaryRows(
  sessionRows: LiveOrderSummaryRow[],
  brokerRows: LiveOrderSummaryRow[],
): LiveOrderSummaryRow[] {
  const byId = new Map<string, LiveOrderSummaryRow>();
  for (const row of sessionRows) {
    byId.set(row.orderId || row.id, row);
  }
  for (const row of brokerRows) {
    const key = row.orderId || row.id;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, row);
      continue;
    }
    byId.set(key, {
      ...prev,
      status: row.status || prev.status,
      averagePrice: prev.averagePrice ?? row.averagePrice,
      quantity: prev.quantity || row.quantity,
      tradingSymbol: prev.tradingSymbol || row.tradingSymbol,
      // Session leg wins: it knows SL-M vs strategy EXIT.
      leg: prev.leg,
    });
  }
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
}

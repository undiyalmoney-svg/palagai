import { describe, expect, it } from 'vitest';
import {
  instrumentIdForTradingSymbol,
  mergeSummaryRows,
  summaryRowsFromKiteOrderBook,
  type KiteOrderBookRow,
} from './kite-order-book-fills.util';
import { syncTradesToKiteFills } from '../paper-desk/apply-kite-fill-pnl';

/**
 * Real PALAGAI order book from Kite, 2026-08-06 (account NXU349).
 * Kite Positions day P&L that session: Nifty +39, Bank +82.50, Crude +628.50 = +750.
 */
const ORDERS_2026_08_06: KiteOrderBookRow[] = [
  ['10:17:17', 'BUY', 'NIFTY2681124600CE', 65, 171.8],
  ['10:17:26', 'SELL', 'NIFTY2681124600CE', 65, 170.55],
  ['11:08:40', 'BUY', 'NIFTY2681124650CE', 65, 147.7],
  ['11:08:42', 'BUY', 'BANKNIFTY26AUG57900CE', 30, 763.6],
  ['11:08:52', 'SELL', 'NIFTY2681124650CE', 65, 147.65],
  ['11:09:01', 'SELL', 'BANKNIFTY26AUG57900CE', 30, 763.65],
  ['11:38:55', 'BUY', 'NIFTY2681124650CE', 65, 159.2],
  ['11:39:03', 'SELL', 'NIFTY2681124650CE', 65, 160],
  ['11:39:05', 'BUY', 'BANKNIFTY26AUG57900CE', 30, 757],
  ['11:39:14', 'SELL', 'BANKNIFTY26AUG57900CE', 30, 757.4],
  ['12:35:22', 'BUY', 'CRUDEOILM26AUG7200CE', 1, 284.65],
  ['12:35:34', 'SELL', 'CRUDEOILM26AUG7200CE', 1, 285.5],
  ['14:10:52', 'BUY', 'NIFTY2681124650CE', 65, 150.15],
  ['14:11:02', 'SELL', 'NIFTY2681124650CE', 65, 149.55],
  ['14:11:04', 'BUY', 'NIFTY2681124650CE', 65, 148.95],
  ['14:11:13', 'SELL', 'NIFTY2681124650CE', 65, 150.65],
  ['14:11:17', 'BUY', 'BANKNIFTY26AUG58000CE', 30, 749.75],
  ['14:14:15', 'SELL', 'BANKNIFTY26AUG58000CE', 30, 752.05],
  ['17:46:32', 'BUY', 'CRUDEOILM26AUG7250CE', 1, 292.65],
  ['18:45:21', 'SELL', 'CRUDEOILM26AUG7250CE', 1, 330.9],
  ['19:57:04', 'BUY', 'CRUDEOILM26AUG7250CE', 1, 318.9],
  ['21:12:20', 'SELL', 'CRUDEOILM26AUG7250CE', 1, 342.65],
].map(([time, side, symbol, qty, avg], i) => ({
  order_id: `o${i}`,
  status: 'COMPLETE',
  average_price: avg as number,
  tradingsymbol: symbol as string,
  transaction_type: side as string,
  quantity: qty as number,
  filled_quantity: qty as number,
  tag: 'PALAGAI',
  order_timestamp: `2026-08-06 ${time}`,
}));

function moneyByBook(orders: KiteOrderBookRow[]): Map<string, number> {
  const trades = syncTradesToKiteFills([], summaryRowsFromKiteOrderBook(orders));
  const out = new Map<string, number>();
  for (const t of trades) {
    out.set(t.instrumentId, (out.get(t.instrumentId) ?? 0) + (t.optionPnlRs ?? 0));
  }
  return out;
}

describe('instrumentIdForTradingSymbol', () => {
  it('maps BANKNIFTY before NIFTY (prefix trap)', () => {
    expect(instrumentIdForTradingSymbol('BANKNIFTY26AUG58000CE')).toBe('bank-nifty');
    expect(instrumentIdForTradingSymbol('NIFTY2681124650CE')).toBe('nifty-50');
    expect(instrumentIdForTradingSymbol('CRUDEOILM26AUG7250CE')).toBe('crude-oil-mini');
    expect(instrumentIdForTradingSymbol('RELIANCE')).toBeNull();
  });
});

describe('summaryRowsFromKiteOrderBook', () => {
  it('keeps only COMPLETE, PALAGAI-tagged, priced rows', () => {
    const rows = summaryRowsFromKiteOrderBook([
      ...ORDERS_2026_08_06,
      { ...ORDERS_2026_08_06[0]!, order_id: 'rejected', status: 'REJECTED' },
      { ...ORDERS_2026_08_06[0]!, order_id: 'manual', tag: 'MANUAL' },
      { ...ORDERS_2026_08_06[0]!, order_id: 'unpriced', average_price: 0 },
    ]);
    expect(rows).toHaveLength(ORDERS_2026_08_06.length);
    expect(rows.every((r) => r.status === 'COMPLETE')).toBe(true);
  });

  it('BUY becomes ENTRY and SELL becomes EXIT', () => {
    const rows = summaryRowsFromKiteOrderBook(ORDERS_2026_08_06);
    expect(rows.filter((r) => r.leg === 'ENTRY')).toHaveLength(11);
    expect(rows.filter((r) => r.leg === 'EXIT')).toHaveLength(11);
  });
});

describe('REGRESSION 2026-08-06: desk Profit ₹ equals Kite Positions ₹', () => {
  it('matches per book and in total (Nifty +39 · Bank +82.5 · Crude +628.5)', () => {
    const byBook = moneyByBook(ORDERS_2026_08_06);
    expect(byBook.get('nifty-50')).toBeCloseTo(39, 2);
    expect(byBook.get('bank-nifty')).toBeCloseTo(82.5, 2);
    // Crude orders are qty=1 but Positions multiplies by lot 10.
    expect(byBook.get('crude-oil-mini')).toBeCloseTo(628.5, 2);
    const total = [...byBook.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(750, 2);
  });

  it('never reports Crude as a loss when Kite CE fills were green', () => {
    const byBook = moneyByBook(ORDERS_2026_08_06);
    expect(byBook.get('crude-oil-mini')!).toBeGreaterThan(0);
  });

  it('rebuilding from the order book survives a restart with no session rows', () => {
    // Session memory empty (app restarted mid-day) — money must still be complete.
    const rows = mergeSummaryRows([], summaryRowsFromKiteOrderBook(ORDERS_2026_08_06));
    const trades = syncTradesToKiteFills([], rows);
    const total = trades.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
    expect(total).toBeCloseTo(750, 2);
  });

  it('merge does not double count rows already known to the session', () => {
    const broker = summaryRowsFromKiteOrderBook(ORDERS_2026_08_06);
    const merged = mergeSummaryRows(broker, broker);
    expect(merged).toHaveLength(broker.length);
    const total = syncTradesToKiteFills([], merged).reduce(
      (a, t) => a + (t.optionPnlRs ?? 0),
      0,
    );
    expect(total).toBeCloseTo(750, 2);
  });
});

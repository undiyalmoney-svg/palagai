/**
 * Exact Zerodha charges for ONE long-option round trip (buy, then sell), by venue.
 * Port of Palagai-Order-API/market-recorder/research/costs.py (schedule checked 2026-11-02).
 * Slippage and spread are NOT in here; the execution model prices those separately.
 */
export type ChargeVenue = 'NSE' | 'BSE' | 'MCX';

export interface OptionChargeBreakdown {
  brokerage: number;
  sttCtt: number;
  exchangeTxn: number;
  sebi: number;
  stamp: number;
  ipft: number;
  gst: number;
  total: number;
}

const SCHEDULE: Record<ChargeVenue, { tax: number; txn: number; stamp: number }> = {
  NSE: { tax: 0.0015, txn: 0.0003553, stamp: 0.00003 },
  BSE: { tax: 0.0015, txn: 0.000325, stamp: 0.00003 },
  MCX: { tax: 0.0005, txn: 0.000418, stamp: 0.00003 },
};

const BROKERAGE_ROUND_TRIP_RS = 40;

export function optionChargeBreakdown(
  buyPremium: number,
  sellPremium: number,
  qty: number,
  venue: ChargeVenue,
): OptionChargeBreakdown {
  const zero: OptionChargeBreakdown = {
    brokerage: 0,
    sttCtt: 0,
    exchangeTxn: 0,
    sebi: 0,
    stamp: 0,
    ipft: 0,
    gst: 0,
    total: 0,
  };
  if (!(qty > 0) || !(buyPremium > 0) || !(sellPremium >= 0)) return zero;
  const p = SCHEDULE[venue];
  const buyVal = buyPremium * qty;
  const sellVal = sellPremium * qty;
  const turnover = buyVal + sellVal;
  const brokerage = BROKERAGE_ROUND_TRIP_RS;
  const sttCtt = p.tax * sellVal;
  const exchangeTxn = p.txn * turnover;
  const sebi = (10 * turnover) / 1e7;
  const stamp = p.stamp * buyVal;
  const ipft = (0.01 * turnover) / 1e7;
  const gst = 0.18 * (brokerage + exchangeTxn + sebi);
  const total = brokerage + sttCtt + exchangeTxn + sebi + stamp + ipft + gst;
  return { brokerage, sttCtt, exchangeTxn, sebi, stamp, ipft, gst, total };
}

export function optionRoundTripCharges(
  buyPremium: number,
  sellPremium: number,
  qty: number,
  venue: ChargeVenue,
): number {
  return optionChargeBreakdown(buyPremium, sellPremium, qty, venue).total;
}

export function venueForBook(bookId: string): ChargeVenue {
  if (bookId.includes('sensex')) return 'BSE';
  if (bookId.includes('crude')) return 'MCX';
  return 'NSE';
}

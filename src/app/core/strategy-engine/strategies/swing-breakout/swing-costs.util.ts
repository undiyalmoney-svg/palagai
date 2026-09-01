/**
 * Round-trip cost model for NSE equity DELIVERY (CNC) trades — the settlement type a
 * multi-day swing hold actually uses.
 *
 * A backtest that ignores costs overstates results, and it does so worst exactly where
 * this strategy lives: many small trades. At a ~₹10,000 position the flat DP charge alone
 * is ~0.16% of the position, and it is levied per sell regardless of profit.
 *
 * Rates below are Zerodha delivery as of 2026 and are deliberately kept explicit rather
 * than rolled into one number, so they can be checked against a real contract note.
 * They are close-enough estimates, NOT a substitute for your broker's actual charges.
 */

/** Securities Transaction Tax — charged on BOTH buy and sell for delivery. */
const STT_PCT_PER_SIDE = 0.001;
/** Stamp duty — buy side only. */
const STAMP_DUTY_PCT_BUY = 0.00015;
/** NSE exchange transaction charge, each side. */
const EXCHANGE_TXN_PCT_PER_SIDE = 0.0000297;
/** SEBI turnover fee, each side (₹10 per crore). */
const SEBI_PCT_PER_SIDE = 0.000001;
/** GST on (exchange txn + SEBI). Brokerage is ₹0 for delivery, so it contributes nothing. */
const GST_RATE = 0.18;
/** Depository (DP) charge — flat, per scrip, levied once on the sell. */
const DP_CHARGE_RS_PER_SELL = 15.93;

export interface TradeCostBreakdown {
  sttRs: number;
  stampDutyRs: number;
  exchangeTxnRs: number;
  sebiRs: number;
  gstRs: number;
  dpChargeRs: number;
  totalRs: number;
}

/**
 * Total round-trip cost in rupees for buying `qty` at `entryPrice` and selling at `exitPrice`.
 * Brokerage is ₹0 (delivery), so it is omitted rather than modelled as a fee.
 */
export function roundTripCostRs(
  entryPrice: number,
  exitPrice: number,
  qty: number,
): TradeCostBreakdown {
  if (!(qty > 0) || !(entryPrice > 0) || !(exitPrice > 0)) {
    return { sttRs: 0, stampDutyRs: 0, exchangeTxnRs: 0, sebiRs: 0, gstRs: 0, dpChargeRs: 0, totalRs: 0 };
  }
  const buyValue = entryPrice * qty;
  const sellValue = exitPrice * qty;
  const turnover = buyValue + sellValue;

  const sttRs = turnover * STT_PCT_PER_SIDE;
  const stampDutyRs = buyValue * STAMP_DUTY_PCT_BUY;
  const exchangeTxnRs = turnover * EXCHANGE_TXN_PCT_PER_SIDE;
  const sebiRs = turnover * SEBI_PCT_PER_SIDE;
  const gstRs = (exchangeTxnRs + sebiRs) * GST_RATE;
  const dpChargeRs = DP_CHARGE_RS_PER_SELL;

  return {
    sttRs,
    stampDutyRs,
    exchangeTxnRs,
    sebiRs,
    gstRs,
    dpChargeRs,
    totalRs: sttRs + stampDutyRs + exchangeTxnRs + sebiRs + gstRs + dpChargeRs,
  };
}

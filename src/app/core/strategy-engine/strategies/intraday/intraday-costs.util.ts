/**
 * Round-trip cost model for NSE equity INTRADAY (MIS) trades.
 *
 * Deliberately separate from the delivery model in swing-costs.util.ts — intraday is
 * materially cheaper and the difference decides whether a small-edge strategy survives:
 *  - No DP charge (nothing enters the demat account)
 *  - STT is charged on the SELL side only, at a lower rate
 *  - Brokerage is real here (delivery is free), capped at ₹20 per executed order
 *
 * Rates are Zerodha intraday as of 2026. Estimates, not a substitute for a contract note.
 */

/** ₹20 or 0.03% of turnover per executed order, whichever is lower. */
const BROKERAGE_PCT = 0.0003;
const BROKERAGE_CAP_RS = 20;
/** STT on the sell leg only for intraday. */
const STT_PCT_SELL = 0.00025;
/** Stamp duty, buy side only. */
const STAMP_DUTY_PCT_BUY = 0.00003;
const EXCHANGE_TXN_PCT_PER_SIDE = 0.0000297;
const SEBI_PCT_PER_SIDE = 0.000001;
const GST_RATE = 0.18;

export interface IntradayCostBreakdown {
  brokerageRs: number;
  sttRs: number;
  stampDutyRs: number;
  exchangeTxnRs: number;
  sebiRs: number;
  gstRs: number;
  totalRs: number;
}

/**
 * Round-trip cost for an intraday position of `qty` opened at `entryPrice` and closed at
 * `exitPrice`. Direction-aware: STT falls on whichever leg is the sell, so a short pays it
 * on the entry and a long on the exit.
 */
export function intradayRoundTripCostRs(
  entryPrice: number,
  exitPrice: number,
  qty: number,
  direction: 'LONG' | 'SHORT',
): IntradayCostBreakdown {
  const empty = {
    brokerageRs: 0,
    sttRs: 0,
    stampDutyRs: 0,
    exchangeTxnRs: 0,
    sebiRs: 0,
    gstRs: 0,
    totalRs: 0,
  };
  if (!(qty > 0) || !(entryPrice > 0) || !(exitPrice > 0)) {
    return empty;
  }

  const entryValue = entryPrice * qty;
  const exitValue = exitPrice * qty;
  const turnover = entryValue + exitValue;

  const brokerageRs =
    Math.min(entryValue * BROKERAGE_PCT, BROKERAGE_CAP_RS) +
    Math.min(exitValue * BROKERAGE_PCT, BROKERAGE_CAP_RS);

  // The sell leg is the exit for a long, the entry for a short.
  const sellValue = direction === 'LONG' ? exitValue : entryValue;
  const buyValue = direction === 'LONG' ? entryValue : exitValue;

  const sttRs = sellValue * STT_PCT_SELL;
  const stampDutyRs = buyValue * STAMP_DUTY_PCT_BUY;
  const exchangeTxnRs = turnover * EXCHANGE_TXN_PCT_PER_SIDE;
  const sebiRs = turnover * SEBI_PCT_PER_SIDE;
  const gstRs = (brokerageRs + exchangeTxnRs + sebiRs) * GST_RATE;

  return {
    brokerageRs,
    sttRs,
    stampDutyRs,
    exchangeTxnRs,
    sebiRs,
    gstRs,
    totalRs: brokerageRs + sttRs + stampDutyRs + exchangeTxnRs + sebiRs + gstRs,
  };
}

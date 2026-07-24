/**
 * Approximate Zerodha retail F&O / equity MIS charges (gross → net).
 * Estimates only — not a tax invoice. Tuned for desk transparency, not exact brokerage.
 */
export interface ChargeEstimateInput {
  /** BUY or SELL of the traded instrument (options are always long CE/PE here). */
  segment: 'nfo_option' | 'mcx_option' | 'nse_equity';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
}

export interface ChargeEstimate {
  brokerageRs: number;
  exchangeRs: number;
  gstRs: number;
  sebiRs: number;
  stampRs: number;
  sttRs: number;
  totalRs: number;
}

/** Round to paise. */
export function roundPaise(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Round-trip charge estimate for one closed leg.
 * Zerodha FO: ₹20/order cap-style brokerage; options STT on sell premium; GST 18% on (brokerage+exchange+sebi).
 */
export function estimateRoundTripCharges(input: ChargeEstimateInput): ChargeEstimate {
  const qty = Math.max(0, Math.floor(input.quantity) || 0);
  const entry = Math.max(0, input.entryPrice);
  const exit = Math.max(0, input.exitPrice);
  if (qty < 1 || (entry <= 0 && exit <= 0)) {
    return zeroCharges();
  }

  const buyTurnover = entry * qty;
  const sellTurnover = exit * qty;

  // Zerodha: lower of 0.03% or ₹20 per executed order (equity & F&O).
  const brokerageBuy = Math.min(20, buyTurnover * 0.0003);
  const brokerageSell = Math.min(20, sellTurnover * 0.0003);
  const brokerageRs = roundPaise(brokerageBuy + brokerageSell);

  let exchangeRs = 0;
  let sttRs = 0;
  let stampRs = 0;

  if (input.segment === 'nse_equity') {
    exchangeRs = roundPaise((buyTurnover + sellTurnover) * 0.0000297);
    sttRs = roundPaise(sellTurnover * 0.00025); // delivery-ish; MIS often 0.025% sell — use sell side
    stampRs = roundPaise(buyTurnover * 0.00015);
  } else {
    // Options: exchange txn charges on premium turnover (approx NSE)
    exchangeRs = roundPaise((buyTurnover + sellTurnover) * 0.00035);
    // STT on options sell (premium) ~0.1% (approx schedule used in research books)
    sttRs = roundPaise(sellTurnover * 0.001);
    stampRs = roundPaise(buyTurnover * 0.00003);
  }

  const sebiRs = roundPaise((buyTurnover + sellTurnover) * 0.000001);
  const gstBase = brokerageRs + exchangeRs + sebiRs;
  const gstRs = roundPaise(gstBase * 0.18);
  const totalRs = roundPaise(brokerageRs + exchangeRs + gstRs + sebiRs + stampRs + sttRs);

  return { brokerageRs, exchangeRs, gstRs, sebiRs, stampRs, sttRs, totalRs };
}

export function applyChargesToOptionTrade(params: {
  entryPremium: number;
  exitPremium: number;
  quantity: number;
  segment?: 'nfo_option' | 'mcx_option';
  grossPnlRs: number;
}): { chargesRs: number; netPnlRs: number; breakdown: ChargeEstimate } {
  const breakdown = estimateRoundTripCharges({
    segment: params.segment ?? 'nfo_option',
    entryPrice: params.entryPremium,
    exitPrice: params.exitPremium,
    quantity: params.quantity,
  });
  return {
    chargesRs: breakdown.totalRs,
    netPnlRs: roundPaise(params.grossPnlRs - breakdown.totalRs),
    breakdown,
  };
}

/** Overlay estimated charges onto trades that already have gross optionPnlRs (additive). */
export function enrichTradesWithCharges<
  T extends {
    option?: { lotSize?: number; exchange?: string } | null;
    optionEntryPremium?: number | null;
    optionExitPremium?: number | null;
    optionPnlRs?: number | null;
    chargesRs?: number | null;
    netOptionPnlRs?: number | null;
    moneyOutcome?: 'WIN' | 'LOSS' | 'FLAT';
  },
>(trades: T[], lots = 1): T[] {
  const lotMult = Math.max(1, Math.floor(lots) || 1);
  return trades.map((t) => {
    if (
      t.optionPnlRs == null ||
      t.optionEntryPremium == null ||
      t.optionExitPremium == null ||
      t.optionEntryPremium <= 0 ||
      t.optionExitPremium <= 0
    ) {
      return t;
    }
    const lotSize = Math.max(1, t.option?.lotSize || 1);
    const qty = lotSize * lotMult;
    const charged = applyChargesToOptionTrade({
      entryPremium: t.optionEntryPremium,
      exitPremium: t.optionExitPremium,
      quantity: qty,
      segment: t.option?.exchange === 'MCX' ? 'mcx_option' : 'nfo_option',
      grossPnlRs: t.optionPnlRs,
    });
    return {
      ...t,
      chargesRs: charged.chargesRs,
      netOptionPnlRs: charged.netPnlRs,
      moneyOutcome:
        t.optionPnlRs > 0 ? 'WIN' : t.optionPnlRs < 0 ? 'LOSS' : 'FLAT',
    };
  });
}

function zeroCharges(): ChargeEstimate {
  return {
    brokerageRs: 0,
    exchangeRs: 0,
    gstRs: 0,
    sebiRs: 0,
    stampRs: 0,
    sttRs: 0,
    totalRs: 0,
  };
}

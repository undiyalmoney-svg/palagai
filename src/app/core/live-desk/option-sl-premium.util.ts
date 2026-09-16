/**
 * Map index/futures stop distance → option premium SL trigger.
 * NFO weeklies ≈ 0.5 delta; MCX crude options ≈ 1.0 + wide min cushion
 * (premiums swing hard — a 7–8pt SL was firing within seconds).
 */

export function isMcxOptionContext(
  exchange?: string | null,
  tradingSymbol?: string | null,
): boolean {
  if ((exchange ?? '').toUpperCase() === 'MCX') {
    return true;
  }
  const sym = (tradingSymbol ?? '').toUpperCase();
  return (
    sym.startsWith('CRUDEOIL') ||
    sym.startsWith('NATURALGAS') ||
    sym.startsWith('NATGAS')
  );
}

export function optionPremiumDelta(
  exchange?: string | null,
  tradingSymbol?: string | null,
): number {
  return isMcxOptionContext(exchange, tradingSymbol) ? 1 : 0.5;
}

export function roundOptionPremiumTick(price: number): number {
  return Math.max(0.05, Math.round(price / 0.05) * 0.05);
}

/** Minimum premium pts below fill for MCX protective SL. */
export function mcxMinSlGapPts(fillPremium: number): number {
  // At least 25 pts or 5% of premium — crude options often move 10–20/min.
  return Math.max(25, fillPremium * 0.05);
}

/**
 * Protective SELL trigger for a long CE/PE.
 * Uses exchange-aware delta; enforces MCX minimum gap from fill;
 * if LTP is already near/through the raw trigger, pushes further below LTP.
 */
export function computeProtectiveSlTrigger(params: {
  fillPremium: number;
  indexRiskPts: number;
  /**
   * Override NFO 0.5Δ. S/R stopPts is already ₹cap / lotUnits, so Live
   * execution SL must use 1 or the Kite trigger is a Live-only haircut.
   */
  premiumDelta?: number | null;
  exchange?: string | null;
  tradingSymbol?: string | null;
  /** Current option LTP when placing (optional; do not pass fill as fake LTP). */
  ltp?: number | null;
  /**
   * Hard ₹ loss ceiling for this position (already scaled by lots — e.g.
   * dnaCapsForStrategy's maxOptionLossRs × lots), or 0/undefined for no cap.
   * Applied AFTER every other adjustment so a wide structural stop (or an
   * LTP cushion) can never push the allowed loss past this ceiling.
   */
  maxLossRs?: number | null;
  /** Total option units in the position (lotSize × lots). Required with maxLossRs. */
  lotUnits?: number | null;
}): number {
  const fill = Math.max(0, params.fillPremium);
  const risk = Math.max(0, params.indexRiskPts);
  const mcx = isMcxOptionContext(params.exchange, params.tradingSymbol);
  const delta = params.premiumDelta != null && Number(params.premiumDelta) > 0
    ? Number(params.premiumDelta)
    : (mcx ? 1 : 0.5);
  const fromRisk = fill - risk * delta;
  // NFO: never park SL within ~3% / ₹3 of fill — stops tuck-tuck ₹8–10 after peak trail.
  const nfoMinGap = Math.max(3, fill * 0.03);
  const fromMinGap = mcx ? fill - mcxMinSlGapPts(fill) : fill - nfoMinGap;
  let trigger = roundOptionPremiumTick(Math.max(0.05, Math.min(fromRisk, fromMinGap)));

  const ltp = params.ltp;
  if (ltp != null && ltp > 0 && trigger >= ltp - 0.049) {
    const cushion = Math.max(
      risk * delta,
      mcx ? mcxMinSlGapPts(ltp) : Math.max(nfoMinGap, ltp * 0.03),
      mcx ? 25 : 3,
    );
    trigger = roundOptionPremiumTick(Math.max(0.05, ltp - cushion));
  }

  const maxLossRs = Math.max(0, Number(params.maxLossRs) || 0);
  const lotUnits = Math.max(0, Number(params.lotUnits) || 0);
  if (maxLossRs > 0 && lotUnits > 0) {
    // Higher trigger = smaller loss (SELL stop on a long option). Clamping
    // UP to the cap-derived trigger means the position can never lose more
    // than maxLossRs, regardless of how wide the structural/LTP-cushion
    // stop above computed out to.
    const fromCap = fill - maxLossRs / lotUnits;
    trigger = roundOptionPremiumTick(Math.max(trigger, fromCap));
  }

  return trigger;
}

export function computeOptionTargetPremium(params: {
  fillPremium: number;
  indexRewardPts: number;
  exchange?: string | null;
  tradingSymbol?: string | null;
}): number {
  const delta = optionPremiumDelta(params.exchange, params.tradingSymbol);
  return roundOptionPremiumTick(
    Math.max(0.05, params.fillPremium + Math.max(0, params.indexRewardPts) * delta),
  );
}

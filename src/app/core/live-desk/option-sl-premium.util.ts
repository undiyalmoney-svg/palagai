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
  exchange?: string | null;
  tradingSymbol?: string | null;
  /** Current option LTP when placing (optional; do not pass fill as fake LTP). */
  ltp?: number | null;
}): number {
  const fill = Math.max(0, params.fillPremium);
  const risk = Math.max(0, params.indexRiskPts);
  const mcx = isMcxOptionContext(params.exchange, params.tradingSymbol);
  const delta = mcx ? 1 : 0.5;
  const fromRisk = fill - risk * delta;
  const fromMinGap = mcx ? fill - mcxMinSlGapPts(fill) : fromRisk;
  let trigger = roundOptionPremiumTick(Math.max(0.05, Math.min(fromRisk, fromMinGap)));

  const ltp = params.ltp;
  if (ltp != null && ltp > 0 && trigger >= ltp - 0.049) {
    const cushion = Math.max(
      risk * delta,
      mcx ? mcxMinSlGapPts(ltp) : ltp * 0.02,
      mcx ? 25 : 2,
    );
    trigger = roundOptionPremiumTick(Math.max(0.05, ltp - cushion));
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

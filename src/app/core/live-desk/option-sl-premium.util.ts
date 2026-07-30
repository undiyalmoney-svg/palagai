/**
 * Map index/futures stop distance → option premium SL trigger.
 * NFO weeklies ≈ 0.5 delta; MCX crude options (often deep ITM) ≈ 1.0.
 */

export function optionPremiumDelta(exchange?: string | null): number {
  return (exchange ?? 'NFO').toUpperCase() === 'MCX' ? 1 : 0.5;
}

export function roundOptionPremiumTick(price: number): number {
  return Math.max(0.05, Math.round(price / 0.05) * 0.05);
}

/**
 * Protective SELL trigger for a long CE/PE.
 * Uses exchange-aware delta; if LTP is already at/below the raw trigger,
 * pushes further below LTP so we don't fire the SL on the next tick.
 */
export function computeProtectiveSlTrigger(params: {
  fillPremium: number;
  indexRiskPts: number;
  exchange?: string | null;
  /** Current option LTP when placing (optional). */
  ltp?: number | null;
}): number {
  const fill = Math.max(0, params.fillPremium);
  const risk = Math.max(0, params.indexRiskPts);
  const delta = optionPremiumDelta(params.exchange);
  let trigger = roundOptionPremiumTick(Math.max(0.05, fill - risk * delta));
  const ltp = params.ltp;
  if (ltp != null && ltp > 0 && trigger >= ltp - 0.049) {
    const cushion = Math.max(risk * delta, ltp * 0.02, exchangeMinCushion(params.exchange));
    trigger = roundOptionPremiumTick(Math.max(0.05, ltp - cushion));
  }
  return trigger;
}

function exchangeMinCushion(exchange?: string | null): number {
  return (exchange ?? 'NFO').toUpperCase() === 'MCX' ? 10 : 2;
}

export function computeOptionTargetPremium(params: {
  fillPremium: number;
  indexRewardPts: number;
  exchange?: string | null;
}): number {
  const delta = optionPremiumDelta(params.exchange);
  return roundOptionPremiumTick(
    Math.max(0.05, params.fillPremium + Math.max(0, params.indexRewardPts) * delta),
  );
}

/**
 * ATM option delta used ONLY when real option OHLC is unavailable.
 *
 * Measured from Kite 5m bars on 2026-08-06 (median of |fut move| ≥ 3 pts):
 *   NIFTY  24650CE  0.41
 *   BANK   58000CE  0.30
 *   CRUDEOILM 7250CE 0.55
 *
 * The desk previously assumed delta 1.0 (option ₹ == index ₹ proxy), which
 * inflated every estimated leg ~2.5× — a 50-pt Crude SL showed as −₹500 when a
 * real ATM CE would have moved about −₹275.
 */
export const ATM_OPTION_DELTA = {
  nifty: 0.41,
  bank: 0.3,
  crude: 0.55,
  natgas: 0.55,
} as const;

/** Contract size (units per lot) per book — Kite Positions multiplier. */
export const BOOK_LOT_SIZE = {
  nifty: 65,
  bank: 30,
  crude: 10,
  natgas: 250,
} as const;

export type OptionDeltaBook = keyof typeof ATM_OPTION_DELTA;

export function bookForInstrumentId(instrumentId?: string | null): OptionDeltaBook {
  const id = (instrumentId ?? '').toLowerCase();
  if (id.includes('bank')) {
    return 'bank';
  }
  if (id.includes('natgas') || id.includes('naturalgas')) {
    return 'natgas';
  }
  if (id.includes('crude')) {
    return 'crude';
  }
  return 'nifty';
}

export function atmDeltaForInstrumentId(instrumentId?: string | null): number {
  return ATM_OPTION_DELTA[bookForInstrumentId(instrumentId)];
}

/**
 * Estimated premium move for an index/futures move, in premium points.
 * Long CE on fut BUY and long PE on fut SELL both gain when the trade is right,
 * so callers pass signed *trade* points (positive = trade went our way).
 */
export function estimatedPremiumMove(
  tradePoints: number,
  instrumentId?: string | null,
): number {
  return tradePoints * atmDeltaForInstrumentId(instrumentId);
}

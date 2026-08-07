/**
 * Trade Desk default book — ₹40k capital plan (doc 49).
 * Target ~₹2k/day · Trap live-safe DNA · auto lots 1/1/1 · profit lock on.
 * Applied on desk load — no Apply button.
 */
export const DAILY_3K_DESK_PRESET = {
  id: 'daily-3k',
  label: 'All-day green · ₹40k',
  niftyLots: 1,
  bankLots: 1,
  crudeLots: 1,
  natGasLots: 1,
  enableNifty: true,
  enableBank: true,
  /** Crude OFF — all-green hunt: Crude added red days. */
  enableCrude: false,
  enableNatGas: false,
  enableKutty: false,
  kuttyAlone: false,
  /** Cap new entries after ~+₹3k combined (above the ₹2k daily target). */
  dayProfitLock: true,
  /** On for hands-off agent — capital must not drain. */
  strictDayStop: true,
  /** Trading capital the auto-lot planner assumes. */
  capitalRs: 40_000,
  researchNote:
    '₹40k · Trap all-green peak₹100 · N+B only · max 3/day · lock ₹3k · confirm ON',
} as const;

export type Daily3kDeskPreset = typeof DAILY_3K_DESK_PRESET;

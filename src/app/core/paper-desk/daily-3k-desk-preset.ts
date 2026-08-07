/**
 * Trade Desk default book — ₹40k capital plan (doc 49).
 * Target ~₹2k/day · Trap live-safe DNA · auto lots 1/1/1 · profit lock on.
 * Applied on desk load — no Apply button.
 */
export const DAILY_3K_DESK_PRESET = {
  id: 'daily-3k',
  label: '₹40k → ₹2k/day',
  niftyLots: 1,
  bankLots: 1,
  crudeLots: 1,
  natGasLots: 1,
  enableNifty: true,
  enableBank: true,
  enableCrude: true,
  enableNatGas: false,
  enableKutty: false,
  kuttyAlone: false,
  /** Cap new entries after ~+₹3k combined (above the ₹2k daily target). */
  dayProfitLock: true,
  /** Off by default — user opts in for harder capital protection. */
  strictDayStop: false,
  /** Trading capital the auto-lot planner assumes. */
  capitalRs: 40_000,
  researchNote:
    '₹40k · Trap live-safe + Crude Selective · lots auto 1/1/1 · lock ₹3k · confirm ON',
} as const;

export type Daily3kDeskPreset = typeof DAILY_3K_DESK_PRESET;

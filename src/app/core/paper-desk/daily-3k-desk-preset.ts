/**
 * Trade Desk default book — Daily ₹1k–₹3k (1-lot hunt, doc 43).
 * Applied on desk load — no Apply button.
 */
export const DAILY_3K_DESK_PRESET = {
  id: 'daily-3k',
  label: 'Daily ₹1k–₹3k',
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
  /** Cap new entries after ~+₹3k combined. */
  dayProfitLock: true,
  /** Off by default — user opts in. */
  strictDayStop: false,
  researchNote:
    '1-lot · Trap + Crude Selective · profit lock ₹3k · Trap needs confirm',
} as const;

export type Daily3kDeskPreset = typeof DAILY_3K_DESK_PRESET;

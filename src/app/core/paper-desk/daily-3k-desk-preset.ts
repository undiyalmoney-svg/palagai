/**
 * Trade Desk default book — ₹40k capital plan (doc 49 / 50).
 * Nifty + Bank only · Trap all-green DNA · Crude not on this desk.
 */
export const DAILY_3K_DESK_PRESET = {
  id: 'daily-3k',
  label: 'Option ₹ · ₹40k',
  niftyLots: 1,
  bankLots: 1,
  enableNifty: true,
  enableBank: true,
  enableKutty: false,
  kuttyAlone: false,
  /** Cap new entries after ~+₹3k combined (above the ₹2k daily target). */
  dayProfitLock: true,
  /** On for hands-off agent — capital must not drain. */
  strictDayStop: true,
  /** Trading capital the auto-lot planner assumes. */
  capitalRs: 40_000,
  researchNote:
    '₹40k · Trap pierce20/B40 · peak₹100 · max3 · 3.5R · lock ₹3k · option −₹350 stand-down',
} as const;

export type Daily3kDeskPreset = typeof DAILY_3K_DESK_PRESET;

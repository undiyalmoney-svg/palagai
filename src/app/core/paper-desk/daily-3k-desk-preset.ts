/**
 * Daily ₹1k–₹3k Trade Desk preset — 1-lot hunt answer (doc 43).
 *
 * DNA: Trap pierce10 · peak arm₹150 · soft OFF · 2R
 *      Crude Selective SL30/TP60 · 10:00–22:00 · max 2/day
 * Lots: N×1 / B×1 / C×1
 *
 * Research (index OOS 2025+, 1 lot N+B):
 *   ~89% days ≥ ₹1k · p10 ~₹823 · avg ~₹4.3k · worst ~−₹77
 * With Crude + day lock ₹3k (overlap): ~87–89% days in ₹1k–₹3k band.
 *
 * Not a hard floor — ~5–6% zero-fill days remain.
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
  /** Cap new entries after ~+₹3k combined (1-lot band). */
  dayProfitLock: true,
  /** Soft loss brake (~−₹2,950). */
  strictDayStop: true,
  researchNote:
    '1-lot hunt · ~89% days ≥₹1k · lock ₹3k · NOT every-day floor · Trap needs confirm',
} as const;

export type Daily3kDeskPreset = typeof DAILY_3K_DESK_PRESET;

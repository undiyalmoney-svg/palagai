/**
 * Daily ₹3k Trade Desk preset — Nifty Trap ×2 · Bank Trap ×2 · Crude Selective ×1.
 *
 * Research (cash-day overlap proxy, after fill costs):
 * - lots 2/2/1 → ~71% days ≥ ₹3k · avg ~₹6.5k · worst ~−₹870
 * - lots 1/1/1 → avg ~₹3k but only ~42% days ≥ ₹3k
 *
 * Not a guaranteed floor. Trap still needs arm + next-bar confirm.
 * See docs/owner-private/43-DAILY-3K-DESK-PRESET.md
 */
export const DAILY_3K_DESK_PRESET = {
  id: 'daily-3k',
  label: 'Daily ₹3k',
  niftyLots: 2,
  bankLots: 2,
  crudeLots: 1,
  natGasLots: 1,
  enableNifty: true,
  enableBank: true,
  enableCrude: true,
  enableNatGas: false,
  /** Background Kutty off — keep the ₹3k hunt on Trap + Crude only. */
  enableKutty: false,
  kuttyAlone: false,
  /** Cap new entries after ~+₹5k combined so winners are banked. */
  dayProfitLock: true,
  /** Soft loss brake (~−₹2,950). */
  strictDayStop: true,
  researchNote:
    'Proxy ~71% days ≥₹3k · avg ~₹6.5k · not a guaranteed floor · Trap needs confirm',
} as const;

export type Daily3kDeskPreset = typeof DAILY_3K_DESK_PRESET;

/**
 * Daily ₹3k Trade Desk preset — hunt answer (doc 43).
 *
 * Hard ₹3000 every calendar day is impossible (zero-fill + red traded days).
 * Best bounded answer on cash-day overlap proxy (worst ≥ −₹1,500):
 *   Trap pierce5 · N×5 / B×3 · Crude Selective session 10–22 ×1
 *   → ~79% days ≥ ₹3k · avg ~₹11.4k · worst ~−₹1,115
 *
 * Safer alt: 4/2/1 → ~76% ≥₹3k · worst ~−₹510
 */
export const DAILY_3K_DESK_PRESET = {
  id: 'daily-3k',
  label: 'Daily ₹3k',
  niftyLots: 5,
  bankLots: 3,
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
    'Hunt answer · ~79% days ≥₹3k · worst ~−₹1.1k · NOT a guaranteed floor · Trap needs confirm',
} as const;

export type Daily3kDeskPreset = typeof DAILY_3K_DESK_PRESET;

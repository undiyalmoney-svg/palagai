/**
 * Snapshot of scripts/crude-guaranteed-day-hunt.py
 * (MCX CRUDEOILM 5m 2026-05-21 → 2026-10-30, 4,321 books).
 *
 * The guaranteed-profit TEST is this object: a book only passes if every
 * full-session day is green after ₹50/RT. Count is 0. Not a live lock.
 */
export const CRUDE_GUARANTEED_HUNT = {
  sample: 'MCX CRUDEOILM 5m 2026-05-21 → 2026-10-30',
  needRs: 150,
  configs: 4321,
  gateEveryTradableDayGreen: 0,
  gateEveryTradableDay150: 0,
  wired: {
    profileId: 'daily-min-sc10',
    greenDays: 58,
    redDays: 9,
    flatDays: 7,
    hit150: 43,
    tradable: 74,
    greenPct: 78.4,
    hit150Pct: 58.1,
    worstDay: -300,
    avgDay: 93.8,
    everyDayGreen: false,
    everyDay150: false,
  },
  honest:
    'The guaranteed-profit test found zero books. A past sample cannot lock tomorrow. Not a guaranteed profit.',
} as const;

/**
 * Reverse-engineering of failed dummy tickets.
 * Same entry, opposite direction. Learned before 2026-09-01, scored after.
 * No flip group held out of sample. Not a live arm. Not a guaranteed profit.
 */
export const PAPER_REVERSE_FAIL = {
  sample: 'MCX Crude + Yahoo Nifty/Bank/Sensex 5m',
  isUntil: '2026-09-01',
  tickets: 167,
  autopsy: {
    origGreen: 85,
    wrongDirection: 34,
    chopBothLose: 43,
    noFlipFill: 5,
  },
  flipGroups: [] as const,
  liveFlipOos: {
    rule: 'late_extended',
    origNetRs: 15813.2,
    flipNetRs: 4339.9,
    origWinPct: 53.3,
    flipWinPct: 40.0,
    kept: false,
  },
  liveOrders: false,
  guaranteed: false,
  honest:
    '34 losers were the wrong direction — the flip would have banked after charges. 43 were chop: both sides lose. Blind flip and a late-extended flip both paid less after 2026-09-01, so the desk does not take the opposite side live. Loss tickets stay refused. Not a guaranteed profit.',
} as const;

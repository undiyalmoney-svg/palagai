/**
 * Pre-trade pattern on the 34 wrong-direction losers.
 * Kept only if flipping those tickets beats the original after 2026-09-01,
 * after ₹50 charges. n=8 is small. Not a live Crude Best arm. Not guaranteed.
 */
export const PAPER_FAIL_PATTERN = {
  sample: 'Same 167 first-fills as the reverse autopsy',
  isUntil: '2026-09-01',
  wrongDirection: 34,
  chopBothLose: 43,
  origGreen: 85,
  rulesTried: 24,
  kept: ['trend PDHL + against VWAP', 'trend + against VWAP + early'] as const,
  champion: {
    name: 'trend PDHL + against VWAP',
    means:
      'Morning is trend. The book is a PDH/PDL break. The fill is already on the other side of VWAP. That is a failed break — take the other side.',
    n: 8,
    wrong: 4,
    chop: 2,
    alreadyGreen: 2,
    wrongPct: 50,
    isOrigNetRs: 5956.4,
    isRuleNetRs: 6756.4,
    oosOrigNetRs: 15813.2,
    oosRuleNetRs: 16973.2,
    oosLiftRs: 1160,
    keep: true,
  },
  slices: {
    wrongBook: { crude: 11, nifty: 11, bank: 6, sensex: 6 },
    wrongStructure: { trend: 20, quiet: 7, range: 7 },
    wrongMode: { pdhl: 20, vwap_fade: 7, fade: 4, orb_fade: 3 },
  },
  liveOrders: false,
  guaranteed: false,
  armedOnCrudeBest: false,
  honest:
    'Pattern: trend PDH/PDL fill that is already against VWAP. 8 tickets. Flipping those beat the original by ₹1,160 after 1 Sep 2026, after charges. Sample is small. Not armed on Crude Best. Not a guaranteed profit.',
} as const;

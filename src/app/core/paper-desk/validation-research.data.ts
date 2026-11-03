/**
 * Static summary of the offline options-buying study (Palagai-Order-API,
 * market-recorder/research/OPTIONS-BUYING-RESEARCH.md, 2026-11-02). Figures are copied from that document.
 * They use MODELLED premiums (Black-Scholes on India VIX) with scenario spreads, not recorded option quotes,
 * so they are unverified and are NOT results of the Paper 14k rules.
 */
export interface ResearchBucket {
  bucket: string;
  pickedConfig: string;
  trades: string;
  netPerTradeRs: string;
  testCi95: string;
  testWinPct: string;
  testProfitFactor: string;
  testRsPerDay: number;
  pValue: number;
}

export const RESEARCH_SPLIT = {
  train: '405 days · 2023-11-02 to 2025-06-25',
  validation: '147 days · 2025-06-27 to 2026-01-30',
  test: '184 days · 2026-02-02 to 2026-10-30',
  embargo: '1 trading day between splits',
} as const;

export const RESEARCH_BUCKETS: ResearchBucket[] = [
  {
    bucket: 'NIFTY CE',
    pickedConfig: 'SRBRK, DTE1, +1 strike, 25%/100%, 45 bars',
    trades: '624 / 228 / 265',
    netPerTradeRs: '157 / 114 / -85',
    testCi95: '[-517, 397]',
    testWinPct: '31%',
    testProfitFactor: '0.92',
    testRsPerDay: -122,
    pValue: 0.51,
  },
  {
    bucket: 'NIFTY PE',
    pickedConfig: 'SRBRK, DTE1, +3 strike, 40%/60%, 45 bars',
    trades: '557 / 206 / 280',
    netPerTradeRs: '262 / 554 / 765',
    testCi95: '[134, 1,428]',
    testWinPct: '54%',
    testProfitFactor: '1.60',
    testRsPerDay: 1164,
    pValue: 0.07,
  },
  {
    bucket: 'BANKNIFTY CE',
    pickedConfig: 'PDHL, DTE3, ATM, 25%/60%, 12 bars',
    trades: '178 / 60 / 69',
    netPerTradeRs: '58 / 260 / -491',
    testCi95: '[-983, 8]',
    testWinPct: '39%',
    testProfitFactor: '0.57',
    testRsPerDay: -184,
    pValue: 0.98,
  },
  {
    bucket: 'BANKNIFTY PE',
    pickedConfig: 'EMASTACK, DTE3, +1 strike, 25%/60%, 24 bars',
    trades: '273 / 99 / 130',
    netPerTradeRs: '16 / 249 / 374',
    testCi95: '[-67, 826]',
    testWinPct: '55%',
    testProfitFactor: '1.43',
    testRsPerDay: 264,
    pValue: 0.29,
  },
  {
    bucket: 'SENSEX CE',
    pickedConfig: 'SRBRK, DTE0, +3 strike, 40%/100%, 24 bars',
    trades: '620 / 226 / 256',
    netPerTradeRs: '84 / 148 / -167',
    testCi95: '[-614, 307]',
    testWinPct: '36%',
    testProfitFactor: '0.88',
    testRsPerDay: -232,
    pValue: 0.61,
  },
  {
    bucket: 'SENSEX PE',
    pickedConfig: 'EMASTACK, DTE0, +3 strike, 40%/60%, 45 bars',
    trades: '253 / 97 / 114',
    netPerTradeRs: '56 / 491 / 386',
    testCi95: '[-124, 905]',
    testWinPct: '49%',
    testProfitFactor: '1.34',
    testRsPerDay: 239,
    pValue: 0.27,
  },
];

export const RESEARCH_FINDINGS: string[] = [
  'Of 30,492 modelled configurations, 70-76% lose money on the training years; the median loses ₹34-158 per trade after charges and spread.',
  '3 of 6 CE/PE buckets are positive on the unseen test window. Re-running the whole search on direction-randomised signals gives a positive median "winner" in 7 of 9 sets, so that is no better than chance.',
  'Smallest selection-adjusted p-values are 0.05 (Nifty, both directions) and 0.07 (Nifty PE) out of 9 comparisons; none survives a multiple-comparison correction.',
  'Only candidate worth forward testing: the 6-bar range-thrust momentum entry (not the Paper 14k rules). Even then expected ₹170-280 a day with a daily standard deviation of ₹2,000-2,900.',
  'Expected-profit confirmation at 80% power needs roughly 775-2,300 trading days of data, far beyond what a few weeks of forward paper can show.',
];

export const RESEARCH_SOURCE =
  'Palagai-Order-API · market-recorder/research/OPTIONS-BUYING-RESEARCH.md · branch cursor/market-recorder-9eb1';

export const LEAKAGE_CONTROLS: string[] = [
  'A signal uses a completed bar. The earliest fill is the open of the next bar; a unit test rewrites every later bar and asserts the signal is unchanged.',
  'Selection uses train then validation only. The test window is evaluated once per bucket.',
  'Implied volatility uses the previous day close only. Confidence intervals resample whole days.',
  'The Paper desk only reads bars that have fully closed, and every forward trade is stored once at the moment it closes. Trades are never edited or deleted.',
];

/** Default backtest and data-loading settings. */
export const BACKTEST_CONFIG = {
  defaultLookbackDays: 45,
  fetchDelayMs: 3000,
  defaultReplaySpeedMs: 0,
  maxRuleCombinations: 128,
} as const;

export type BacktestConfigConstants = typeof BACKTEST_CONFIG;

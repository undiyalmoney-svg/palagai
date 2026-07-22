/** Central strategy identifiers for Strategy Manager. */
export const MANAGED_STRATEGY_IDS = {
  CHAMPION_PDHL: 'pdhl-opening-range',
  VOL_EXPAND_DONCH15: 'vol-expand-donch15-ema50-eod',
  SWING5_PREV_DAY: 'swing5-prev-day-eod',
  DONCHIAN_20: 'donchian-20-eod',
  DONCHIAN_55_TURTLE: 'donchian-55-turtle',
  /** Daily-consistency search: max green-day share (not default — fat tails). */
  INSIDE_BREAK: 'inside-break-eod',
  /** S/R retest daily-₹500 winner: Donch-20 retest + OR-mid + 2R. */
  DONCH_RETEST_OR_MID_2R: 'donch-retest-or-mid-2r',
  /** S/R retest twin: Swing-5 retest + EMA50 + 2R. */
  SWING_RETEST_EMA50_2R: 'swing-retest-ema50-2r',
  /** Stocks Desk champion — gap-up fade ₹500 book. */
  GAP_FADE_500: 'gap-fade-500',
} as const;

export type ManagedStrategyId =
  (typeof MANAGED_STRATEGY_IDS)[keyof typeof MANAGED_STRATEGY_IDS];

/**
 * Research-backed defaults:
 * - Nifty/Bank: Donch Retest OR-mid 2R
 * - Stocks: GAP_FADE_500 (same DNA as Stocks Desk)
 */
export const DEFAULT_CHANNEL_ASSIGNMENTS = {
  nifty: {
    paper: MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R,
    live: MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R,
    shadow: null as string | null,
  },
  bank: {
    paper: MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R,
    live: MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R,
    shadow: null as string | null,
  },
  stocks: {
    paper: MANAGED_STRATEGY_IDS.GAP_FADE_500,
    live: MANAGED_STRATEGY_IDS.GAP_FADE_500,
    shadow: null as string | null,
  },
} as const;

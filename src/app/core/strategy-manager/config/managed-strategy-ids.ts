/** Central strategy identifiers for Strategy Manager. */
export const MANAGED_STRATEGY_IDS = {
  CHAMPION_PDHL: 'pdhl-opening-range',
  VOL_EXPAND_DONCH15: 'vol-expand-donch15-ema50-eod',
  SWING5_PREV_DAY: 'swing5-prev-day-eod',
  DONCHIAN_20: 'donchian-20-eod',
  DONCHIAN_55_TURTLE: 'donchian-55-turtle',
} as const;

export type ManagedStrategyId =
  (typeof MANAGED_STRATEGY_IDS)[keyof typeof MANAGED_STRATEGY_IDS];

/**
 * Research-backed defaults (VolExpand + morning regime filter for indices).
 * Stocks channel uses VolExpand in Strategy Manager; Stocks Desk UI defaults to GAP_FADE_500.
 */
export const DEFAULT_CHANNEL_ASSIGNMENTS = {
  nifty: {
    paper: MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15,
    live: MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15,
    shadow: null as string | null,
  },
  bank: {
    paper: MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15,
    live: MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15,
    shadow: null as string | null,
  },
  stocks: {
    paper: MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15,
    live: MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15,
    shadow: null as string | null,
  },
} as const;

/** Centralized strategy identifiers. */
export const STRATEGY_IDS = {
  PDHL_OPENING_RANGE: 'pdhl-opening-range',
  // Paused — removed from active registry
  FIRST_HOUR_BREAKOUT: 'first-hour-breakout',
  INTRADAY_REVERSAL: 'intraday-reversal',
  // Legacy / research (paused)
  TRENDLINE_BREAKOUT: 'pa-research-trendline-breakout',
  MTF_PULLBACK: 'pa-research-mtf-pullback',
  HOUR_BREAKOUT: 'pa-research-hour-breakout',
  LEGACY_TWO: 'strategy-two',
  LEGACY_THREE: 'strategy-three',
  LEGACY_FIVE: 'strategy-five',
  LEGACY_PRICE_ACTION: 'price-action-engine',
  LEGACY_SMART_SPAR: 'smart-price-action-reversal-v1',
} as const;

export type StrategyId = (typeof STRATEGY_IDS)[keyof typeof STRATEGY_IDS];

export const PAUSED_STRATEGY_IDS = new Set<string>([
  STRATEGY_IDS.FIRST_HOUR_BREAKOUT,
  STRATEGY_IDS.INTRADAY_REVERSAL,
  STRATEGY_IDS.TRENDLINE_BREAKOUT,
  STRATEGY_IDS.MTF_PULLBACK,
  STRATEGY_IDS.HOUR_BREAKOUT,
  STRATEGY_IDS.LEGACY_TWO,
  STRATEGY_IDS.LEGACY_THREE,
  STRATEGY_IDS.LEGACY_FIVE,
  STRATEGY_IDS.LEGACY_PRICE_ACTION,
  STRATEGY_IDS.LEGACY_SMART_SPAR,
]);

/** Only these strategies may run in backtests. */
export const ACTIVE_STRATEGY_IDS = new Set<string>([STRATEGY_IDS.PDHL_OPENING_RANGE]);

/** @deprecated Research platform removed — kept for type compatibility only. */
export const RESEARCH_STRATEGY_IDS = {
  TRENDLINE_BREAKOUT: STRATEGY_IDS.TRENDLINE_BREAKOUT,
  MTF_PULLBACK: STRATEGY_IDS.MTF_PULLBACK,
  HOUR_BREAKOUT: STRATEGY_IDS.HOUR_BREAKOUT,
} as const;

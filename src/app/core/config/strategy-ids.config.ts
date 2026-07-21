/** Centralized strategy identifiers. */
export const STRATEGY_IDS = {
  PDHL_OPENING_RANGE: 'pdhl-opening-range',
  VOL_EXPAND_DONCH15: 'vol-expand-donch15-ema50-eod',
  SWING5_PREV_DAY: 'swing5-prev-day-eod',
  DONCHIAN_20: 'donchian-20-eod',
  DONCHIAN_55_TURTLE: 'donchian-55-turtle',
  INSIDE_BREAK: 'inside-break-eod',
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

/**
 * Strategies allowed in the backtest runner.
 * Champion remains the only one enabled by default (see StrategyEngineService).
 */
export const ACTIVE_STRATEGY_IDS = new Set<string>([
  STRATEGY_IDS.PDHL_OPENING_RANGE,
  STRATEGY_IDS.VOL_EXPAND_DONCH15,
  STRATEGY_IDS.SWING5_PREV_DAY,
  STRATEGY_IDS.DONCHIAN_20,
  STRATEGY_IDS.DONCHIAN_55_TURTLE,
  STRATEGY_IDS.INSIDE_BREAK,
]);

/** @deprecated Research platform removed — kept for type compatibility only. */
export const RESEARCH_STRATEGY_IDS = {
  TRENDLINE_BREAKOUT: STRATEGY_IDS.TRENDLINE_BREAKOUT,
  MTF_PULLBACK: STRATEGY_IDS.MTF_PULLBACK,
  HOUR_BREAKOUT: STRATEGY_IDS.HOUR_BREAKOUT,
} as const;

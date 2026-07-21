/**
 * Per-strategy tunable settings.
 * Changing one strategy's settings never mutates another.
 */
export interface StrategySettings {
  /** Earliest entry HH:mm (IST). */
  entryTimeStart: string;
  /** Latest entry HH:mm (IST). */
  entryTimeEnd: string;
  /** Session / forced exit HH:mm (IST). */
  exitTime: string;
  /** Opening-range end (used by OR-aware strategies). */
  orEnd: string;
  /** Max stop distance in index/price points. */
  stopLossPts: number;
  /** Minimum stop distance. */
  minStopPts: number;
  /** EMA length for bias or exit. */
  emaLength: number;
  /** Donchian / channel lookback bars. */
  donchianLength: number;
  /** Swing lookback (bars each side) for swing strategies. */
  swingLookback: number;
  /** ATR multiple for vol-expand filter (bar range ≥ mult × ATR). */
  volExpandAtrMult: number;
  /** Max trades per day (null = unlimited within other rules). */
  maxTradesPerDay: number;
  /** Position size in lots (desk may still override via UI lots). */
  positionSizeLots: number;
  /** Risk % of capital (informational / future risk manager). */
  riskPercent: number;
  /** Preferred instrument vehicle — not hardcoded in engine. */
  instrumentType: 'index' | 'futures' | 'options' | 'equity';
  /** Day stop in points (0 = disabled). */
  dayStopPts: number;
  /** Target R-multiple (0 = no fixed target / EOD strategies). */
  targetRMultiple: number;
  /**
   * Morning regime filter (prior-day/OR features only — no look-ahead).
   * When enabled: require OR drive ≥ min and gap/ATR ≤ max.
   */
  regimeFilterEnabled: boolean;
  /** Min |OR close−OR open| / OR width (default 0.30). */
  regimeMinOrDriveFrac: number;
  /** Max overnight gap / ATR14 (default 6.0) — skips extreme gap chaos. */
  regimeMaxGapAtr: number;
  /** Extra strategy-specific knobs. */
  extras: Record<string, number | string | boolean>;
}

export function defaultStrategySettings(
  partial?: Partial<StrategySettings>,
): StrategySettings {
  const base: StrategySettings = {
    entryTimeStart: '10:15',
    entryTimeEnd: '15:10',
    exitTime: '15:15',
    orEnd: '10:15',
    stopLossPts: 30,
    minStopPts: 3,
    emaLength: 50,
    donchianLength: 20,
    swingLookback: 5,
    volExpandAtrMult: 1.2,
    maxTradesPerDay: 1,
    positionSizeLots: 1,
    riskPercent: 1,
    instrumentType: 'index',
    dayStopPts: 60,
    targetRMultiple: 0,
    regimeFilterEnabled: false,
    regimeMinOrDriveFrac: 0.3,
    regimeMaxGapAtr: 6,
    extras: {},
  };
  if (!partial) {
    return base;
  }
  const { extras: partialExtras, ...rest } = partial;
  return {
    ...base,
    ...rest,
    extras: { ...base.extras, ...(partialExtras ?? {}) },
  };
}

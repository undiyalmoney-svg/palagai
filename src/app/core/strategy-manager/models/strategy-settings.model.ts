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
  /** Max stop distance in index/price points (Nifty / default). */
  stopLossPts: number;
  /** Bank Nifty stop cap (research: 45). Used when instrument is Bank. */
  bankStopLossPts: number;
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
  /**
   * Hard day loss cap in ₹ per lot (0 = disabled).
   * Converted to points per instrument (Nifty ₹65/pt · Bank ₹30/pt) and used as a
   * running budget: each entry's risk is capped to what is left, so realised day
   * loss cannot exceed the cap. Scales with the desk Lots control.
   */
  dayLossCapRs: number;
  /** Target R-multiple (0 = no fixed target / EOD strategies). */
  targetRMultiple: number;
  /**
   * After favorable move reaches profitProtectArmR × risk, tighten stop
   * to entry + profitProtectLockR × risk (0 = break-even). Reduces giveback.
   */
  profitProtectEnabled: boolean;
  /** Arm protect after this R of favorable excursion (e.g. 1 = +1R). */
  profitProtectArmR: number;
  /** Locked stop offset in R once armed (0 = break-even). */
  profitProtectLockR: number;
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
  extras: Record<string, number | string | boolean | null>;
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
    bankStopLossPts: 45,
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
    dayLossCapRs: 0,
    targetRMultiple: 0,
    profitProtectEnabled: false,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
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

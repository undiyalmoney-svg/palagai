import { EntryCondition, StopKind, StrategyRecipe } from './strategy-recipe';

/**
 * Pure search-space definition and recipe generation — deliberately free of Angular so it
 * can be exercised by a standalone script without bootstrapping the framework.
 */

/** Ceiling on generated combinations. Past this the browser stalls and the multiple-testing problem worsens anyway. */
export const MAX_COMBINATIONS = 400;
/** A candidate needs at least this many trades before its statistics mean anything. */
export const MIN_TRADES_FOR_SIGNIFICANCE = 30;
/** Fraction of the window used for searching; the remainder is held back for validation. */
export const IN_SAMPLE_FRACTION = 0.6;

export type FinderUniverse = 'nifty50' | 'nifty500';

export interface SearchSpace {
  direction: 'LONG' | 'SHORT';
  useEmaTrend: boolean;
  emaFast: number[];
  emaSlow: number[];
  useBreakout: boolean;
  breakoutLookback: number[];
  useRsi: boolean;
  rsiPeriod: number[];
  rsiOp: 'lt' | 'gt';
  rsiValue: number[];
  useVolume: boolean;
  volumeMinRatio: number[];
  usePullback: boolean;
  pullbackEma: number[];
  pullbackMinPct: number[];
  // --- Smart Pullback PRO blocks ---
  usePriceVsEma: boolean;
  priceEmaPeriod: number[];
  useEngulf: boolean;
  engulfTolerancePct: number[];
  useStrongBody: boolean;
  strongBodyLookback: number[];
  strongBodyRatio: number[];
  useEmaTouch: boolean;
  emaTouchPeriod: number[];
  useNotSideways: boolean;
  notSidewaysRatio: number[];
  useNearPivot: boolean;
  nearPivotLookback: number[];
  nearPivotMaxDistPct: number[];
  cooldownBars: number;
  // --- exits ---
  stopKind: StopKind[];
  stopValue: number[];
  maxRiskPct: number[];
  rewardMultiple: number[];
  maxHoldBars: number[];
}

export function defaultSearchSpace(): SearchSpace {
  return {
    direction: 'LONG',
    useEmaTrend: true,
    emaFast: [20],
    emaSlow: [50],
    useBreakout: true,
    breakoutLookback: [10, 20],
    useRsi: false,
    rsiPeriod: [14],
    rsiOp: 'lt',
    rsiValue: [30, 40],
    useVolume: true,
    volumeMinRatio: [1.2],
    usePullback: false,
    pullbackEma: [20],
    pullbackMinPct: [0.03],
    usePriceVsEma: false,
    priceEmaPeriod: [50],
    useEngulf: false,
    engulfTolerancePct: [0.005],
    useStrongBody: false,
    strongBodyLookback: [10],
    strongBodyRatio: [0.6],
    useEmaTouch: false,
    emaTouchPeriod: [50],
    useNotSideways: false,
    notSidewaysRatio: [0.7],
    useNearPivot: false,
    nearPivotLookback: [5],
    nearPivotMaxDistPct: [0.01],
    cooldownBars: 0,
    stopKind: ['atr'],
    stopValue: [2],
    maxRiskPct: [0.05, 0.07],
    rewardMultiple: [1.5, 2, 3],
    maxHoldBars: [5, 10, 20],
  };
}

/**
 * The "Smart Pullback PRO" Pine indicator expressed as a search space.
 *
 * Its buy signal is `bullBreakout and bullRetest and strongBull`, i.e. a bar that closes
 * above yesterday's high while its low stays near yesterday's low (a wide engulfing bar),
 * sitting above the 50-EMA, with a body bigger than 0.6× its 10-bar average — plus the
 * 15-bar duplicate filter.
 *
 * Two deliberate changes from the original, both required to make it portable:
 *  - the `+10` retest tolerance and the `< 10` sideways threshold were absolute points,
 *    which mean wildly different things on a ₹100 stock versus a ₹3,000 one. Both are
 *    percentages here.
 *  - the indicator draws entries but defines no stop or target, so exits are swept rather
 *    than assumed.
 */
export function smartPullbackSpace(): SearchSpace {
  return {
    ...defaultSearchSpace(),
    direction: 'LONG',
    useEmaTrend: false,
    useBreakout: false,
    useRsi: false,
    useVolume: false,
    usePullback: false,
    usePriceVsEma: true,
    priceEmaPeriod: [50],
    useEngulf: true,
    engulfTolerancePct: [0.003, 0.005, 0.01],
    useStrongBody: true,
    strongBodyLookback: [10],
    strongBodyRatio: [0.6],
    useEmaTouch: false,
    useNotSideways: true,
    notSidewaysRatio: [0.7],
    useNearPivot: false,
    cooldownBars: 15,
    stopKind: ['atr'],
    stopValue: [2],
    maxRiskPct: [0.05, 0.07],
    rewardMultiple: [1.5, 2, 3],
    maxHoldBars: [5, 10, 20],
  };
}

/** The indicator's separate "PULLBACK BUY" label: a green bar tagging the 50-EMA from above. */
export function emaPullbackSpace(): SearchSpace {
  return {
    ...defaultSearchSpace(),
    direction: 'LONG',
    useEmaTrend: false,
    useBreakout: false,
    useVolume: false,
    usePullback: false,
    usePriceVsEma: false,
    useEngulf: false,
    useStrongBody: false,
    useEmaTouch: true,
    emaTouchPeriod: [20, 50],
    useNotSideways: true,
    notSidewaysRatio: [0.7],
    useNearPivot: false,
    cooldownBars: 5,
    stopKind: ['atr'],
    stopValue: [2],
    maxRiskPct: [0.05, 0.07],
    rewardMultiple: [1.5, 2, 3],
    maxHoldBars: [5, 10, 20],
  };
}

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((v) => [...prefix, v])), [[]]);
}

function describeRecipe(
  entry: EntryCondition[],
  stopKind: StopKind,
  stopValue: number,
  maxRiskPct: number,
  reward: number,
  hold: number,
  direction: string,
): string {
  const bits: string[] = [direction];
  for (const c of entry) {
    if (c.kind === 'emaTrend') bits.push(`EMA${c.fast}>${c.slow}`);
    if (c.kind === 'breakout') bits.push(`${c.lookback}d ${c.side}`);
    if (c.kind === 'rsi') bits.push(`RSI${c.period}${c.op === 'lt' ? '<' : '>'}${c.value}`);
    if (c.kind === 'volumeSurge') bits.push(`vol≥${c.minRatio}x`);
    if (c.kind === 'pullback') bits.push(`${Math.round(c.minPct * 100)}% ${c.side} EMA${c.ema}`);
    if (c.kind === 'priceVsEma') bits.push(`px ${c.side} EMA${c.period}`);
    if (c.kind === 'engulfPrevRange') bits.push(`engulf ${(c.tolerancePct * 100).toFixed(1)}%`);
    if (c.kind === 'strongBody') bits.push(`body>${Math.abs(c.minRatio)}x avg${c.lookback}`);
    if (c.kind === 'emaTouch') bits.push(`touch EMA${c.period}`);
    if (c.kind === 'notSideways') bits.push(`ATR≥${c.minAtrRatio}x`);
    if (c.kind === 'nearPivot') bits.push(`≤${(c.maxDistPct * 100).toFixed(1)}% from ${c.side}`);
  }
  const stopTxt =
    stopKind === 'atr' ? `${stopValue}xATR` : stopKind === 'pct' ? `${(stopValue * 100).toFixed(1)}%` : `swing${stopValue}`;
  bits.push(`stop ${stopTxt} cap${Math.round(maxRiskPct * 100)}%`, `${reward}R`, `${hold}bar`);
  return bits.join(' · ');
}

/** Expands a search space into concrete recipes, capped at MAX_COMBINATIONS. */
export function buildRecipes(space: SearchSpace): StrategyRecipe[] {
  const long = space.direction === 'LONG';

  const emaOpts: (EntryCondition | null)[] = space.useEmaTrend
    ? cartesian<number>([space.emaFast, space.emaSlow])
        .filter(([f, s]) => f! < s!)
        .map(([f, s]) => ({ kind: 'emaTrend', fast: f!, slow: s!, mode: long ? 'above' : 'below' }))
    : [null];

  const breakoutOpts: (EntryCondition | null)[] = space.useBreakout
    ? space.breakoutLookback.map((lb) => ({ kind: 'breakout', lookback: lb, side: long ? 'high' : 'low' }))
    : [null];

  const rsiOpts: (EntryCondition | null)[] = space.useRsi
    ? cartesian<number>([space.rsiPeriod, space.rsiValue]).map(([p, v]) => ({
        kind: 'rsi', period: p!, op: space.rsiOp, value: v!,
      }))
    : [null];

  const volOpts: (EntryCondition | null)[] = space.useVolume
    ? space.volumeMinRatio.map((r) => ({ kind: 'volumeSurge', lookback: 20, minRatio: r }))
    : [null];

  const pullbackOpts: (EntryCondition | null)[] = space.usePullback
    ? cartesian<number>([space.pullbackEma, space.pullbackMinPct]).map(([e, p]) => ({
        kind: 'pullback', ema: e!, minPct: p!, side: long ? 'below' : 'above',
      }))
    : [null];

  const priceEmaOpts: (EntryCondition | null)[] = space.usePriceVsEma
    ? space.priceEmaPeriod.map((p) => ({ kind: 'priceVsEma', period: p, side: long ? 'above' : 'below' }))
    : [null];

  const engulfOpts: (EntryCondition | null)[] = space.useEngulf
    ? space.engulfTolerancePct.map((t) => ({ kind: 'engulfPrevRange', tolerancePct: t, side: long ? 'up' : 'down' }))
    : [null];

  const bodyOpts: (EntryCondition | null)[] = space.useStrongBody
    ? cartesian<number>([space.strongBodyLookback, space.strongBodyRatio]).map(([l, r]) => ({
        kind: 'strongBody', lookback: l!, minRatio: long ? r! : -r!,
      }))
    : [null];

  const emaTouchOpts: (EntryCondition | null)[] = space.useEmaTouch
    ? space.emaTouchPeriod.map((p) => ({ kind: 'emaTouch', period: p, side: long ? 'above' : 'below' }))
    : [null];

  const sidewaysOpts: (EntryCondition | null)[] = space.useNotSideways
    ? space.notSidewaysRatio.map((r) => ({ kind: 'notSideways', period: 14, minAtrRatio: r }))
    : [null];

  const pivotOpts: (EntryCondition | null)[] = space.useNearPivot
    ? cartesian<number>([space.nearPivotLookback, space.nearPivotMaxDistPct]).map(([l, d]) => ({
        kind: 'nearPivot', lookback: l!, maxDistPct: d!, side: long ? 'support' : 'resistance',
      }))
    : [null];

  const entryCombos = cartesian<EntryCondition | null>([
    emaOpts, breakoutOpts, rsiOpts, volOpts, pullbackOpts,
    priceEmaOpts, engulfOpts, bodyOpts, emaTouchOpts, sidewaysOpts, pivotOpts,
  ]);
  const exitCombos = cartesian<number | StopKind>([
    space.stopKind,
    space.stopValue,
    space.maxRiskPct,
    space.rewardMultiple,
    space.maxHoldBars,
  ]);

  const recipes: StrategyRecipe[] = [];
  for (const entryCombo of entryCombos) {
    const entry = entryCombo.filter((c): c is EntryCondition => c !== null);
    if (!entry.length) continue;
    // Hygiene, not edge: keep penny stocks and illiquid names out of every recipe.
    entry.push({ kind: 'priceRange', minRs: 50, maxRs: 5000 });
    entry.push({ kind: 'minLiquidity', lookback: 20, minAvgVolume: 100_000 });

    for (const exitCombo of exitCombos) {
      const [stopKind, stopValue, maxRiskPct, rewardMultiple, maxHoldBars] = exitCombo as [
        StopKind, number, number, number, number,
      ];
      recipes.push({
        label: describeRecipe(entry, stopKind, stopValue, maxRiskPct, rewardMultiple, maxHoldBars, space.direction),
        direction: space.direction,
        entry,
        exit: { stopKind, stopValue, maxRiskPct, rewardMultiple, maxHoldBars },
        cooldownBars: space.cooldownBars || undefined,
      });
      if (recipes.length >= MAX_COMBINATIONS) return recipes;
    }
  }
  return recipes;
}

/**
 * The avgR a strategy must clear just to pay its own charges. A delivery round trip on a
 * position of `positionRs` is roughly ₹38 (STT both sides, stamp, GST, flat ₹16 DP charge);
 * 1R is `maxRiskPct` of the position, so the hurdle is cost ÷ risk.
 */
export function costHurdleInR(positionRs: number, maxRiskPct: number): number {
  const pctCost = positionRs * 2 * 0.001 + positionRs * 0.00015 + positionRs * 2 * 0.0000297;
  const flatCost = 15.93;
  const totalCost = pctCost * 1.18 + flatCost;
  const riskRs = positionRs * maxRiskPct;
  return riskRs > 0 ? totalCost / riskRs : Infinity;
}

export function dateAtFraction(from: string, to: string, fraction: number): string {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  const d = new Date(a + (b - a) * fraction);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Behavioural checks for the strategy finder.
 *
 * The two that matter most are the last pair: a series with a deliberately injected edge
 * must be detected, and a pure random walk must NOT produce a "promising" verdict. A finder
 * that cannot tell those apart is a curve-fitting machine, however good its report looks.
 *
 * Standalone (the app has no unit-test runner wired up). Run with:
 *   npx tsx src/app/core/strategy-engine/strategies/finder/__tests__/finder-logic.check.ts
 */
import {
  EntryCondition,
  StrategyRecipe,
  buildIndicators,
  collectIndicatorNeeds,
  emptyIndicatorRequest,
  runRecipeOnSymbol,
} from '../strategy-recipe';
import {
  buildRecipes,
  costHurdleInR,
  defaultSearchSpace,
  emaPullbackSpace,
  smartPullbackSpace,
} from '../strategy-search-space';

type C = { date: string; open: number; high: number; low: number; close: number; volume: number };

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

function iso(dayOffset: number): string {
  const d = new Date(2024, 0, 1);
  d.setDate(d.getDate() + dayOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00+0530`;
}

/** Deterministic pseudo-random so runs are reproducible. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function indicatorsFor(candles: C[], recipes: StrategyRecipe[]) {
  const req = emptyIndicatorRequest();
  for (const r of recipes) collectIndicatorNeeds(r, req);
  return buildIndicators(candles as any, req);
}

// ---------- 1. Recipe generation ----------
console.log('\n1. Recipe generation from a search space');
{
  const space = defaultSearchSpace();
  const recipes = buildRecipes(space);
  check('produces recipes', recipes.length > 0, String(recipes.length));
  const hasKind = (r: StrategyRecipe, kind: EntryCondition['kind']) =>
    r.entry.some((c: EntryCondition) => c.kind === kind);
  check('every recipe has a price-band guard', recipes.every((r) => hasKind(r, 'priceRange')));
  check('every recipe has a liquidity floor', recipes.every((r) => hasKind(r, 'minLiquidity')));
  check('labels are human readable', /EMA20>50/.test(recipes[0]!.label), recipes[0]!.label);
  // emaFast must be < emaSlow — an inverted pair is not a valid trend filter
  const bad = recipes.some((r) =>
    r.entry.some((c: EntryCondition) => c.kind === 'emaTrend' && c.fast >= c.slow),
  );
  check('no inverted EMA pairs', !bad);
}

// ---------- 2. Entry fills at NEXT bar's open, not the signal close ----------
console.log('\n2. Entry fills at the next open (no closing-price fantasy)');
{
  const recipe: StrategyRecipe = {
    label: 't', direction: 'LONG',
    entry: [{ kind: 'breakout', lookback: 5, side: 'high' }],
    exit: { stopKind: 'pct', stopValue: 0.05, maxRiskPct: 0.05, rewardMultiple: 2, maxHoldBars: 5 },
  };
  const cs: C[] = [];
  for (let i = 0; i < 10; i++) cs.push({ date: iso(i), open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  // bar 10 breaks out closing at 105; bar 11 opens at a gap of 108
  cs.push({ date: iso(10), open: 101, high: 105.5, low: 100, close: 105, volume: 5000 });
  cs.push({ date: iso(11), open: 108, high: 112, low: 107, close: 110, volume: 5000 });
  for (let i = 12; i < 20; i++) cs.push({ date: iso(i), open: 110, high: 130, low: 109, close: 128, volume: 1000 });

  const ind = indicatorsFor(cs, [recipe]);
  const trades = runRecipeOnSymbol(recipe, 'T', ind);
  check('a trade is taken', trades.length === 1, String(trades.length));
  check('entry is 108 (next open), not 105 (signal close)', trades[0]?.entryPrice === 108, String(trades[0]?.entryPrice));
}

// ---------- 3. Stop beats target on an ambiguous bar ----------
console.log('\n3. Ambiguous bar resolves to STOP (conservative)');
{
  const recipe: StrategyRecipe = {
    label: 't', direction: 'LONG',
    entry: [{ kind: 'breakout', lookback: 5, side: 'high' }],
    exit: { stopKind: 'pct', stopValue: 0.05, maxRiskPct: 0.05, rewardMultiple: 2, maxHoldBars: 5 },
  };
  const cs: C[] = [];
  for (let i = 0; i < 10; i++) cs.push({ date: iso(i), open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  cs.push({ date: iso(10), open: 101, high: 105.5, low: 100, close: 105, volume: 5000 });
  cs.push({ date: iso(11), open: 100, high: 100, low: 100, close: 100, volume: 1000 });
  // next bar spans both stop (95) and target (110)
  cs.push({ date: iso(12), open: 100, high: 115, low: 90, close: 100, volume: 1000 });
  for (let i = 13; i < 20; i++) cs.push({ date: iso(i), open: 100, high: 101, low: 99, close: 100, volume: 1000 });

  const ind = indicatorsFor(cs, [recipe]);
  const trades = runRecipeOnSymbol(recipe, 'T', ind);
  check('exit reason is STOP', trades[0]?.exitReason === 'STOP', String(trades[0]?.exitReason));
  check('R multiple is -1', Math.abs((trades[0]?.rMultiple ?? 0) + 1) < 1e-9, String(trades[0]?.rMultiple));
}

// ---------- 4. Cost hurdle ----------
console.log('\n4. Cost hurdle in R');
{
  const h = costHurdleInR(10000, 0.07);
  // ~₹38 cost on ₹700 of risk ≈ 0.054R
  check('₹10k @7% risk needs ~0.05R to break even', h > 0.045 && h < 0.065, h.toFixed(4));
  const tighter = costHurdleInR(10000, 0.02);
  check('tighter stop raises the hurdle', tighter > h, `${tighter.toFixed(3)} vs ${h.toFixed(3)}`);
  const bigger = costHurdleInR(50000, 0.07);
  check('larger position lowers the hurdle', bigger < h, `${bigger.toFixed(4)} vs ${h.toFixed(4)}`);
  console.log(`     ₹10k/7% = ${h.toFixed(3)}R, ₹50k/7% = ${bigger.toFixed(3)}R`);
}

// ---------- 5. Injected edge IS detected ----------
console.log('\n5. A real, injected edge is detected');
{
  const recipe: StrategyRecipe = {
    label: 't', direction: 'LONG',
    entry: [{ kind: 'breakout', lookback: 10, side: 'high' }],
    exit: { stopKind: 'pct', stopValue: 0.05, maxRiskPct: 0.05, rewardMultiple: 2, maxHoldBars: 10 },
  };
  // Construct a series where every breakout is followed by a sustained run up.
  const cs: C[] = [];
  let px = 100;
  let day = 0;
  for (let cycle = 0; cycle < 40; cycle++) {
    for (let i = 0; i < 12; i++) {
      cs.push({ date: iso(day++), open: px, high: px * 1.005, low: px * 0.995, close: px, volume: 1000 });
    }
    px *= 1.02;
    cs.push({ date: iso(day++), open: px, high: px * 1.01, low: px * 0.99, close: px * 1.005, volume: 4000 });
    for (let i = 0; i < 8; i++) {
      px *= 1.02;
      cs.push({ date: iso(day++), open: px, high: px * 1.02, low: px * 0.995, close: px, volume: 2000 });
    }
  }
  const ind = indicatorsFor(cs, [recipe]);
  const trades = runRecipeOnSymbol(recipe, 'T', ind);
  const avgR = trades.reduce((a, t) => a + t.rMultiple, 0) / Math.max(1, trades.length);
  check('trades were generated', trades.length > 20, String(trades.length));
  check('avgR is clearly positive on a rigged uptrend', avgR > 0.3, avgR.toFixed(3));
  console.log(`     ${trades.length} trades, avgR ${avgR.toFixed(3)}`);
}

// ---------- 6. Pure noise does NOT produce an edge ----------
console.log('\n6. A random walk produces no edge');
{
  const recipe: StrategyRecipe = {
    label: 't', direction: 'LONG',
    entry: [{ kind: 'breakout', lookback: 10, side: 'high' }],
    exit: { stopKind: 'pct', stopValue: 0.05, maxRiskPct: 0.05, rewardMultiple: 2, maxHoldBars: 10 },
  };
  const rng = makeRng(12345);
  const cs: C[] = [];
  let px = 500;
  for (let i = 0; i < 3000; i++) {
    const drift = (rng() - 0.5) * 0.03;
    const open = px;
    px = px * (1 + drift);
    const hi = Math.max(open, px) * (1 + rng() * 0.005);
    const lo = Math.min(open, px) * (1 - rng() * 0.005);
    cs.push({ date: iso(i), open, high: hi, low: lo, close: px, volume: 1000 + rng() * 1000 });
  }
  const ind = indicatorsFor(cs, [recipe]);
  const trades = runRecipeOnSymbol(recipe, 'T', ind);
  const avgR = trades.reduce((a, t) => a + t.rMultiple, 0) / Math.max(1, trades.length);
  const hurdle = costHurdleInR(10000, 0.05);
  check('enough trades to judge', trades.length > 30, String(trades.length));
  check('avgR on noise does not clear the cost hurdle', avgR < hurdle, `avgR ${avgR.toFixed(3)} vs hurdle ${hurdle.toFixed(3)}`);
  console.log(`     ${trades.length} trades, avgR ${avgR.toFixed(3)}, hurdle ${hurdle.toFixed(3)}`);
}

// ---------- 7. Smart Pullback PRO port ----------
console.log('\n7. Smart Pullback PRO — ported blocks match the Pine logic');
{
  // strongBody: close>open AND |close-open| > 0.6 x avg body of prior 10 bars
  const recipeBody: StrategyRecipe = {
    label: 't', direction: 'LONG',
    entry: [{ kind: 'strongBody', lookback: 10, minRatio: 0.6 }],
    exit: { stopKind: 'pct', stopValue: 0.05, maxRiskPct: 0.05, rewardMultiple: 2, maxHoldBars: 3 },
  };
  const cs: C[] = [];
  // 10 bars with body of exactly 1.0
  for (let i = 0; i < 10; i++) cs.push({ date: iso(i), open: 100, high: 102, low: 99, close: 101, volume: 1000 });
  // bar 10: red bar with a big body -> must NOT fire (direction wrong)
  cs.push({ date: iso(10), open: 105, high: 105, low: 100, close: 100, volume: 1000 });
  for (let i = 11; i < 16; i++) cs.push({ date: iso(i), open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  const indB = indicatorsFor(cs, [recipeBody]);
  const bodyAvgAt10 = indB.bodyAvg.get(10)?.[10];
  check('body average over prior 10 bars = 1.0', Math.abs((bodyAvgAt10 ?? 0) - 1) < 1e-9, String(bodyAvgAt10));
  const tradesB = runRecipeOnSymbol(recipeBody, 'T', indB);
  check('a big RED body does not trigger a LONG', tradesB.length === 0, String(tradesB.length));

  // engulfPrevRange: close > prevHigh AND low <= prevLow*(1+tol)
  const recipeEng: StrategyRecipe = {
    label: 't', direction: 'LONG',
    entry: [{ kind: 'engulfPrevRange', tolerancePct: 0.005, side: 'up' }],
    exit: { stopKind: 'pct', stopValue: 0.05, maxRiskPct: 0.05, rewardMultiple: 2, maxHoldBars: 3 },
  };
  // prev bar: high 110, low 100. engulfing bar closes 112, low 100.2 (within 0.5% of 100)
  const eng: C[] = [];
  for (let i = 0; i < 5; i++) eng.push({ date: iso(i), open: 105, high: 110, low: 100, close: 105, volume: 1000 });
  eng.push({ date: iso(5), open: 101, high: 113, low: 100.2, close: 112, volume: 1000 });
  for (let i = 6; i < 12; i++) eng.push({ date: iso(i), open: 112, high: 113, low: 111, close: 112, volume: 1000 });
  const indE = indicatorsFor(eng, [recipeEng]);
  check('wide engulfing bar fires', runRecipeOnSymbol(recipeEng, 'T', indE).length === 1);

  // same close, but low far above prev low -> NOT an engulf, must not fire
  const eng2: C[] = [];
  for (let i = 0; i < 5; i++) eng2.push({ date: iso(i), open: 105, high: 110, low: 100, close: 105, volume: 1000 });
  eng2.push({ date: iso(5), open: 111, high: 113, low: 109, close: 112, volume: 1000 });
  for (let i = 6; i < 12; i++) eng2.push({ date: iso(i), open: 112, high: 113, low: 111, close: 112, volume: 1000 });
  const indE2 = indicatorsFor(eng2, [recipeEng]);
  check('narrow gap-up bar is not an engulf', runRecipeOnSymbol(recipeEng, 'T', indE2).length === 0);

  // emaTouch: close>ema AND close>open AND low<=ema
  const recipeTouch: StrategyRecipe = {
    label: 't', direction: 'LONG',
    entry: [{ kind: 'emaTouch', period: 5, side: 'above' }],
    exit: { stopKind: 'pct', stopValue: 0.05, maxRiskPct: 0.05, rewardMultiple: 2, maxHoldBars: 3 },
  };
  const tc: C[] = [];
  for (let i = 0; i < 30; i++) tc.push({ date: iso(i), open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  const indT = indicatorsFor(tc, [recipeTouch]);
  const ema5 = indT.ema.get(5)?.[20];
  check('EMA5 on a flat series equals price', Math.abs((ema5 ?? 0) - 100) < 1e-6, String(ema5));

  // cooldown: 15-bar duplicate filter
  const recipeCd: StrategyRecipe = {
    label: 't', direction: 'LONG',
    entry: [{ kind: 'engulfPrevRange', tolerancePct: 0.5, side: 'up' }],
    exit: { stopKind: 'pct', stopValue: 0.02, maxRiskPct: 0.02, rewardMultiple: 1, maxHoldBars: 1 },
    cooldownBars: 15,
  };
  // Rising hard enough that every bar closes above the previous bar's high, so the entry
  // condition is true on essentially every bar and only the cooldown can space entries out.
  const cd: C[] = [];
  let p = 100;
  for (let i = 0; i < 80; i++) {
    p *= 1.03;
    cd.push({ date: iso(i), open: p * 0.999, high: p * 1.001, low: p * 0.98, close: p, volume: 1000 });
  }
  const indCd = indicatorsFor(cd, [recipeCd]);
  const cdTrades = runRecipeOnSymbol(recipeCd, 'T', indCd);
  const idxOf = (d: string) => cd.findIndex((c) => c.date === d);
  const gaps: number[] = [];
  for (let i = 1; i < cdTrades.length; i++) {
    gaps.push(idxOf(cdTrades[i]!.entryDate) - idxOf(cdTrades[i - 1]!.entryDate));
  }
  check('cooldown fixture actually produces trades', cdTrades.length >= 3, String(cdTrades.length));
  check('entries respect the 15-bar cooldown', gaps.length > 0 && gaps.every((g) => g >= 15), gaps.join(','));

  // And without a cooldown the same data must fire far more often — proving the gap above
  // is the cooldown doing work, not the data being sparse.
  const noCd: StrategyRecipe = { ...recipeCd, cooldownBars: undefined };
  const noCdTrades = runRecipeOnSymbol(noCd, 'T', indicatorsFor(cd, [noCd]));
  check('removing the cooldown yields more trades', noCdTrades.length > cdTrades.length,
    `${noCdTrades.length} vs ${cdTrades.length}`);
  console.log(`     ${cdTrades.length} trades with cooldown (gaps ${gaps.join(', ')}), ${noCdTrades.length} without`);
}

// ---------- 8. Preset spaces build ----------
console.log('\n8. Presets expand into valid recipes');
{
  const sp = buildRecipes(smartPullbackSpace());
  check('Smart Pullback preset produces recipes', sp.length > 0, String(sp.length));
  const first = sp[0]!;
  const kinds = first.entry.map((c: EntryCondition) => c.kind);
  check('includes price-vs-EMA', kinds.includes('priceVsEma'), kinds.join(','));
  check('includes engulf block', kinds.includes('engulfPrevRange'), kinds.join(','));
  check('includes strong body', kinds.includes('strongBody'), kinds.join(','));
  check('includes sideways filter', kinds.includes('notSideways'), kinds.join(','));
  check('carries the 15-bar cooldown', first.cooldownBars === 15, String(first.cooldownBars));

  const pb = buildRecipes(emaPullbackSpace());
  check('EMA-pullback preset produces recipes', pb.length > 0, String(pb.length));
  check('uses emaTouch', pb[0]!.entry.some((c: EntryCondition) => c.kind === 'emaTouch'));
  console.log(`     smartPullback ${sp.length} combos, emaPullback ${pb.length} combos`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

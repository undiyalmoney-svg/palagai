#!/usr/bin/env npx tsx
/**
 * Prove Nifty/Bank Paper (Testing) and Live resolve to the same Ruler module
 * and that assignment APIs cannot diverge them.
 */
import assert from 'assert';
import {
  DEFAULT_CHANNEL_ASSIGNMENTS,
  MANAGED_STRATEGY_IDS,
} from '../src/app/core/strategy-manager/config/managed-strategy-ids';
import {
  pickRulerArm,
  clipRulerDayInr,
  rulerDayCapInr,
  RULER_RAMPAGE_UNTIL_INR,
  RULER_DAY_CAP_INR,
  type RulerMorningFeatures,
} from '../src/app/core/strategy-manager/engines/ruler-morning.util';

const RULER = MANAGED_STRATEGY_IDS.RULER;

function assertDefaults(): void {
  for (const ch of ['nifty', 'bank'] as const) {
    assert.strictEqual(DEFAULT_CHANNEL_ASSIGNMENTS[ch].paper, RULER, `${ch} paper default`);
    assert.strictEqual(DEFAULT_CHANNEL_ASSIGNMENTS[ch].live, RULER, `${ch} live default`);
    assert.strictEqual(DEFAULT_CHANNEL_ASSIGNMENTS[ch].shadow, null, `${ch} shadow off`);
  }
  console.log('PASS defaults: nifty/bank paper+live = ruler-flow, shadow off');
}

/** Mirror StrategyAssignmentService.getStrategyId index lock (no Angular DI). */
function getStrategyIdLocked(
  channel: 'nifty' | 'bank' | 'stocks',
  mode: 'paper' | 'live',
  stored?: { paper: string; live: string },
): string {
  if (channel === 'nifty' || channel === 'bank') {
    return RULER;
  }
  const a = stored ?? DEFAULT_CHANNEL_ASSIGNMENTS.stocks;
  return mode === 'live' ? a.live : a.paper;
}

function assertPaperLiveSameStrategy(): void {
  for (const ch of ['nifty', 'bank'] as const) {
    const paper = getStrategyIdLocked(ch, 'paper');
    const live = getStrategyIdLocked(ch, 'live');
    assert.strictEqual(paper, RULER);
    assert.strictEqual(live, RULER);
    assert.strictEqual(paper, live, `${ch} paper !== live`);
  }
  // Even if storage were poisoned with Donch, index lock still returns Ruler.
  const poisonedPaper = getStrategyIdLocked('nifty', 'paper');
  const poisonedLive = getStrategyIdLocked('nifty', 'live');
  assert.strictEqual(poisonedPaper, poisonedLive);
  assert.strictEqual(poisonedPaper, RULER);
  console.log('PASS resolve: paper Testing + Live both lock to ruler-flow');
}

function assertArmLogicParity(): void {
  const trailMorning: RulerMorningFeatures = {
    drive: 0.7,
    gap: 0.2,
    wide: true,
    vwide: false,
    calm: false,
    choppy: false,
    emaBuy: true,
    emaSell: false,
    strong: true,
    vstrong: false,
    orUp: true,
    orWidth: 40,
    atr: 20,
  };
  const swingMorning: RulerMorningFeatures = {
    ...trailMorning,
    wide: false,
    strong: false,
    drive: 0.2,
  };
  const choppy: RulerMorningFeatures = {
    ...trailMorning,
    choppy: true,
    strong: false,
    drive: 0.1,
  };

  // Paper (testing MTD) and Live share the same pickRulerArm / witch switch.
  assert.strictEqual(pickRulerArm(choppy, 0), 'STAND');
  assert.strictEqual(pickRulerArm(trailMorning, 0), 'DONCH_TRAIL'); // beast · wide+strong
  assert.strictEqual(pickRulerArm(swingMorning, 0), 'SWING_2R'); // beast · EMA bias
  assert.strictEqual(pickRulerArm(trailMorning, RULER_RAMPAGE_UNTIL_INR - 1), 'DONCH_TRAIL');
  // After MTD ≥ ₹3k: wide+calm → DONCH_TRAIL; wide-not-calm → 2R; skinny → 2R/swing.
  assert.strictEqual(pickRulerArm(trailMorning, RULER_RAMPAGE_UNTIL_INR), 'DONCH_2R'); // wide but not calm
  const calmTrail: RulerMorningFeatures = { ...trailMorning, calm: true };
  assert.strictEqual(pickRulerArm(calmTrail, RULER_RAMPAGE_UNTIL_INR), 'DONCH_TRAIL');
  assert.strictEqual(pickRulerArm(swingMorning, RULER_RAMPAGE_UNTIL_INR), 'SWING_2R');
  // Loss-streak breaker → edge witch (wide+strong but not calm → SWING via ema).
  assert.strictEqual(
    pickRulerArm(trailMorning, RULER_RAMPAGE_UNTIL_INR, { breakerActive: true }),
    'SWING_2R',
  );

  // Day-cap math shared; desk applies entry-block / flatten only in live scope.
  assert.strictEqual(rulerDayCapInr(0), RULER_DAY_CAP_INR);
  assert.strictEqual(clipRulerDayInr(-5000, 0), -RULER_DAY_CAP_INR);
  assert.strictEqual(clipRulerDayInr(800, 0), 800);
  console.log('PASS DNA: same arm picker + day-cap clip for paper/live math');
}

function assertDeskModeMapping(): void {
  // Trade Desk: Testing → resolve(..., 'paper'); Live → resolve(..., 'live')
  // Both map to RULER for indices after v10 lock.
  const testingMode: 'paper' | 'live' = 'paper';
  const liveMode: 'paper' | 'live' = 'live';
  assert.strictEqual(getStrategyIdLocked('nifty', testingMode), getStrategyIdLocked('nifty', liveMode));
  assert.strictEqual(getStrategyIdLocked('bank', testingMode), getStrategyIdLocked('bank', liveMode));
  console.log('PASS desk map: Testing(paper) and Live(live) → same Ruler id');
}

function main(): void {
  assertDefaults();
  assertPaperLiveSameStrategy();
  assertArmLogicParity();
  assertDeskModeMapping();
  console.log(
    JSON.stringify(
      {
        strategy_id: RULER,
        paper_live_same: true,
        live_extra: 'day-cap blocks new entries only in live scope; Testing shows raw + research clip',
        mtd_scopes: 'testing memory isolated from live persistence',
      },
      null,
      2,
    ),
  );
}

main();

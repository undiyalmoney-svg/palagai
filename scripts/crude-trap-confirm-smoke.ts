/**
 * Smoke: Crude Trap Confirm arms → next-bar confirm → 3.5R.
 * Run: npx tsx scripts/crude-trap-confirm-smoke.ts
 */
import { Candle } from '../src/app/core/models/candle.model';
import {
  createCrudeTrapState,
  runCrudeTrapConfirm,
} from '../src/app/core/strategy-engine/strategies/crude-trap-confirm/crude-trap-confirm.evaluator';
import {
  CRUDE_TRAP_CONFIRM_PARAMS,
  resolveCrudeStrategyProfile,
} from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';

function bar(date: string, o: number, h: number, l: number, c: number): Candle {
  return { date, open: o, high: h, low: l, close: c, volume: 1 };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const p = resolveCrudeStrategyProfile('trap-confirm');
assert(p.profileId === 'trap-confirm', 'profile id');
assert(p.entryMode === 'trap-confirm', 'entry mode');
assert(p.profitLockArmRs === 0, 'peak-trail off on MCX evidence');
assert(p.dayLossStopPts === 0, 'no day loss stop');
assert(p.maxEveningTradesDay === 0, 'unlimited trades');
assert(CRUDE_TRAP_CONFIRM_PARAMS.targetRMultiple === 3.5, '3.5R');

const series: Candle[] = [];
// EMA warmup + flat day
for (let i = 0; i < 60; i += 1) {
  const t = 10 * 60 + i;
  const hh = String(Math.floor(t / 60)).padStart(2, '0');
  const mm = String(t % 60).padStart(2, '0');
  series.push(bar(`2026-07-22T${hh}:${mm}:00+05:30`, 7000, 7010, 6990, 7005));
}
// Swing low then trap: pierce below then close back above bullish
const trapBar = bar('2026-07-22T14:00:00+05:30', 7000, 7015, 6975, 7008);
series.push(trapBar);
const state = createCrudeTrapState();
const arm = runCrudeTrapConfirm({
  candle: trapBar,
  series,
  state,
  dayLossStopPts: 250,
  dayProfitLockPts: 0,
});
assert(arm.action === 'WAITING', `arm wait got ${arm.action}: ${arm.reason}`);
assert(arm.reason.includes('armed'), arm.reason);
assert(state.pending?.dir === 1, 'pending buy');

const confirm = bar('2026-07-22T14:05:00+05:30', 7010, 7030, 7005, 7025);
series.push(confirm);
const fill = runCrudeTrapConfirm({
  candle: confirm,
  series,
  state,
  dayLossStopPts: 250,
});
assert(fill.action === 'BUY', `confirm BUY got ${fill.action}: ${fill.reason}`);
assert(fill.reason.includes('3.5R') || fill.reason.includes('trap confirm'), fill.reason);
const risk = Math.abs(fill.entryPrice - fill.stopLoss);
assert(Math.abs(fill.target - (fill.entryPrice + risk * 3.5)) < 0.01, '3.5R target');

console.log('OK crude-trap-confirm-smoke');
console.log(
  JSON.stringify(
    {
      profile: p.label,
      armRs: p.profitLockArmRs,
      dayLossPts: p.dayLossStopPts,
      rr: p.targetRMultiple,
      fill: { entry: fill.entryPrice, stop: fill.stopLoss, target: fill.target },
    },
    null,
    2,
  ),
);

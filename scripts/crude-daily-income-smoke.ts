/**
 * Smoke: Daily Income crude profile day profit lock + SL/TP sizing.
 * Run: npx tsx scripts/crude-daily-income-smoke.ts
 */
import { Candle } from '../src/app/core/models/candle.model';
import {
  createCrudePdhlState,
  recordCrudeTradeClosed,
  runCrudePdhlEvening,
} from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import { runCrudeMorningOrb } from '../src/app/core/strategy-engine/strategies/crude-orb-morning/crude-orb-morning.evaluator';
import {
  CRUDE_DAILY_INCOME_PARAMS,
  crudePtsToRupees,
  resolveCrudeStrategyProfile,
} from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';

function bar(date: string, o: number, h: number, l: number, c: number): Candle {
  return { date, open: o, high: h, low: l, close: c, volume: 1 };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

const profile = resolveCrudeStrategyProfile('daily-income');
assert(profile.profileId === 'daily-income', 'default profile');
assert(profile.dayProfitLockPts === 100, 'lock 100 pts');
assert(crudePtsToRupees(profile.dayProfitLockPts) === 1000, 'lock ₹1000');
assert(crudePtsToRupees(profile.morningTargetPts) === 800, 'morning TP ₹800');
assert(crudePtsToRupees(profile.eveningTargetPts) === 500, 'evening TP ₹500');
assert(crudePtsToRupees(profile.stopPts) === 400, 'SL ₹400');
assert(crudePtsToRupees(30) === 300, 'min band ₹300 = 30 pts');

// Prev day + OR bars + break
const series: Candle[] = [];
for (let i = 0; i < 20; i += 1) {
  series.push(bar(`2026-07-21T10:${String(i).padStart(2, '0')}:00+05:30`, 7000, 7050, 6950, 7000));
}
// Opening range 09:00–10:00 on trade day
series.push(bar('2026-07-22T09:00:00+05:30', 7000, 7020, 6980, 7000));
series.push(bar('2026-07-22T09:30:00+05:30', 7000, 7030, 6970, 7010));
series.push(bar('2026-07-22T09:55:00+05:30', 7010, 7040, 6990, 7020));
// ORB break green above OR high (7040)
const orbBreak = bar('2026-07-22T10:15:00+05:30', 7040, 7060, 7035, 7055);
series.push(orbBreak);

const state = createCrudePdhlState();
const morning = runCrudeMorningOrb({
  candle: orbBreak,
  series,
  state,
  dayLossStopPts: CRUDE_DAILY_INCOME_PARAMS.dayLossStopPts,
  dayProfitLockPts: CRUDE_DAILY_INCOME_PARAMS.dayProfitLockPts,
  stopPts: CRUDE_DAILY_INCOME_PARAMS.stopPts,
  targetPts: CRUDE_DAILY_INCOME_PARAMS.morningTargetPts,
});
assert(morning.action === 'BUY', `expected BUY morning, got ${morning.action}: ${morning.reason}`);
assert(
  Math.abs(morning.target - (morning.entryPrice + 80)) < 0.01,
  `morning TP distance ${morning.target - morning.entryPrice}`,
);
assert(
  Math.abs(morning.entryPrice - morning.stopLoss - 40) < 0.01,
  `morning SL distance ${morning.entryPrice - morning.stopLoss}`,
);

recordCrudeTradeClosed(state, 100, CRUDE_DAILY_INCOME_PARAMS.dayLossStopPts, 'morning', 100);
assert(state.dayStoppedReason?.includes('profit lock'), `expected lock, got ${state.dayStoppedReason}`);
assert(crudePtsToRupees(state.dayNetPts) === 1000, 'day net ₹1000 after lock');

const blocked = runCrudeMorningOrb({
  candle: bar('2026-07-22T11:00:00+05:30', 7100, 7120, 7090, 7110),
  series,
  state,
  dayLossStopPts: CRUDE_DAILY_INCOME_PARAMS.dayLossStopPts,
  dayProfitLockPts: CRUDE_DAILY_INCOME_PARAMS.dayProfitLockPts,
  stopPts: CRUDE_DAILY_INCOME_PARAMS.stopPts,
  targetPts: CRUDE_DAILY_INCOME_PARAMS.morningTargetPts,
});
assert(blocked.action === 'WAITING', 'no new trades after lock');
assert(blocked.reason.includes('profit lock'), blocked.reason);

// Evening PDHL with fresh state
const eveState = createCrudePdhlState();
const eveningBreak = bar('2026-07-22T19:00:00+05:30', 7060, 7080, 7055, 7075);
series.push(eveningBreak);
const evening = runCrudePdhlEvening({
  candle: eveningBreak,
  series,
  index: series.length - 1,
  state: eveState,
  dayLossStopPts: CRUDE_DAILY_INCOME_PARAMS.dayLossStopPts,
  dayProfitLockPts: CRUDE_DAILY_INCOME_PARAMS.dayProfitLockPts,
  stopPts: CRUDE_DAILY_INCOME_PARAMS.stopPts,
  targetPts: CRUDE_DAILY_INCOME_PARAMS.eveningTargetPts,
});
assert(evening.action === 'BUY', `expected BUY evening, got ${evening.action}: ${evening.reason}`);
assert(
  Math.abs(evening.target - (evening.entryPrice + 50)) < 0.01,
  `evening TP ${evening.target - evening.entryPrice}`,
);

console.log('OK crude-daily-income-smoke');
console.log(
  JSON.stringify(
    {
      profile: profile.label,
      morningSlTpRs: [crudePtsToRupees(40), crudePtsToRupees(80)],
      eveningSlTpRs: [crudePtsToRupees(40), crudePtsToRupees(50)],
      dayLockRs: crudePtsToRupees(100),
      dayStopRs: crudePtsToRupees(50),
    },
    null,
    2,
  ),
);

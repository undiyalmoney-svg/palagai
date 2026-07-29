/**
 * Smoke: Daily Income crude profile — SL/TP sizing, unlimited, day loss −₹1,500.
 * Run: npx tsx scripts/crude-daily-income-smoke.ts
 */
import { Candle } from '../src/app/core/models/candle.model';
import {
  createCrudePdhlState,
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
assert(profile.profileId === 'daily-income', 'profile id');
assert(profile.dayProfitLockPts === 0, 'no day profit lock');
assert(profile.dayLossStopPts === 150, 'day loss 150 pts');
assert(profile.maxEveningTradesDay === 0, 'unlimited');
assert(crudePtsToRupees(profile.morningTargetPts) === 800, 'morning TP ₹800');
assert(crudePtsToRupees(profile.eveningTargetPts) === 500, 'evening TP ₹500');
assert(crudePtsToRupees(profile.stopPts) === 400, 'SL ₹400');

const series: Candle[] = [];
for (let i = 0; i < 20; i += 1) {
  series.push(bar(`2026-07-21T10:${String(i).padStart(2, '0')}:00+05:30`, 7000, 7050, 6950, 7000));
}
series.push(bar('2026-07-22T09:00:00+05:30', 7000, 7020, 6980, 7000));
series.push(bar('2026-07-22T09:30:00+05:30', 7000, 7030, 6970, 7010));
series.push(bar('2026-07-22T09:55:00+05:30', 7010, 7040, 6990, 7020));
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
assert(Math.abs(morning.target - (morning.entryPrice + 80)) < 0.01, 'morning TP 80');
assert(Math.abs(morning.entryPrice - morning.stopLoss - 40) < 0.01, 'morning SL 40');

console.log('OK crude-daily-income-smoke', {
  profile: profile.label,
  morningSlTpRs: [crudePtsToRupees(profile.stopPts), crudePtsToRupees(profile.morningTargetPts)],
  eveningSlTpRs: [crudePtsToRupees(profile.stopPts), crudePtsToRupees(profile.eveningTargetPts)],
  dayLockRs: crudePtsToRupees(profile.dayProfitLockPts),
  dayStopRs: crudePtsToRupees(profile.dayLossStopPts),
});

// silence unused
void runCrudePdhlEvening;

/**
 * Smoke: Daily Profit crude — confirm + SL/TP, unlimited, no day-wide stop.
 * Run: npx tsx scripts/crude-daily-profit-smoke.ts
 */
import { Candle } from '../src/app/core/models/candle.model';
import {
  createCrudePdhlState,
  runCrudePdhlEvening,
} from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import {
  CRUDE_DAILY_PROFIT_PARAMS,
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

const profile = resolveCrudeStrategyProfile('daily-profit');
assert(profile.profileId === 'daily-profit', 'profile id');
assert(profile.requireConfirm === true, 'confirm on');
assert(profile.eveningEntryEnd === '21:00', 'entry to 21:00');
assert(profile.dayProfitLockPts === 0, 'no day lock');
assert(profile.dayLossStopPts === 0, 'no day-wide loss stop');
assert(profile.maxEveningTradesDay === 0, 'unlimited');
assert(crudePtsToRupees(profile.eveningTargetPts) === 400, 'TP ₹400');
assert(crudePtsToRupees(profile.stopPts) === 200, 'SL ₹200');
assert(profile.defaultEnableMorning === false, 'morning off by default');

const series: Candle[] = [];
for (let i = 0; i < 20; i += 1) {
  series.push(bar(`2026-07-21T18:${String(i).padStart(2, '0')}:00+05:30`, 7000, 7050, 6950, 7000));
}
const signal = bar('2026-07-22T19:00:00+05:30', 7040, 7070, 7035, 7060);
series.push(signal);

const state = createCrudePdhlState();
const armed = runCrudePdhlEvening({
  candle: signal,
  series,
  index: series.length - 1,
  state,
  dayLossStopPts: CRUDE_DAILY_PROFIT_PARAMS.dayLossStopPts,
  dayProfitLockPts: CRUDE_DAILY_PROFIT_PARAMS.dayProfitLockPts,
  stopPts: CRUDE_DAILY_PROFIT_PARAMS.stopPts,
  targetPts: CRUDE_DAILY_PROFIT_PARAMS.eveningTargetPts,
  requireConfirm: true,
  entryEnd: CRUDE_DAILY_PROFIT_PARAMS.eveningEntryEnd,
  maxTradesDay: CRUDE_DAILY_PROFIT_PARAMS.maxEveningTradesDay,
});
assert(armed.action === 'WAITING', `expected WAITING armed, got ${armed.action}: ${armed.reason}`);
assert(!!state.pendingConfirm, 'pendingConfirm set');

const confirm = bar('2026-07-22T19:05:00+05:30', 7060, 7080, 7055, 7075);
series.push(confirm);
const filled = runCrudePdhlEvening({
  candle: confirm,
  series,
  index: series.length - 1,
  state,
  dayLossStopPts: CRUDE_DAILY_PROFIT_PARAMS.dayLossStopPts,
  dayProfitLockPts: CRUDE_DAILY_PROFIT_PARAMS.dayProfitLockPts,
  stopPts: CRUDE_DAILY_PROFIT_PARAMS.stopPts,
  targetPts: CRUDE_DAILY_PROFIT_PARAMS.eveningTargetPts,
  requireConfirm: true,
  entryEnd: CRUDE_DAILY_PROFIT_PARAMS.eveningEntryEnd,
  maxTradesDay: CRUDE_DAILY_PROFIT_PARAMS.maxEveningTradesDay,
});
assert(filled.action === 'BUY', `expected BUY confirm, got ${filled.action}: ${filled.reason}`);
assert(Math.abs(filled.entryPrice - 7060) < 0.01, `fill at open ${filled.entryPrice}`);
assert(Math.abs(filled.entryPrice - filled.stopLoss - 20) < 0.01, 'SL 20 pts');
assert(Math.abs(filled.target - filled.entryPrice - 40) < 0.01, 'TP 40 pts');

console.log('crude-daily-profit-smoke OK');

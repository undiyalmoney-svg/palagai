/**
 * Smoke: Daily Profit (Trap-style) crude profile — confirm + SL/TP + day lock.
 * Run: npx tsx scripts/crude-daily-profit-smoke.ts
 */
import { Candle } from '../src/app/core/models/candle.model';
import {
  createCrudePdhlState,
  recordCrudeTradeClosed,
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
assert(profile.profileId === 'daily-profit', 'default profile is daily-profit');
assert(profile.requireConfirm === true, 'confirm on');
assert(profile.eveningEntryEnd === '21:00', 'entry to 21:00');
assert(profile.dayProfitLockPts === 50, 'lock 50 pts');
assert(crudePtsToRupees(profile.dayProfitLockPts) === 500, 'lock ₹500');
assert(crudePtsToRupees(profile.eveningTargetPts) === 400, 'TP ₹400');
assert(crudePtsToRupees(profile.stopPts) === 200, 'SL ₹200');
assert(crudePtsToRupees(profile.dayLossStopPts) === 400, 'day −₹400');
assert(profile.defaultEnableMorning === false, 'morning off by default');

// Prev day highs/lows
const series: Candle[] = [];
for (let i = 0; i < 20; i += 1) {
  series.push(bar(`2026-07-21T18:${String(i).padStart(2, '0')}:00+05:30`, 7000, 7050, 6950, 7000));
}
// PDH ~7050 from prev day — break green above PDH
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
assert(armed.reason.includes('waiting confirm'), `reason: ${armed.reason}`);

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
assert(Math.abs(filled.entryPrice - filled.stopLoss - 20) < 0.01, `SL 20 pts`);
assert(Math.abs(filled.target - filled.entryPrice - 40) < 0.01, `TP 40 pts`);
assert(filled.reason.includes('confirm'), `confirm in reason: ${filled.reason}`);

recordCrudeTradeClosed(state, 50, CRUDE_DAILY_PROFIT_PARAMS.dayLossStopPts, 'evening', 50);
assert(state.dayStoppedReason?.includes('profit lock'), `expected lock, got ${state.dayStoppedReason}`);
assert(crudePtsToRupees(state.dayNetPts) === 500, 'day net ₹500 after lock');

const blocked = runCrudePdhlEvening({
  candle: bar('2026-07-22T19:30:00+05:30', 7100, 7120, 7090, 7110),
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
assert(blocked.action === 'WAITING', 'blocked after day lock');
assert(blocked.reason.includes('profit lock'), `lock reason: ${blocked.reason}`);

console.log('crude-daily-profit-smoke OK');

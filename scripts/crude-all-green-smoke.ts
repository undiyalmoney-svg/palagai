/**
 * Smoke: All-Green Afternoon Session OR (15:15–23:00).
 * Run: npx tsx scripts/crude-all-green-smoke.ts
 */
import { Candle } from '../src/app/core/models/candle.model';
import {
  createCrudePdhlState,
  recordCrudeTradeClosed,
} from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import { runCrudeSessionOr } from '../src/app/core/strategy-engine/strategies/crude-session-or/crude-session-or.evaluator';
import {
  CRUDE_ALL_GREEN_PARAMS,
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

const profile = resolveCrudeStrategyProfile('all-green');
assert(profile.profileId === 'all-green', 'default all-green');
assert(profile.entryMode === 'session-or', 'session-or mode');
assert(profile.requireConfirm === true, 'confirm');
assert(profile.firstWinLock === true, 'first-win');
assert(profile.eveningEntryStart === '15:15', 'entry start');
assert(profile.eveningEntryEnd === '23:00', 'entry end');
assert(profile.sessionOrEnd === '15:45', 'OR end');
assert(crudePtsToRupees(profile.stopPts) === 120, 'SL ₹120');
assert(crudePtsToRupees(profile.eveningTargetPts) === 240, 'TP ₹240');
assert(crudePtsToRupees(profile.dayProfitLockPts) === 200, 'lock ₹200');
assert(crudePtsToRupees(profile.dayLossStopPts) === 150, 'day −₹150');

const series: Candle[] = [];
// Build OR 15:15–15:45 range ~6980–7020
series.push(bar('2026-07-22T15:15:00+05:30', 7000, 7010, 6990, 7005));
series.push(bar('2026-07-22T15:30:00+05:30', 7005, 7020, 6995, 7010));
series.push(bar('2026-07-22T15:45:00+05:30', 7010, 7015, 6980, 6990));
// Break above OR high 7020
const signal = bar('2026-07-22T16:00:00+05:30', 7015, 7035, 7010, 7030);
series.push(signal);

const state = createCrudePdhlState();
const armed = runCrudeSessionOr({
  candle: signal,
  series,
  state,
  ...pick(),
});
assert(armed.action === 'WAITING', `armed WAITING got ${armed.action}: ${armed.reason}`);
assert(!!state.pendingConfirm, 'pending');
assert(armed.reason.includes('waiting confirm'), armed.reason);

const confirm = bar('2026-07-22T16:05:00+05:30', 7030, 7045, 7025, 7040);
series.push(confirm);
const filled = runCrudeSessionOr({
  candle: confirm,
  series,
  state,
  ...pick(),
});
assert(filled.action === 'BUY', `BUY got ${filled.action}: ${filled.reason}`);
assert(Math.abs(filled.entryPrice - 7030) < 0.01, `fill open ${filled.entryPrice}`);
assert(Math.abs(filled.entryPrice - filled.stopLoss - 12) < 0.01, 'SL 12');
assert(Math.abs(filled.target - filled.entryPrice - 24) < 0.01, 'TP 24');

recordCrudeTradeClosed(
  state,
  24,
  CRUDE_ALL_GREEN_PARAMS.dayLossStopPts,
  'evening',
  CRUDE_ALL_GREEN_PARAMS.dayProfitLockPts,
  true,
);
assert(state.wonToday === true, 'wonToday');
assert(state.dayStoppedReason?.includes('First win'), `first win: ${state.dayStoppedReason}`);

const blocked = runCrudeSessionOr({
  candle: bar('2026-07-22T17:00:00+05:30', 7100, 7120, 7090, 7110),
  series,
  state,
  ...pick(),
});
assert(blocked.action === 'WAITING', 'blocked after first win');
assert(blocked.reason.includes('First win') || blocked.reason.includes('Day'), blocked.reason);

console.log('crude-all-green-smoke OK');

function pick() {
  return {
    dayLossStopPts: CRUDE_ALL_GREEN_PARAMS.dayLossStopPts,
    dayProfitLockPts: CRUDE_ALL_GREEN_PARAMS.dayProfitLockPts,
    stopPts: CRUDE_ALL_GREEN_PARAMS.stopPts,
    targetPts: CRUDE_ALL_GREEN_PARAMS.eveningTargetPts,
    requireConfirm: true,
    firstWinLock: true,
    entryStart: CRUDE_ALL_GREEN_PARAMS.eveningEntryStart,
    entryEnd: CRUDE_ALL_GREEN_PARAMS.eveningEntryEnd,
    orStart: CRUDE_ALL_GREEN_PARAMS.sessionOrStart,
    orEnd: CRUDE_ALL_GREEN_PARAMS.sessionOrEnd,
    maxOrWidth: CRUDE_ALL_GREEN_PARAMS.maxOrWidth,
    maxTradesDay: CRUDE_ALL_GREEN_PARAMS.maxEveningTradesDay,
  };
}

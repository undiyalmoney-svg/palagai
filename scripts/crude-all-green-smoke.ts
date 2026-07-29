/**
 * Smoke: All-Green — Session OR from open, per-trade SL ₹150 + trail ₹500→₹240.
 * No day-wide stop — after SL, next opportunity allowed.
 * Run: npx tsx scripts/crude-all-green-smoke.ts
 */
import { Candle } from '../src/app/core/models/candle.model';
import { createCrudePdhlState } from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
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
assert(profile.firstWinLock === false, 'no first-win');
assert(profile.dayProfitLockPts === 0, 'no day profit lock');
assert(profile.dayLossStopPts === 0, 'no day-wide loss stop');
assert(profile.maxEveningTradesDay === 0, 'unlimited trades');
assert(profile.eveningEntryStart === '09:00', 'entry start');
assert(profile.eveningEntryEnd === '23:00', 'entry end');
assert(profile.sessionOrStart === '09:00', 'OR start');
assert(profile.sessionOrEnd === '09:30', 'OR end');
assert(profile.maxOrWidth === 0, 'no OR-width skip');
assert(crudePtsToRupees(profile.stopPts) === 150, 'SL ₹150');
assert(crudePtsToRupees(profile.eveningTargetPts) === 1000, 'stretch TP ₹1000');
assert(profile.profitLockArmRs === 500, 'trail arm ₹500');
assert(profile.profitLockLockRs === 240, 'trail lock ₹240');
assert(profile.profitLockGivebackRs === 260, 'giveback ₹260');

const series: Candle[] = [];
series.push(bar('2026-07-22T09:00:00+05:30', 7000, 7010, 6990, 7005));
series.push(bar('2026-07-22T09:15:00+05:30', 7005, 7020, 6995, 7010));
series.push(bar('2026-07-22T09:30:00+05:30', 7010, 7015, 6980, 6990));
const signal = bar('2026-07-22T09:35:00+05:30', 7015, 7035, 7010, 7030);
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

const confirm = bar('2026-07-22T09:40:00+05:30', 7030, 7045, 7025, 7040);
series.push(confirm);
const filled = runCrudeSessionOr({
  candle: confirm,
  series,
  state,
  ...pick(),
});
assert(filled.action === 'BUY', `BUY got ${filled.action}: ${filled.reason}`);
assert(Math.abs(filled.entryPrice - 7030) < 0.01, `fill open ${filled.entryPrice}`);
assert(Math.abs(filled.entryPrice - filled.stopLoss - 15) < 0.01, 'SL 15 pts');
assert(Math.abs(filled.target - filled.entryPrice - 100) < 0.01, 'TP 100 pts');

// After a loss, next opportunity still allowed (no day lock).
state.tradesToday = 1;
state.dayNetPts = -15;
state.wonToday = false;
state.pendingConfirm = null;
const signal2 = bar('2026-07-22T11:00:00+05:30', 7040, 7060, 7035, 7055);
series.push(signal2);
const again = runCrudeSessionOr({
  candle: signal2,
  series,
  state,
  ...pick(),
});
assert(
  again.action === 'WAITING' && again.reason.includes('waiting confirm'),
  `after SL still hunts, got ${again.action}: ${again.reason}`,
);

// Peak-trail floor math: arm ₹500 → floor max(240, peak−260).
const peakRs = 500;
const floorRs = Math.max(profile.profitLockLockRs, peakRs - profile.profitLockGivebackRs);
assert(floorRs === 240, `trail floor at peak ₹500 should be ₹240, got ${floorRs}`);

// Wide OR must still trade (OR-width filter off).
const wide: Candle[] = [];
wide.push(bar('2026-07-29T09:00:00+05:30', 7750, 7932, 7750, 7930));
wide.push(bar('2026-07-29T09:15:00+05:30', 7930, 7947, 7900, 7920));
wide.push(bar('2026-07-29T09:30:00+05:30', 7920, 7930, 7880, 7900));
const wideSignal = bar('2026-07-29T09:35:00+05:30', 7940, 7960, 7935, 7955);
wide.push(wideSignal);
const wideState = createCrudePdhlState();
const wideArm = runCrudeSessionOr({
  candle: wideSignal,
  series: wide,
  state: wideState,
  ...pick(),
});
assert(
  wideArm.action === 'WAITING' && !!wideState.pendingConfirm,
  `wide OR still arms, got ${wideArm.action}: ${wideArm.reason}`,
);

console.log('crude-all-green-smoke OK');

function pick() {
  return {
    dayLossStopPts: CRUDE_ALL_GREEN_PARAMS.dayLossStopPts,
    dayProfitLockPts: CRUDE_ALL_GREEN_PARAMS.dayProfitLockPts,
    stopPts: CRUDE_ALL_GREEN_PARAMS.stopPts,
    targetPts: CRUDE_ALL_GREEN_PARAMS.eveningTargetPts,
    requireConfirm: true,
    firstWinLock: false,
    entryStart: CRUDE_ALL_GREEN_PARAMS.eveningEntryStart,
    entryEnd: CRUDE_ALL_GREEN_PARAMS.eveningEntryEnd,
    orStart: CRUDE_ALL_GREEN_PARAMS.sessionOrStart,
    orEnd: CRUDE_ALL_GREEN_PARAMS.sessionOrEnd,
    maxOrWidth: CRUDE_ALL_GREEN_PARAMS.maxOrWidth,
    maxTradesDay: CRUDE_ALL_GREEN_PARAMS.maxEveningTradesDay,
  };
}

/**
 * Smoke: All-Green — Session OR from open, unlimited trades, day loss −₹1,500.
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
assert(profile.dayLossStopPts === 150, 'day loss 150 pts (−₹1,500)');
assert(profile.strictDayLossPts === 180, 'strict day loss 180 pts');
assert(profile.maxEveningTradesDay === 0, 'unlimited trades');
assert(profile.eveningEntryStart === '09:00', 'entry start');
assert(profile.eveningEntryEnd === '23:00', 'entry end');
assert(profile.sessionOrStart === '09:00', 'OR start');
assert(profile.sessionOrEnd === '09:30', 'OR end');
assert(crudePtsToRupees(profile.stopPts) === 120, 'SL ₹120');
assert(crudePtsToRupees(profile.eveningTargetPts) === 240, 'TP ₹240');

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
assert(Math.abs(filled.entryPrice - filled.stopLoss - 12) < 0.01, 'SL 12');
assert(Math.abs(filled.target - filled.entryPrice - 24) < 0.01, 'TP 24');

// Second opportunity same day must still be allowed (no first-win / max-trades).
state.tradesToday = 1;
state.wonToday = true;
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
  `second signal allowed, got ${again.action}: ${again.reason}`,
);

// Day loss cutoff blocks further entries.
state.pendingConfirm = null;
state.dayNetPts = -150;
const blockedBar = bar('2026-07-22T12:00:00+05:30', 7050, 7070, 7045, 7065);
series.push(blockedBar);
const blocked = runCrudeSessionOr({
  candle: blockedBar,
  series,
  state,
  ...pick(),
});
assert(
  blocked.action === 'WAITING' && blocked.reason.includes('Day max loss'),
  `day loss blocks, got ${blocked.action}: ${blocked.reason}`,
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

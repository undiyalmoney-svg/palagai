/**
 * Smoke: Steady ₹500 crude profile — OR breakout SL35/TP50, ₹1,000 day lock, ≤3/day.
 * Run: npx tsx scripts/crude-steady-500-smoke.ts
 */
import { Candle } from '../src/app/core/models/candle.model';
import { createCrudePdhlState } from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import { runCrudeSessionOr } from '../src/app/core/strategy-engine/strategies/crude-session-or/crude-session-or.evaluator';
import {
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

const p = resolveCrudeStrategyProfile('steady-500');
assert(p.profileId === 'steady-500', 'profile id');
assert(p.entryMode === 'session-or', 'session-or mode');
assert(crudePtsToRupees(p.stopPts) === 350, `SL ₹350, got ${crudePtsToRupees(p.stopPts)}`);
assert(crudePtsToRupees(p.eveningTargetPts) === 500, `TP ₹500, got ${crudePtsToRupees(p.eveningTargetPts)}`);
assert(crudePtsToRupees(p.dayProfitLockPts) === 1000, 'day lock ₹1,000');
assert(p.maxEveningTradesDay === 3, 'max 3/day');

// OR 09:00–09:45 range ~6970–7030, breakout after 09:45.
const series: Candle[] = [
  bar('2026-07-22T09:00:00+05:30', 7000, 7020, 6980, 7000),
  bar('2026-07-22T09:30:00+05:30', 7000, 7030, 6970, 7010),
  bar('2026-07-22T09:40:00+05:30', 7010, 7028, 6995, 7015),
];
const breakBar = bar('2026-07-22T09:50:00+05:30', 7028, 7060, 7026, 7045);
series.push(breakBar);

const state = createCrudePdhlState();
const sig = runCrudeSessionOr({
  candle: breakBar,
  series,
  state,
  dayLossStopPts: p.dayLossStopPts,
  dayProfitLockPts: p.dayProfitLockPts,
  stopPts: p.stopPts,
  targetPts: p.eveningTargetPts,
  requireConfirm: p.requireConfirm,
  entryStart: p.eveningEntryStart,
  entryEnd: p.eveningEntryEnd,
  orStart: p.sessionOrStart,
  orEnd: p.sessionOrEnd,
  maxOrWidth: p.maxOrWidth,
  maxTradesDay: p.maxEveningTradesDay,
});
assert(sig.action === 'BUY', `expected BUY, got ${sig.action}: ${sig.reason}`);
assert(Math.abs(sig.target - (sig.entryPrice + 50)) < 0.01, 'TP +50');
assert(Math.abs(sig.entryPrice - sig.stopLoss - 35) < 0.01, 'SL 35');

// Day lock: once +100 pts (₹1,000) banked, no new entry.
const locked = createCrudePdhlState();
locked.tradingDate = '2026-07-22';
locked.dayNetPts = 100;
const lockedSig = runCrudeSessionOr({
  candle: breakBar,
  series,
  state: locked,
  dayLossStopPts: p.dayLossStopPts,
  dayProfitLockPts: p.dayProfitLockPts,
  stopPts: p.stopPts,
  targetPts: p.eveningTargetPts,
  requireConfirm: p.requireConfirm,
  entryStart: p.eveningEntryStart,
  entryEnd: p.eveningEntryEnd,
  orStart: p.sessionOrStart,
  orEnd: p.sessionOrEnd,
  maxOrWidth: p.maxOrWidth,
  maxTradesDay: p.maxEveningTradesDay,
});
assert(lockedSig.action === 'WAITING', 'locked → WAITING');
assert(/profit lock/i.test(lockedSig.reason), `lock reason, got ${lockedSig.reason}`);

console.log('OK crude-steady-500-smoke', {
  profile: p.label,
  slTpRs: [crudePtsToRupees(p.stopPts), crudePtsToRupees(p.eveningTargetPts)],
  dayLockRs: crudePtsToRupees(p.dayProfitLockPts),
  maxPerDay: p.maxEveningTradesDay,
});

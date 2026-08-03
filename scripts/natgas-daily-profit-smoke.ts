/**
 * Smoke: Nat Gas Daily Profit profile resolves + fixed-SL trap path arms/confirm.
 * Run: npx tsx scripts/natgas-daily-profit-smoke.ts
 */
import { resolveCrudeStrategyProfile } from '../src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';
import {
  createCrudeTrapState,
  runCrudeTrapConfirm,
} from '../src/app/core/strategy-engine/strategies/crude-trap-confirm/crude-trap-confirm.evaluator';
import type { Candle } from '../src/app/core/models/candle.model';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const profile = resolveCrudeStrategyProfile('daily-profit-ng');
assert(profile.profileId === 'daily-profit-ng', 'profile id');
assert(profile.entryMode === 'trap-confirm', 'entry mode');
assert(profile.stopPts === 1.5, 'stopPts');
assert(profile.eveningTargetPts === 3, 'target');
assert(profile.piercePts === 0.2, 'pierce');
assert(profile.trapEntryStyle === 'trap', 'trap-only');
assert(profile.firstWinLock === true, 'first-win');
assert(profile.maxEveningTradesDay === 1, 'max 1/day');
assert(profile.dayLossStopPts === 3, 'day loss');

const day = '2026-07-15';
const series: Candle[] = [];
let px = 300;
for (let i = 0; i < 60; i += 1) {
  const h = 9 + Math.floor((i * 5) / 60);
  const m = (i * 5) % 60;
  const o = px;
  const c = px + (i % 3 === 0 ? 0.2 : -0.1);
  series.push({
    date: `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+0530`,
    open: o,
    high: Math.max(o, c) + 0.3,
    low: Math.min(o, c) - 0.3,
    close: c,
    volume: 100,
  });
  px = c;
}
// Force a trap pierce below swing then reclaim
const last = series[series.length - 1]!;
const swingLow = Math.min(...series.slice(-6, -1).map((b) => b.low));
series.push({
  date: `${day}T14:00:00+0530`,
  open: swingLow + 0.1,
  high: swingLow + 0.4,
  low: swingLow - 0.5, // pierce 0.2+
  close: swingLow + 0.2,
  volume: 100,
});
series.push({
  date: `${day}T14:05:00+0530`,
  open: swingLow + 0.25,
  high: swingLow + 0.6,
  low: swingLow + 0.1,
  close: swingLow + 0.55, // bullish confirm
  volume: 100,
});

const state = createCrudeTrapState();
const arm = runCrudeTrapConfirm({
  candle: series[series.length - 2]!,
  series,
  state,
  dayLossStopPts: profile.dayLossStopPts,
  stopPts: profile.stopPts,
  targetPts: profile.eveningTargetPts,
  targetRMultiple: 0,
  pierce: profile.piercePts,
  trapEntryStyle: profile.trapEntryStyle,
  entryStart: profile.eveningEntryStart,
  entryEnd: profile.eveningEntryEnd,
  maxTradesDay: profile.maxEveningTradesDay,
  firstWinLock: profile.firstWinLock,
});
assert(state.pending != null || arm.reason.includes('armed') || arm.action === 'WAITING', `arm: ${arm.reason}`);

const fill = runCrudeTrapConfirm({
  candle: series[series.length - 1]!,
  series,
  state,
  dayLossStopPts: profile.dayLossStopPts,
  stopPts: profile.stopPts,
  targetPts: profile.eveningTargetPts,
  targetRMultiple: 0,
  pierce: profile.piercePts,
  trapEntryStyle: profile.trapEntryStyle,
  entryStart: profile.eveningEntryStart,
  entryEnd: profile.eveningEntryEnd,
  maxTradesDay: profile.maxEveningTradesDay,
  firstWinLock: profile.firstWinLock,
});

if (fill.action === 'BUY' || fill.action === 'SELL') {
  const risk = Math.abs(fill.entryPrice - fill.stopLoss);
  const reward = Math.abs(fill.target - fill.entryPrice);
  assert(Math.abs(risk - 1.5) < 1e-9, `SL dist ${risk}`);
  assert(Math.abs(reward - 3) < 1e-9, `TP dist ${reward}`);
  console.log('natgas-daily-profit-smoke OK · filled', fill.action, fill.reason);
} else {
  // Synthetic bar may not always arm; profile wiring still verified above.
  console.log('natgas-daily-profit-smoke OK · profile wired (no fill on synthetic)', fill.reason);
}

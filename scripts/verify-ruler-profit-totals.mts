/**
 * Smoke test for Ruler Nifty/Bank profit math (no Angular bootstrap).
 * Run: npx --yes tsx scripts/verify-ruler-profit-totals.mts
 */
import assert from 'node:assert/strict';
import {
  buildRulerProfitTotals,
  countWeekdaySessions,
  indexPointsMoneyRs,
} from '../src/app/core/paper-desk/paper-desk-points-money';
import type { PaperTrade } from '../src/app/core/paper-desk/paper-desk.models';

function trade(
  partial: Partial<PaperTrade> & Pick<PaperTrade, 'instrumentId' | 'indexPoints' | 'entryTime'>,
): PaperTrade {
  return {
    id: 't',
    instrumentName: 'x',
    direction: 'BUY',
    indexEntry: 0,
    indexStop: 0,
    indexTarget: 0,
    indexExit: 0,
    exitTime: partial.entryTime,
    exitReason: 'test',
    option: null,
    optionEntryPremium: null,
    optionExitPremium: null,
    optionPnlRs: null,
    premiumEstimated: false,
    outcome: partial.indexPoints >= 0 ? 'WIN' : 'LOSS',
    strategyId: 'ruler-flow',
    strategyName: 'Ruler flow',
    ...partial,
  };
}

assert.equal(indexPointsMoneyRs(10, 'nifty-50', 1), 650);
assert.equal(indexPointsMoneyRs(10, 'bank-nifty', 1), 300);
assert.equal(countWeekdaySessions('2026-06-01', '2026-06-30'), 22);

const trades = [
  trade({ instrumentId: 'nifty-50', indexPoints: 10, entryTime: '2026-06-02T10:00:00+05:30' }),
  trade({ instrumentId: 'bank-nifty', indexPoints: -5, entryTime: '2026-06-02T11:00:00+05:30' }),
  trade({ instrumentId: 'nifty-50', indexPoints: 20, entryTime: '2026-06-03T10:00:00+05:30' }),
];

const money = buildRulerProfitTotals(trades, 1, {
  rulerDayClip: true,
  fromDate: '2026-06-01',
  toDate: '2026-06-30',
});

// Day1 raw: 10*65 + (-5)*30 = 650 - 150 = 500
// Day2 raw: 20*65 = 1300
// Total raw 1800; sessionDays 22 → avg ≈ 81.8
assert.equal(money.pointsMoneyRs, 1800);
assert.equal(money.tradedDays, 2);
assert.equal(money.sessionDays, 22);
assert.equal(money.pointsMoneyResearchRs, 1800);
assert.ok((money.avgDailyResearchRs ?? 0) > 80 && (money.avgDailyResearchRs ?? 0) < 82);

// Cap: one day −6000 should clip to −500
const capped = buildRulerProfitTotals(
  [trade({ instrumentId: 'nifty-50', indexPoints: -100, entryTime: '2026-06-02T10:00:00+05:30' })],
  1,
  { rulerDayClip: true, fromDate: '2026-06-02', toDate: '2026-06-02' },
);
assert.equal(capped.pointsMoneyRs, -6500);
assert.equal(capped.pointsMoneyResearchRs, -500);

console.log('verify-ruler-profit-totals: OK', {
  pointsMoneyRs: money.pointsMoneyRs,
  avgDailyResearchRs: money.avgDailyResearchRs,
  cappedResearch: capped.pointsMoneyResearchRs,
});

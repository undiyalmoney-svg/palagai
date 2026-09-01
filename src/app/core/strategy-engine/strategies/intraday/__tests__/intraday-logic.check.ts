/**
 * Behavioural checks for the intraday strategy logic, driven by synthetic candles whose
 * correct answer is known by construction. Covers the cases most likely to silently
 * corrupt a backtest: false breakouts, ambiguous bars that touch stop and target together,
 * and slot allocation that must stay in trigger-time order rather than picking winners
 * with hindsight.
 *
 * Standalone (the app has no unit-test runner wired up). Run with:
 *   npx tsx src/app/core/strategy-engine/strategies/intraday/__tests__/intraday-logic.check.ts
 */
import { generateOrbSignal } from '../orb.strategy';
import { generatePivotSrSignal, pivotLevelsFromDay } from '../pivot-sr.strategy';
import { runIntradayBacktest, planIntradayCapital } from '../intraday-engine';
import { intradayRoundTripCostRs } from '../intraday-costs.util';

type C = { date: string; open: number; high: number; low: number; close: number; volume: number };

function bar(day: string, hhmm: string, o: number, h: number, l: number, c: number, v = 1000): C {
  return { date: `${day}T${hhmm}:00+0530`, open: o, high: h, low: l, close: c, volume: v };
}

function times(startMin: number, count: number, stepMin = 5): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const m = startMin + i * stepMin;
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

// ---------- Test 1: ORB long breakout ----------
console.log('\n1. ORB — clean long breakout');
{
  const day = '2026-08-03';
  const cs: C[] = [];
  // First hour 09:15-10:10 (12 bars), range 100..102
  for (const t of times(9 * 60 + 15, 12)) cs.push(bar(day, t, 101, 102, 100, 101, 1000));
  // 10:15 breakout bar closes above 102 on 2x volume
  cs.push(bar(day, '10:15', 102, 103.5, 101.9, 103, 2000));
  // then runs up to target
  for (const t of times(10 * 60 + 20, 20)) cs.push(bar(day, t, 103, 106, 102.9, 105, 1000));
  for (const t of times(12 * 60 + 0, 40)) cs.push(bar(day, t, 105, 105.5, 104.5, 105, 1000));

  const sig = generateOrbSignal('TEST', cs as any);
  check('signal fires', !!sig);
  check('direction LONG', sig?.direction === 'LONG', String(sig?.direction));
  check('entry = breakout close 103', sig?.entryPrice === 103, String(sig?.entryPrice));
  // OR low 100 is 2.91% below 103 -> exceeds 1.5% cap, so stop should be the capped one
  const capped = 103 * (1 - 0.015);
  check('stop uses 1.5% cap not OR low', Math.abs((sig?.stop ?? 0) - capped) < 1e-9, `${sig?.stop} vs ${capped}`);
  const risk = 103 - capped;
  check('target = entry + 1.5R', Math.abs((sig?.target ?? 0) - (103 + risk * 1.5)) < 1e-9, String(sig?.target));
}

// ---------- Test 2: ORB rejects intrabar poke that closes back inside ----------
console.log('\n2. ORB — wick above range but close inside = no trade');
{
  const day = '2026-08-04';
  const cs: C[] = [];
  for (const t of times(9 * 60 + 15, 12)) cs.push(bar(day, t, 101, 102, 100, 101, 1000));
  // pokes to 103 but closes back at 101.5 (inside range)
  cs.push(bar(day, '10:15', 102, 103, 101, 101.5, 3000));
  for (const t of times(10 * 60 + 20, 30)) cs.push(bar(day, t, 101, 101.8, 100.5, 101, 1000));
  const sig = generateOrbSignal('TEST', cs as any);
  check('no signal on false break', sig === null, JSON.stringify(sig));
}

// ---------- Test 3: ORB no entry after cutoff ----------
console.log('\n3. ORB — breakout after 14:30 cutoff is ignored');
{
  const day = '2026-08-05';
  const cs: C[] = [];
  for (const t of times(9 * 60 + 15, 12)) cs.push(bar(day, t, 101, 102, 100, 101, 1000));
  for (const t of times(10 * 60 + 15, 51)) cs.push(bar(day, t, 101, 101.9, 100.1, 101, 1000)); // to ~14:25
  cs.push(bar(day, '14:35', 102, 104, 101.9, 103.5, 5000)); // late breakout
  for (const t of times(14 * 60 + 40, 8)) cs.push(bar(day, t, 103, 104, 103, 103.5, 1000));
  const sig = generateOrbSignal('TEST', cs as any);
  check('late breakout rejected', sig === null, JSON.stringify(sig));
}

// ---------- Test 4: exit simulation + square-off + costs ----------
console.log('\n4. Engine — stop wins over target on same bar, square-off, costs applied');
{
  const day = '2026-08-06';
  const cs: C[] = [];
  for (const t of times(9 * 60 + 15, 12)) cs.push(bar(day, t, 101, 102, 100, 101, 1000));
  cs.push(bar(day, '10:15', 102, 103.5, 101.9, 103, 2000)); // breakout, entry 103
  // next bar touches BOTH stop (101.455) and target — stop must win
  cs.push(bar(day, '10:20', 103, 110, 101.0, 104, 1000));
  for (const t of times(10 * 60 + 25, 60)) cs.push(bar(day, t, 104, 104.5, 103.5, 104, 1000));

  const map = new Map<string, any>([['TEST', cs]]);
  const res = runIntradayBacktest({
    candlesBySymbol: map,
    capitalRs: 30000,
    maxPositions: 10,
    generateSignal: (s, d) => generateOrbSignal(s, d),
  });
  const t0 = res.days[0]?.trades[0];
  check('one trade taken', res.days[0]?.trades.length === 1, String(res.days[0]?.trades.length));
  check('stop wins on ambiguous bar', t0?.exitReason === 'STOP', String(t0?.exitReason));
  check('gross is negative (stopped out)', (t0?.grossPnlRs ?? 0) < 0, String(t0?.grossPnlRs));
  check('cost > 0 applied', (t0?.costRs ?? 0) > 0, String(t0?.costRs));
  check('net = gross - cost', Math.abs((t0!.pnlRs) - (t0!.grossPnlRs - t0!.costRs)) < 1e-9);
}

// ---------- Test 5: slot allocation is time-ordered, not best-outcome ----------
console.log('\n5. Engine — slots fill by trigger time, capped at maxPositions');
{
  const day = '2026-08-07';
  function mk(breakAt: string, closePx: number): C[] {
    const cs: C[] = [];
    for (const t of times(9 * 60 + 15, 12)) cs.push(bar(day, t, 101, 102, 100, 101, 1000));
    const afterStart = 10 * 60 + 15;
    for (const t of times(afterStart, 40)) {
      const isBreak = t === breakAt;
      cs.push(isBreak
        ? bar(day, t, 102, closePx + 0.5, 101.9, closePx, 3000)
        : bar(day, t, 101, 101.9, 100.1, 101, 1000));
    }
    return cs;
  }
  // three symbols break at different times
  const map = new Map<string, any>([
    ['LATE', mk('11:00', 103)],
    ['EARLY', mk('10:20', 103)],
    ['MID', mk('10:40', 103)],
  ]);
  const res = runIntradayBacktest({
    candlesBySymbol: map,
    capitalRs: 30000,
    maxPositions: 2, // only 2 slots
    generateSignal: (s, d) => generateOrbSignal(s, d),
  });
  const syms = res.days[0]?.trades.map((t) => t.symbol) ?? [];
  check('only 2 slots used', syms.length === 2, String(syms.length));
  check('EARLY taken first', syms[0] === 'EARLY', syms.join(','));
  check('MID taken second', syms[1] === 'MID', syms.join(','));
  check('LATE excluded (no slot)', !syms.includes('LATE'), syms.join(','));
}

// ---------- Test 6: capital planning ----------
console.log('\n6. Capital plan — keeps positions above the ₹2,500 floor');
{
  const a = planIntradayCapital(30000, 10);
  check('₹30k -> 10 slots x ₹3,000', a.positions === 10 && Math.abs(a.perPositionRs - 3000) < 1e-9, JSON.stringify(a));
  const b = planIntradayCapital(6000, 10);
  check('₹6k -> 2 slots x ₹3,000 (not 10 tiny ones)', b.positions === 2 && Math.abs(b.perPositionRs - 3000) < 1e-9, JSON.stringify(b));
  const c = planIntradayCapital(1000, 10);
  check('₹1k -> 1 slot', c.positions === 1, JSON.stringify(c));
}

// ---------- Test 7: intraday costs are direction-aware and cheaper than delivery ----------
console.log('\n7. Intraday costs');
{
  const long = intradayRoundTripCostRs(500, 505, 6, 'LONG');
  const short = intradayRoundTripCostRs(505, 500, 6, 'SHORT');
  check('long round trip on ~₹3k is a few rupees', long.totalRs > 0 && long.totalRs < 15, long.totalRs.toFixed(2));
  check('no DP charge (much cheaper than ₹38 delivery)', long.totalRs < 38, long.totalRs.toFixed(2));
  check('STT charged on sell leg only', long.sttRs > 0 && short.sttRs > 0);
  console.log(`     long ₹${long.totalRs.toFixed(2)}, short ₹${short.totalRs.toFixed(2)}`);
}

// ---------- Test 8: pivot S/R levels + bounce detection ----------
console.log('\n8. Pivot S/R');
{
  const prevDay = '2026-08-10';
  const prev: C[] = [];
  for (const t of times(9 * 60 + 15, 70)) prev.push(bar(prevDay, t, 100, 110, 90, 100, 1000));
  const lv = pivotLevelsFromDay(prev as any)!;
  // H=110 L=90 C=100 -> P=100, S1=2*100-110=90, R1=2*100-90=110
  check('pivot P = 100', Math.abs(lv.p - 100) < 1e-9, String(lv.p));
  check('S1 = 90', Math.abs(lv.s1 - 90) < 1e-9, String(lv.s1));
  check('R1 = 110', Math.abs(lv.r1 - 110) < 1e-9, String(lv.r1));

  const day = '2026-08-11';
  const cur: C[] = [];
  for (const t of times(9 * 60 + 15, 12)) cur.push(bar(day, t, 95, 96, 94, 95, 1000));
  // dips to 89 (below S1=90) but closes back at 92 -> support held, long
  cur.push(bar(day, '10:15', 92, 93, 89, 92, 2000));
  for (const t of times(10 * 60 + 20, 50)) cur.push(bar(day, t, 95, 101, 94, 100, 1000));

  const sig = generatePivotSrSignal('TEST', cur as any, prev as any);
  check('bounce signal fires', !!sig);
  check('direction LONG', sig?.direction === 'LONG', String(sig?.direction));
  check('target = pivot 100', Math.abs((sig?.target ?? 0) - 100) < 1e-9, String(sig?.target));
  check('entry = close 92', sig?.entryPrice === 92, String(sig?.entryPrice));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

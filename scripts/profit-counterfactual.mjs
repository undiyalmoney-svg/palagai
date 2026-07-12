/**
 * Fast counterfactual profit analysis on captured trades.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const reportPath = join(root, 'reports/trade-characteristics-analysis.json');

function main() {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const trades = report.trades.filter((t) => t.strategyId === 'first-hour-breakout');

  const filters = [
    { name: 'No filter (baseline)', test: () => true },
    { name: 'Breakout dist ≤ 12 pts', test: (t) => (t.breakoutDistancePts ?? 999) <= 12 },
    { name: 'Breakout dist ≤ 15 pts', test: (t) => (t.breakoutDistancePts ?? 999) <= 15 },
    { name: 'Breakout dist ≤ 18 pts', test: (t) => (t.breakoutDistancePts ?? 999) <= 18 },
    { name: 'Breakout dist ≤ 20 pts', test: (t) => (t.breakoutDistancePts ?? 999) <= 20 },
    { name: 'Breakout dist ≤ 25 pts', test: (t) => (t.breakoutDistancePts ?? 999) <= 25 },
    { name: 'Breakout wick ≤ 5%', test: (t) => (t.breakoutCandle?.oppositeWickPct ?? 999) <= 5 },
    { name: 'Breakout wick ≤ 8%', test: (t) => (t.breakoutCandle?.oppositeWickPct ?? 999) <= 8 },
    { name: 'Breakout wick ≤ 12%', test: (t) => (t.breakoutCandle?.oppositeWickPct ?? 999) <= 12 },
    { name: 'Breakout wick ≤ 15%', test: (t) => (t.breakoutCandle?.oppositeWickPct ?? 999) <= 15 },
    { name: 'Breakout body ≥ 85%', test: (t) => (t.breakoutCandle?.bodyPct ?? 0) >= 85 },
    { name: 'Breakout body ≥ 90%', test: (t) => (t.breakoutCandle?.bodyPct ?? 0) >= 90 },
    { name: 'Entry before 11:00', test: (t) => t.entryTimeHhMm <= '11:00' },
    { name: 'Entry before 11:30', test: (t) => t.entryTimeHhMm <= '11:30' },
    { name: 'SELL only', test: (t) => t.direction === 'SELL' },
    { name: 'BUY only', test: (t) => t.direction === 'BUY' },
    {
      name: 'dist≤20 + wick≤12',
      test: (t) => (t.breakoutDistancePts ?? 999) <= 20 && (t.breakoutCandle?.oppositeWickPct ?? 999) <= 12,
    },
    {
      name: 'dist≤18 + wick≤10',
      test: (t) => (t.breakoutDistancePts ?? 999) <= 18 && (t.breakoutCandle?.oppositeWickPct ?? 999) <= 10,
    },
    {
      name: 'dist≤15 + wick≤12',
      test: (t) => (t.breakoutDistancePts ?? 999) <= 15 && (t.breakoutCandle?.oppositeWickPct ?? 999) <= 12,
    },
    {
      name: 'dist≤20 + wick≤12 + ≤11:30',
      test: (t) =>
        (t.breakoutDistancePts ?? 999) <= 20 &&
        (t.breakoutCandle?.oppositeWickPct ?? 999) <= 12 &&
        t.entryTimeHhMm <= '11:30',
    },
    {
      name: 'dist≤20 + wick≤12 SELL',
      test: (t) =>
        t.direction === 'SELL' &&
        (t.breakoutDistancePts ?? 999) <= 20 &&
        (t.breakoutCandle?.oppositeWickPct ?? 999) <= 12,
    },
    {
      name: 'dist≤25 + wick≤15 + body≥85',
      test: (t) =>
        (t.breakoutDistancePts ?? 999) <= 25 &&
        (t.breakoutCandle?.oppositeWickPct ?? 999) <= 15 &&
        (t.breakoutCandle?.bodyPct ?? 0) >= 85,
    },
  ];

  const results = filters.map((f) => {
    const kept = trades.filter(f.test);
    const net = kept.reduce((s, t) => s + t.points, 0);
    const wins = kept.filter((t) => t.outcome === 'WIN').length;
    const losses = kept.filter((t) => t.outcome === 'LOSS').length;
    const days = new Map();
    for (const t of kept) {
      const d = t.entryTime.includes('T') ? t.entryTime.split('T')[0] : t.entryTime.slice(0, 10);
      days.set(d, (days.get(d) ?? 0) + t.points);
    }
    const profDays = [...days.values()].filter((p) => p > 0).length;
    const lossDays = [...days.values()].filter((p) => p < 0).length;
    return {
      name: f.name,
      trades: kept.length,
      wins,
      losses,
      netPoints: net,
      winRate: kept.length ? (wins / kept.length) * 100 : 0,
      tradeDays: days.size,
      profitableDays: profDays,
      losingDays: lossDays,
      keptTrades: kept.map((t) => ({
        date: t.entryTime.slice(0, 10),
        time: t.entryTimeHhMm,
        dir: t.direction,
        pts: t.points,
        dist: t.breakoutDistancePts,
        wick: t.breakoutCandle?.oppositeWickPct,
      })),
    };
  });

  results.sort((a, b) => b.netPoints - a.netPoints);

  console.log('\n=== COUNTERFACTUAL FILTER ANALYSIS (33 real FH trades) ===\n');
  console.log(
    pad('Filter', 36) + pad('Net pts', 10) + pad('Trades', 8) + pad('Win%', 8) + pad('ProfDays', 10) + pad('LossDays', 10),
  );
  console.log('-'.repeat(82));

  for (const r of results) {
    console.log(
      pad(r.name, 36) +
        pad(r.netPoints.toFixed(1), 10) +
        pad(String(r.trades), 8) +
        pad(r.winRate.toFixed(0) + '%', 8) +
        pad(`${r.profitableDays}/${r.tradeDays}`, 10) +
        pad(String(r.losingDays), 10),
    );
  }

  const best = results[0];
  const profitableOnly = results.filter((r) => r.losingDays === 0 && r.trades > 0);

  console.log('\n── Best filter by net profit ──');
  console.log(JSON.stringify(best, null, 2));

  console.log('\n── Filters with ZERO losing days ──');
  if (!profitableOnly.length) {
    console.log('None — no filter makes every traded day profitable on historical data.');
  } else {
    for (const r of profitableOnly) {
      console.log(`  ${r.name}: +${r.netPoints.toFixed(1)} pts, ${r.trades} trades`);
    }
  }

  const oracle = trades.filter((t) => t.outcome === 'WIN');
  console.log('\n── Oracle (only known winners — not achievable live) ──');
  console.log(`  Net: +${oracle.reduce((s, t) => s + t.points, 0).toFixed(1)} pts from ${oracle.length} trades`);

  writeFileSync(join(root, 'reports', 'profit-counterfactual.json'), JSON.stringify({ results, best, profitableOnly }, null, 2));
  console.log('\nSaved: reports/profit-counterfactual.json');
}

function pad(s, w) {
  return s.length >= w ? s.slice(0, w) : s.padEnd(w);
}

main();

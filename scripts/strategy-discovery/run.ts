/**
 * Strategy Discovery Engine — Nifty / Bank Nifty
 *
 * Generates hundreds–thousands of modular rule combinations, backtests on
 * live Kite 5m OHLC, ranks by PF / net / DD / consistency / multi-year stability,
 * and stores results in SQLite.
 *
 * Does NOT modify existing First Hour / Reversal strategies.
 *
 * Usage:
 *   KITE_AUTH='token api_key:access_token' npm run discover:strategies
 *   INSTRUMENT=nifty,banknifty LIMIT=3000 FROM=2024-01-01 TO=2026-07-11 npm run discover:strategies
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backtestStrategy } from './backtester.ts';
import { fullSearchSpaceSize, generateStrategies } from './combinator.ts';
import { buildFeatures } from './features.ts';
import { fetchHistorical5m, INSTRUMENTS, InstrumentKey } from './fetch-data.ts';
import {
  buildEquityCurve,
  computeMetrics,
  passesHardFilters,
  rankScore,
} from './metrics.ts';
import { StrategyStore } from './store.ts';
import type { StrategyResult } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

const FROM = process.env.FROM ?? '2024-01-01 09:15:00';
const TO = process.env.TO ?? '2026-07-11 15:30:00';
const LIMIT = Number(process.env.LIMIT ?? '3500');
const MODE = (process.env.MODE ?? 'grid') as 'grid' | 'sample' | 'full';
const instruments = (process.env.INSTRUMENT ?? 'nifty,banknifty')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s): s is InstrumentKey => s === 'nifty' || s === 'banknifty');

const authRaw = process.env.KITE_AUTH;
if (!authRaw) {
  console.error('Set KITE_AUTH=token api_key:access_token');
  process.exit(1);
}
const authorization = authRaw.startsWith('token ') ? authRaw : `token ${authRaw}`;

async function runInstrument(key: InstrumentKey): Promise<{
  key: InstrumentKey;
  tested: number;
  passed: number;
  top: StrategyResult[];
}> {
  const meta = INSTRUMENTS[key];
  console.log(`\n======== ${meta.name} (${meta.token}) ========`);
  console.log(`Fetch ${FROM.slice(0, 10)} → ${TO.slice(0, 10)}`);

  const candles = await fetchHistorical5m({
    token: meta.token,
    from: FROM,
    to: TO,
    authorization,
  });
  if (candles.length < 500) {
    throw new Error(`Insufficient candles for ${key}: ${candles.length}`);
  }

  console.log(`Building features for ${candles.length} bars…`);
  const features = buildFeatures(candles);

  const strategies = generateStrategies({ mode: MODE === 'full' ? 'sample' : MODE, limit: LIMIT });
  console.log(
    `Testing ${strategies.length} strategies (full space = ${fullSearchSpaceSize().toLocaleString()})…`,
  );

  const results: StrategyResult[] = [];
  const t0 = Date.now();

  for (let i = 0; i < strategies.length; i += 1) {
    const dna = strategies[i]!;
    const trades = backtestStrategy(features, dna);
    const metrics = computeMetrics(trades);
    const passed = passesHardFilters(metrics);
    const score = rankScore(metrics);
    results.push({
      dna,
      metrics,
      trades,
      equityCurve: buildEquityCurve(trades),
      passedFilters: passed,
      rankScore: score,
    });

    if ((i + 1) % 250 === 0 || i === strategies.length - 1) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(
        `\r  ${i + 1}/${strategies.length} tested (${elapsed}s) | passed ${results.filter((r) => r.passedFilters).length}`,
      );
    }
  }
  console.log('');

  results.sort((a, b) => b.rankScore - a.rankScore);
  const passed = results.filter((r) => r.passedFilters);
  const top = (passed.length ? passed : results).slice(0, 100);

  const dbPath = join(root, 'reports/strategy-discovery.sqlite');
  const store = new StrategyStore(dbPath);
  store.clearInstrument(key);
  for (const r of results) {
    if (r.metrics.totalTrades >= 20) {
      store.saveResult(key, r);
    }
  }
  store.close();

  const report = {
    generatedAt: new Date().toISOString(),
    instrument: key,
    name: meta.name,
    range: { from: FROM, to: TO },
    candles: candles.length,
    searchSpace: fullSearchSpaceSize(),
    tested: strategies.length,
    passedFilters: passed.length,
    top100: top.map((r, idx) => ({
      rank: idx + 1,
      id: r.dna.id,
      params: r.dna,
      netProfitPts: Number(r.metrics.netProfit.toFixed(2)),
      netProfitRupeesApprox: Number((r.metrics.netProfit * 65).toFixed(0)),
      cagr: Number(r.metrics.cagr.toFixed(2)),
      winRate: Number(r.metrics.winRate.toFixed(2)),
      profitFactor: Number(r.metrics.profitFactor.toFixed(2)),
      sharpe: Number(r.metrics.sharpe.toFixed(2)),
      maxDrawdownPct: Number(r.metrics.maxDrawdownPct.toFixed(2)),
      avgR: Number(r.metrics.avgR.toFixed(2)),
      totalTrades: r.metrics.totalTrades,
      consecutiveWins: r.metrics.consecutiveWins,
      consecutiveLosses: r.metrics.consecutiveLosses,
      consistencyScore: Number(r.metrics.consistencyScore.toFixed(1)),
      stabilityScore: Number(r.metrics.stabilityScore.toFixed(1)),
      monthlyReturns: r.metrics.monthlyReturns,
      yearlyReturns: r.metrics.yearlyReturns,
    })),
    best: top[0]
      ? {
          id: top[0].dna.id,
          params: top[0].dna,
          metrics: top[0].metrics,
          monthlyReturns: top[0].metrics.monthlyReturns,
          yearlyReturns: top[0].metrics.yearlyReturns,
          sampleTrades: top[0].trades.slice(0, 50),
        }
      : null,
  };

  mkdirSync(join(root, 'reports'), { recursive: true });
  const outPath = join(root, `reports/${key}-strategy-discovery.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Saved ${outPath}`);
  console.log(`SQLite: ${dbPath}`);

  if (top[0]) {
    console.log(`\nBEST ${meta.name}: ${top[0].dna.id}`);
    console.log(
      `Net ${top[0].metrics.netProfit.toFixed(1)} pts | PF ${top[0].metrics.profitFactor.toFixed(2)} | WR ${top[0].metrics.winRate.toFixed(1)}% | DD ${top[0].metrics.maxDrawdownPct.toFixed(1)}% | Trades ${top[0].metrics.totalTrades}`,
    );
    console.log('Monthly points:');
    for (const [m, pts] of Object.entries(top[0].metrics.monthlyReturns).sort()) {
      console.log(`  ${m}: ${pts > 0 ? '+' : ''}${pts.toFixed(1)}`);
    }
  }

  return { key, tested: strategies.length, passed: passed.length, top };
}

async function main(): Promise<void> {
  console.log('Strategy Discovery Engine');
  console.log(`Instruments: ${instruments.join(', ')}`);
  console.log(`Mode=${MODE} Limit=${LIMIT} Space=${fullSearchSpaceSize().toLocaleString()}`);

  const summaries = [];
  for (const key of instruments) {
    summaries.push(await runInstrument(key));
  }

  const summaryPath = join(root, 'reports/strategy-discovery-summary.json');
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        range: { from: FROM, to: TO },
        instruments: summaries.map((s) => ({
          instrument: s.key,
          tested: s.tested,
          passedFilters: s.passed,
          bestId: s.top[0]?.dna.id ?? null,
          bestNetPts: s.top[0]?.metrics.netProfit ?? null,
          bestMonthly: s.top[0]?.metrics.monthlyReturns ?? null,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nSummary: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Month-by-month Kite fetch + strategy ranking (research only — does not touch app strategies).
 *
 * Usage:
 *   KITE_AUTH='token key:secret' npm run analyze:monthly-strategies
 *   INSTRUMENT=nifty FROM=2020-01-01 TO=2025-07-01 npm run analyze:monthly-strategies
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aggregateStrategy,
  buildPatternGrid,
  CRUDE_SESSION,
  Candle,
  extractDate,
  groupByDate,
  NIFTY_SESSION,
  parseTs,
  rankStrategies,
  runPatternOnDates,
  StrategyAggregate,
  StrategyMonthScore,
} from './lib/pattern-simulation.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const INSTRUMENT = (process.env.INSTRUMENT ?? 'nifty').toLowerCase();
const FROM = process.env.FROM ?? '2020-01-01';
const TO = process.env.TO ?? '2025-07-01';
const NIFTY_TOKEN = Number(process.env.INSTRUMENT_TOKEN ?? '256265');
const LOOKBACK_DAYS = 12;
const FETCH_DELAY_MS = 2200;
const RUPEES_PER_POINT = INSTRUMENT === 'nifty' ? 65 : 100;

const auth = process.env.KITE_AUTH;
if (!auth) {
  console.error('Set KITE_AUTH=token api_key:access_token');
  process.exit(1);
}

const authorization = auth.startsWith('token ') ? auth : `token ${auth}`;
const session = INSTRUMENT === 'nifty' ? NIFTY_SESSION : CRUDE_SESSION;
const marketStart = INSTRUMENT === 'nifty' ? '09:15:00' : '09:00:00';
const marketEnd = INSTRUMENT === 'nifty' ? '15:30:00' : '23:15:00';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  d.setDate(d.getDate() + days);
  return formatDt(d);
}

interface MonthWindow {
  month: string;
  fetchFrom: string;
  fetchTo: string;
  tradingDates: string[];
}

function listMonths(from: string, to: string): MonthWindow[] {
  const start = new Date(`${from.slice(0, 10)}T00:00:00+05:30`);
  const end = new Date(`${to.slice(0, 10)}T00:00:00+05:30`);
  const months: MonthWindow[] = [];

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const month = `${y}-${pad(m + 1)}`;
    const monthStart = `${month}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const monthEnd = `${month}-${pad(lastDay)}`;
    const fetchFrom = addDays(monthStart, -LOOKBACK_DAYS).slice(0, 10);
    const fetchTo = monthEnd;

    months.push({
      month,
      fetchFrom: `${fetchFrom} ${marketStart}`,
      fetchTo: `${fetchTo} ${marketEnd}`,
      tradingDates: [],
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'X-Kite-Version': '3', Authorization: authorization } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchCandles(token: number, from: string, to: string): Promise<Candle[]> {
  const params = new URLSearchParams({ from, to });
  const url = `https://api.kite.trade/instruments/historical/${token}/${interval}?${params}`;
  const res = await fetch(url, { headers: { 'X-Kite-Version': '3', Authorization: authorization } });
  const body = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { candles?: (string | number)[][] };
  };
  if (body.status !== 'success' || !body.data?.candles?.length) {
    throw new Error(body.message ?? `No candles ${from.slice(0, 10)}→${to.slice(0, 10)}`);
  }
  return body.data.candles.map((row) => ({
    date: String(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

const interval = '5minute';

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

async function resolveCrudeToken(monthEnd: string): Promise<number | null> {
  const csv = await fetchText('https://api.kite.trade/instruments');
  const endTs = parseTs(`${monthEnd.slice(0, 10)} 23:59:59`);
  let best: { token: number; expiryTs: number } | null = null;

  for (const line of csv.split('\n').slice(1)) {
    if (!line.includes('CRUDEOIL') || line.includes('CRUDEOILM')) continue;
    const cols = splitCsvLine(line);
    if (cols[11]?.trim() !== 'MCX' || cols[9]?.trim() !== 'FUT') continue;
    const token = Number(cols[0]);
    const expiry = cols[5]?.trim();
    if (!token || !expiry) continue;
    const expiryTs = parseTs(`${expiry} 23:59:59`);
    const startTs = expiryTs - 90 * 86400000;
    if (endTs < startTs || endTs > expiryTs) continue;
    if (!best || expiryTs < best.expiryTs) {
      best = { token, expiryTs };
    }
  }

  return best?.token ?? null;
}

async function main(): Promise<void> {
  const months = listMonths(FROM, TO);
  const patterns = buildPatternGrid(session);
  const patternMonthly = new Map<string, StrategyMonthScore[]>(
    patterns.map((p) => [p.name, [] as StrategyMonthScore[]]),
  );

  const candleStore: Candle[] = [];
  const seen = new Set<string>();
  const fetchLog: { month: string; bars: number; status: string }[] = [];

  console.log(`${INSTRUMENT.toUpperCase()} month-by-month fetch: ${months.length} months, ${patterns.length} patterns`);
  console.log(`Range: ${FROM} → ${TO}\n`);

  for (const window of months) {
    process.stdout.write(`${window.month}… `);
    try {
      const token =
        INSTRUMENT === 'nifty' ? NIFTY_TOKEN : await resolveCrudeToken(window.fetchTo);
      if (!token) {
        fetchLog.push({ month: window.month, bars: 0, status: 'no crude contract' });
        console.log('skip (no contract)');
        continue;
      }

      const batch = await fetchCandles(token, window.fetchFrom, window.fetchTo);
      for (const c of batch) {
        if (!seen.has(c.date)) {
          seen.add(c.date);
          candleStore.push(c);
        }
      }
      candleStore.sort((a, b) => parseTs(a.date) - parseTs(b.date));

      const byDate = groupByDate(candleStore);
      const datesInMonth = [...byDate.keys()]
        .filter((d) => d.startsWith(window.month))
        .sort();

      window.tradingDates = datesInMonth;

      for (const cfg of patterns) {
        const trades = runPatternOnDates(cfg, byDate, datesInMonth, session);
        const netPts = trades.reduce((s, t) => s + t.points, 0);
        const entry = patternMonthly.get(cfg.name)!;
        entry.push({
          month: window.month,
          trades: trades.length,
          wins: trades.filter((t) => t.outcome === 'WIN').length,
          netPts,
          tradeList: trades,
        });
      }

      fetchLog.push({ month: window.month, bars: batch.length, status: 'ok' });
      console.log(`${batch.length} bars, ${datesInMonth.length} days`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fetchLog.push({ month: window.month, bars: 0, status: msg });
      console.log(`error: ${msg}`);
    }

    await sleep(FETCH_DELAY_MS);
  }

  const ranked: StrategyAggregate[] = rankStrategies(
    patterns.map((cfg) => aggregateStrategy(cfg.name, cfg, patternMonthly.get(cfg.name) ?? [])),
  );

  const best = ranked[0]!;
  const report = {
    generatedAt: new Date().toISOString(),
    instrument: INSTRUMENT,
    range: { from: FROM, to: TO },
    method: 'Month-by-month Kite 5m fetch with 12-day lookback per month',
    monthsAttempted: months.length,
    patternsTested: patterns.length,
    rupeesPerPoint: RUPEES_PER_POINT,
    fetchLog,
    conclusion: {
      bestStrategy: best.name,
      netPts: best.netPts,
      netRupees: best.netPts * RUPEES_PER_POINT,
      monthWinRate: best.monthWinRate,
      monthsProfitable: best.monthsProfitable,
      monthsLosing: best.monthsLosing,
      monthsTotal: best.monthsTotal,
      avgMonthlyPts: best.avgMonthlyPts,
      avgMonthlyRupees: best.avgMonthlyPts * RUPEES_PER_POINT,
      avgWinPts: best.avgWinPts,
      avgLossPts: best.avgLossPts,
      config: best.config,
      profitableEveryMonth: best.monthsLosing === 0 && best.monthsProfitable === best.monthsTotal,
    },
    top5: ranked.slice(0, 5).map((r) => ({
      name: r.name,
      netPts: r.netPts,
      netRupees: r.netPts * RUPEES_PER_POINT,
      monthWinRate: r.monthWinRate,
      monthsProfitable: r.monthsProfitable,
      monthsLosing: r.monthsLosing,
      monthsTotal: r.monthsTotal,
      avgMonthlyPts: r.avgMonthlyPts,
      totalTrades: r.totalTrades,
    })),
    bestStrategyMonthly: best.monthly.map((m) => ({
      month: m.month,
      trades: m.trades,
      wins: m.wins,
      netPts: m.netPts,
      netRupees: m.netPts * RUPEES_PER_POINT,
    })),
  };

  mkdirSync(join(root, 'reports'), { recursive: true });
  const reportPath = join(root, `reports/${INSTRUMENT}-month-by-month-strategy-finder.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n=== BEST STRATEGY (month-by-month analysis) ===');
  console.log(best.name);
  console.log(`Net: ${best.netPts.toFixed(1)} pts (₹${(best.netPts * RUPEES_PER_POINT).toFixed(0)})`);
  console.log(`Months green: ${best.monthsProfitable}/${best.monthsTotal} (${best.monthWinRate.toFixed(1)}%)`);
  console.log(`Avg/month: ${best.avgMonthlyPts.toFixed(1)} pts`);
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

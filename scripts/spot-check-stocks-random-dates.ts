/**
 * Spot-check treasure equity book on random dates 2020–2026.
 * Local only — does not push.
 *
 *   KITE_AUTH='token apiKey:access' npx tsx scripts/spot-check-stocks-random-dates.ts
 *   or: .kite-auth file
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const TOKENS = join(root, 'reports/analyst-cache/nifty50-eq-tokens.json');
const CACHE_DIR = join(root, 'reports/analyst-cache/stocks-day-2020');
const OUT = join(root, 'reports/stocks-random-date-spotcheck.json');

const FROM = '2020-01-01';
const TO = '2026-07-20';
const DELAY_MS = 3000;
const CAPITAL = 60_000;
const RISK_RS = CAPITAL * 0.02;
const SAMPLE_N = 18;
const SEED = 42;

const TREASURE: Array<{ symbol: string; strategyId: string }> = [
  { symbol: 'BRITANNIA', strategyId: 'GAP_UP_FADE' },
  { symbol: 'TATACONSUM', strategyId: 'GAP_DOWN_BOUNCE' },
  { symbol: 'NTPC', strategyId: 'GAP_UP_FADE' },
  { symbol: 'HDFCLIFE', strategyId: 'GAP_DOWN_BOUNCE' },
  { symbol: 'SUNPHARMA', strategyId: 'GAP_DOWN_BOUNCE' },
  { symbol: 'CIPLA', strategyId: 'GAP_UP_FADE' },
  { symbol: 'NESTLEIND', strategyId: 'GAP_DOWN_BOUNCE' },
  { symbol: 'APOLLOHOSP', strategyId: 'GAP_DOWN_BOUNCE' },
];

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Dir = 'BUY' | 'SELL';
type Trade = {
  symbol: string;
  strategyId: string;
  date: string;
  dir: Dir;
  entry: number;
  exit: number;
  qty: number;
  pnlRs: number;
  reason: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveAuth(): string {
  if (process.env.KITE_AUTH?.trim()) {
    const a = process.env.KITE_AUTH.trim();
    return a.startsWith('token ') ? a : `token ${a}`;
  }
  const f = join(root, '.kite-auth');
  if (existsSync(f)) {
    const a = readFileSync(f, 'utf8').trim();
    return a.startsWith('token ') ? a : `token ${a}`;
  }
  throw new Error('Need KITE_AUTH or .kite-auth');
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function qtyForRisk(entry: number, stop: number): number {
  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare < 0.05) return 0;
  const q = Math.floor(RISK_RS / riskPerShare);
  const maxQty = Math.floor((CAPITAL * 1.5) / entry);
  return Math.max(0, Math.min(q, maxQty));
}

/** Deterministic PRNG */
function mulberry32(a: number) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchDay(authorization: string, token: number, from: string, to: string): Promise<Candle[]> {
  const params = new URLSearchParams({ from: `${from} 09:00:00`, to: `${to} 15:30:00` });
  const url = `https://api.kite.trade/instruments/historical/${token}/day?${params}`;
  const res = await fetch(url, { headers: { 'X-Kite-Version': '3', Authorization: authorization } });
  const body = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { candles?: (string | number)[][] };
  };
  if (body.status !== 'success' || !body.data?.candles?.length) {
    throw new Error(body.message ?? `no day candles ${token}`);
  }
  return body.data.candles.map((row) => ({
    date: String(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5] ?? 0),
  }));
}

/** Kite day interval max ~2000 calendar days — chunk under that. */
async function fetchDayRange(
  authorization: string,
  token: number,
  from: string,
  to: string,
): Promise<Candle[]> {
  const chunks: Array<{ from: string; to: string }> = [
    { from: '2020-01-01', to: '2024-12-31' },
    { from: '2025-01-01', to: '2026-07-20' },
  ].filter((c) => c.to >= from && c.from <= to);

  const out: Candle[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    const a = c.from < from ? from : c.from;
    const b = c.to > to ? to : c.to;
    const part = await fetchDay(authorization, token, a, b);
    for (const row of part) {
      const k = dayKey(row.date);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
    await sleep(DELAY_MS);
  }
  out.sort((x, y) => dayKey(x.date).localeCompare(dayKey(y.date)));
  return out;
}

function tradeOnDay(
  symbol: string,
  strategyId: string,
  days: Candle[],
  i: number,
): Trade | null {
  const d = days[i]!;
  const prev = i > 0 ? days[i - 1]! : null;
  const date = dayKey(d.date);
  let dir: Dir | null = null;
  let stop = 0;
  let reason = strategyId.toLowerCase();

  if (strategyId === 'GAP_UP_FADE') {
    if (!prev || d.open <= prev.close * 1.005) return null;
    dir = 'SELL';
    stop = d.open * 1.012;
    reason = 'gap_up_fade';
  } else if (strategyId === 'GAP_DOWN_BOUNCE') {
    if (!prev || d.open >= prev.close * 0.995) return null;
    dir = 'BUY';
    stop = d.open * 0.988;
    reason = 'gap_down_bounce';
  } else {
    return null;
  }

  const qty = qtyForRisk(d.open, stop);
  if (qty < 1) return null;

  let exit = d.close;
  let pts = dir === 'BUY' ? exit - d.open : d.open - exit;
  if (dir === 'BUY' && d.low <= stop) {
    exit = stop;
    pts = exit - d.open;
  } else if (dir === 'SELL' && d.high >= stop) {
    exit = stop;
    pts = d.open - exit;
  }

  return {
    symbol,
    strategyId,
    date,
    dir,
    entry: d.open,
    exit,
    qty,
    pnlRs: Math.round(pts * qty),
    reason,
  };
}

async function main() {
  const authorization = resolveAuth();
  const tokenMap = JSON.parse(readFileSync(TOKENS, 'utf8')) as Record<
    string,
    { token: number; name: string }
  >;
  mkdirSync(CACHE_DIR, { recursive: true });

  const series = new Map<string, Candle[]>();
  for (const { symbol } of TREASURE) {
    const info = tokenMap[symbol];
    if (!info) throw new Error(`missing token ${symbol}`);
    const cachePath = join(CACHE_DIR, `${symbol}_${FROM}_${TO}.json`);
    if (existsSync(cachePath)) {
      series.set(symbol, JSON.parse(readFileSync(cachePath, 'utf8')) as Candle[]);
      console.log(`cache hit ${symbol} · ${series.get(symbol)!.length} days`);
      continue;
    }
    console.log(`fetch day ${symbol} token=${info.token} …`);
    const candles = await fetchDayRange(authorization, info.token, FROM, TO);
    writeFileSync(cachePath, JSON.stringify(candles));
    series.set(symbol, candles);
    console.log(`  ${symbol} · ${candles.length} days`);
    // delay already inside fetchDayRange chunks; small pause between symbols
    await sleep(500);
  }

  // Universe of session dates present in ≥1 series
  const allDates = new Set<string>();
  for (const days of series.values()) {
    for (const c of days) allDates.add(dayKey(c.date));
  }
  const dates = [...allDates].sort();
  const rand = mulberry32(SEED);
  const picks: string[] = [];
  // Spread picks across years: ~3 per year band
  const bands = [
    ['2020-01-01', '2020-12-31'],
    ['2021-01-01', '2021-12-31'],
    ['2022-01-01', '2022-12-31'],
    ['2023-01-01', '2023-12-31'],
    ['2024-01-01', '2024-12-31'],
    ['2025-01-01', '2026-07-20'],
  ] as const;
  for (const [a, b] of bands) {
    const pool = dates.filter((d) => d >= a && d <= b);
    const n = Math.min(3, pool.length);
    for (let k = 0; k < n; k += 1) {
      const idx = Math.floor(rand() * pool.length);
      const d = pool[idx]!;
      if (!picks.includes(d)) picks.push(d);
    }
  }
  while (picks.length < SAMPLE_N && dates.length) {
    const d = dates[Math.floor(rand() * dates.length)]!;
    if (!picks.includes(d)) picks.push(d);
  }
  picks.sort();

  console.log('\n========== TREASURE BOOK · RANDOM DATE SPOT-CHECK ==========');
  console.log(`Capital ₹${CAPITAL} · risk/trade ₹${RISK_RS} · sample ${picks.length} dates · ${FROM}→${TO}`);
  console.log('Symbols: ' + TREASURE.map((t) => `${t.symbol}/${t.strategyId}`).join(', '));
  console.log('');

  const dayRows: Array<{
    date: string;
    trades: Trade[];
    dayNet: number;
    green: boolean;
  }> = [];

  for (const date of picks) {
    const trades: Trade[] = [];
    for (const { symbol, strategyId } of TREASURE) {
      const days = series.get(symbol)!;
      const i = days.findIndex((c) => dayKey(c.date) === date);
      if (i < 1) continue;
      const t = tradeOnDay(symbol, strategyId, days, i);
      if (t) trades.push(t);
    }
    const dayNet = trades.reduce((s, t) => s + t.pnlRs, 0);
    dayRows.push({ date, trades, dayNet, green: dayNet > 0 });

    const tag = dayNet > 0 ? 'GREEN' : dayNet < 0 ? 'RED  ' : 'FLAT ';
    console.log(`── ${date}  ${tag}  day ₹${dayNet >= 0 ? '+' : ''}${dayNet}  · ${trades.length} signal(s)`);
    if (!trades.length) {
      console.log('   (no gap signal on treasure book this day)');
    } else {
      for (const t of trades) {
        console.log(
          `   ${t.symbol.padEnd(12)} ${t.dir.padEnd(4)} ${t.strategyId.padEnd(16)} qty ${String(t.qty).padStart(4)}  entry ${t.entry.toFixed(2)} → ${t.exit.toFixed(2)}  ₹${t.pnlRs >= 0 ? '+' : ''}${t.pnlRs}`,
        );
      }
    }
    console.log('');
  }

  const withTrades = dayRows.filter((d) => d.trades.length > 0);
  const green = withTrades.filter((d) => d.green).length;
  const red = withTrades.filter((d) => d.dayNet < 0).length;
  const flat = withTrades.filter((d) => d.dayNet === 0).length;
  const totalNet = dayRows.reduce((s, d) => s + d.dayNet, 0);
  const best = withTrades.length ? Math.max(...withTrades.map((d) => d.dayNet)) : 0;
  const worst = withTrades.length ? Math.min(...withTrades.map((d) => d.dayNet)) : 0;

  console.log('========== SUMMARY ==========');
  console.log(`Sampled dates: ${picks.length}`);
  console.log(`Days with ≥1 signal: ${withTrades.length}`);
  console.log(`Green / Red / Flat (signal days): ${green} / ${red} / ${flat}`);
  console.log(
    `Green% of signal days: ${withTrades.length ? ((100 * green) / withTrades.length).toFixed(1) : 'n/a'}%`,
  );
  console.log(`Total net on sample: ₹${totalNet >= 0 ? '+' : ''}${totalNet}`);
  console.log(`Best day ₹${best} · Worst day ₹${worst}`);
  console.log(`Wrote ${OUT}`);

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        from: FROM,
        to: TO,
        capital: CAPITAL,
        sampleDates: picks,
        dayRows,
        summary: {
          sampled: picks.length,
          signalDays: withTrades.length,
          green,
          red,
          flat,
          totalNet,
          best,
          worst,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

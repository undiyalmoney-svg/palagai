/**
 * Stocks: enter intraday, always hold until 15:15 — profit feasibility.
 * Usage: unset FROM TO; KITE_AUTH=... npx tsx scripts/stock-hold-till-close-study.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const authRaw = process.env.KITE_AUTH;
if (!authRaw) {
  console.error('Set KITE_AUTH');
  process.exit(1);
}
const authorization = authRaw.startsWith('token ') ? authRaw : `token ${authRaw}`;

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };
type TokenRow = { symbol: string; token: number };

const DELAY = 800;
const FROM = '2026-04-10 09:15:00';
const TO = '2026-07-11 15:30:00';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function extractDate(d: string) {
  return (d.includes('T') ? d.replace('T', ' ') : d).slice(0, 10);
}
function extractHhMm(d: string) {
  return (d.includes('T') ? d.replace('T', ' ') : d).split(' ')[1]?.slice(0, 5) ?? '';
}

async function fetch5m(token: number): Promise<Candle[]> {
  const params = new URLSearchParams({ from: FROM, to: TO });
  const url = `https://api.kite.trade/instruments/historical/${token}/5minute?${params}`;
  const res = await fetch(url, { headers: { 'X-Kite-Version': '3', Authorization: authorization } });
  const body = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { candles?: (string | number)[][] };
  };
  if (body.status !== 'success' || !body.data?.candles?.length) {
    throw new Error(body.message ?? 'no candles');
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

type Trade = {
  date: string;
  month: string;
  direction: 'BUY' | 'SELL';
  entryTime: string;
  entry: number;
  exit: number;
  points: number;
  hitSlBeforeClose: boolean;
};

/** Mode A: PDHL signal 10:30–12:00, hold to 15:15 (optional SL). */
function holdToClosePdhl(bars: Candle[], useStop: boolean): Trade[] {
  const byDay = new Map<string, Candle[]>();
  for (const c of bars) {
    const day = extractDate(c.date);
    const list = byDay.get(day) ?? [];
    list.push(c);
    byDay.set(day, list);
  }
  const days = [...byDay.keys()].sort();
  const trades: Trade[] = [];

  for (let di = 1; di < days.length; di += 1) {
    const day = days[di]!;
    const prev = byDay.get(days[di - 1]!)!;
    const today = byDay.get(day)!;
    const pdh = Math.max(...prev.map((c) => c.high));
    const pdl = Math.min(...prev.map((c) => c.low));

    let entryIdx = -1;
    let direction: 'BUY' | 'SELL' | null = null;
    for (let i = 0; i < today.length; i += 1) {
      const c = today[i]!;
      const t = extractHhMm(c.date);
      if (t < '10:30' || t > '12:00') continue;
      if (c.close > pdh && c.close > c.open) {
        direction = 'BUY';
        entryIdx = i;
        break;
      }
      if (c.close < pdl && c.close < c.open) {
        direction = 'SELL';
        entryIdx = i;
        break;
      }
    }
    if (!direction || entryIdx < 0) continue;

    const entryBar = today[entryIdx]!;
    const entry = entryBar.close;
    const stop = direction === 'BUY' ? Math.min(entryBar.low, pdl) : Math.max(entryBar.high, pdh);
    let exit = today.at(-1)!.close;
    let hitSl = false;

    for (let j = entryIdx + 1; j < today.length; j += 1) {
      const x = today[j]!;
      if (useStop) {
        if (direction === 'BUY' && x.low <= stop) {
          exit = stop;
          hitSl = true;
          break;
        }
        if (direction === 'SELL' && x.high >= stop) {
          exit = stop;
          hitSl = true;
          break;
        }
      }
      if (extractHhMm(x.date) === '15:15' || extractHhMm(x.date) >= '15:15') {
        if (!hitSl) exit = x.close;
        break;
      }
    }
    if (!hitSl) {
      const closeBar = [...today].reverse().find((c) => extractHhMm(c.date) <= '15:15') ?? today.at(-1)!;
      exit = closeBar.close;
    }

    const points = direction === 'BUY' ? exit - entry : entry - exit;
    trades.push({
      date: day,
      month: day.slice(0, 7),
      direction,
      entryTime: entryBar.date,
      entry,
      exit,
      points,
      hitSlBeforeClose: hitSl,
    });
  }
  return trades;
}

/** Mode B: buy at 09:20 open proxy (first bar >= 09:20), hold to 15:15 — no edge assumed. */
function holdOpenToClose(bars: Candle[]): Trade[] {
  const byDay = new Map<string, Candle[]>();
  for (const c of bars) {
    const day = extractDate(c.date);
    const list = byDay.get(day) ?? [];
    list.push(c);
    byDay.set(day, list);
  }
  const trades: Trade[] = [];
  for (const [day, today] of byDay) {
    const entryBar = today.find((c) => extractHhMm(c.date) >= '09:20') ?? today[0];
    const exitBar =
      [...today].reverse().find((c) => extractHhMm(c.date) <= '15:15') ?? today.at(-1);
    if (!entryBar || !exitBar) continue;
    const points = exitBar.close - entryBar.open;
    trades.push({
      date: day,
      month: day.slice(0, 7),
      direction: 'BUY',
      entryTime: entryBar.date,
      entry: entryBar.open,
      exit: exitBar.close,
      points,
      hitSlBeforeClose: false,
    });
  }
  return trades;
}

function summarize(symbol: string, trades: Trade[]) {
  const net = trades.reduce((s, t) => s + t.points, 0);
  const wins = trades.filter((t) => t.points > 0).length;
  const monthly: Record<string, number> = {};
  for (const t of trades) monthly[t.month] = (monthly[t.month] ?? 0) + t.points;
  const months = Object.entries(monthly).sort();
  const greenMonths = months.filter(([, v]) => v > 0).length;
  return {
    symbol,
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    netPts: net,
    avgPts: trades.length ? net / trades.length : 0,
    greenMonths,
    monthsTotal: months.length,
    monthly: Object.fromEntries(months),
  };
}

async function main() {
  const tokens = JSON.parse(readFileSync(join(root, 'reports/stock-tokens.json'), 'utf8')) as {
    resolved: TokenRow[];
  };
  const preferred = [
    'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'ITC', 'SBIN', 'BHARTIARTL', 'LT',
    'AXISBANK', 'KOTAKBANK', 'HINDUNILVR', 'BAJFINANCE', 'MARUTI', 'SUNPHARMA', 'TITAN',
    'NTPC', 'POWERGRID', 'ULTRACEMCO', 'ASIANPAINT',
  ];
  const sample = preferred
    .map((s) => tokens.resolved.find((r) => r.symbol === s))
    .filter((r): r is TokenRow => !!r);

  const rowsHoldOnly = [];
  const rowsWithSl = [];
  const rowsBuyOpen = [];

  for (let i = 0; i < sample.length; i += 1) {
    const row = sample[i]!;
    process.stdout.write(`[${i + 1}/${sample.length}] ${row.symbol}… `);
    try {
      const bars = await fetch5m(row.token);
      const a = summarize(row.symbol, holdToClosePdhl(bars, false));
      const b = summarize(row.symbol, holdToClosePdhl(bars, true));
      const c = summarize(row.symbol, holdOpenToClose(bars));
      rowsHoldOnly.push(a);
      rowsWithSl.push(b);
      rowsBuyOpen.push(c);
      console.log(
        `holdEOD ${a.netPts.toFixed(1)} (${a.winRate.toFixed(0)}%) | +SL ${b.netPts.toFixed(1)} | buyOpen ${c.netPts.toFixed(1)}`,
      );
    } catch (err) {
      console.log(`fail ${err instanceof Error ? err.message : err}`);
    }
    await sleep(DELAY);
  }

  const score = (list: ReturnType<typeof summarize>[]) => ({
    stocks: list.length,
    profitable: list.filter((r) => r.netPts > 0).length,
    pctProfitable: list.length ? (list.filter((r) => r.netPts > 0).length / list.length) * 100 : 0,
    totalNetPts: list.reduce((s, r) => s + r.netPts, 0),
    avgWinRate: list.length ? list.reduce((s, r) => s + r.winRate, 0) / list.length : 0,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    question: 'Trade stocks daily and hold until 15:15 — profitable?',
    range: { from: FROM, to: TO },
    modes: {
      pdhlHoldTo1515NoStop: score(rowsHoldOnly),
      pdhlHoldTo1515WithStop: score(rowsWithSl),
      buyAtOpenHoldTo1515: score(rowsBuyOpen),
    },
    verdict:
      score(rowsHoldOnly).pctProfitable >= 60
        ? 'YES for a filtered liquid basket with PDHL entry + hold to 15:15 — still not every day/stock.'
        : 'NO guarantee. Hold-to-15:15 alone is not enough; most liquid names lose or are flat without a strong entry filter.',
    detailHoldOnly: rowsHoldOnly.sort((a, b) => b.netPts - a.netPts),
    detailWithSl: rowsWithSl.sort((a, b) => b.netPts - a.netPts),
    detailBuyOpen: rowsBuyOpen.sort((a, b) => b.netPts - a.netPts),
  };

  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports/stock-hold-till-close-study.json'), JSON.stringify(report, null, 2));
  console.log('\n=== VERDICT ===');
  console.log(JSON.stringify(report.modes, null, 2));
  console.log(report.verdict);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

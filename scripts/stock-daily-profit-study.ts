/**
 * Multi-stock daily-profit feasibility study (NSE cash).
 * Resolves tokens via quote API, fetches day + sample 5m OHLC, tests PDHL-style rules.
 *
 * Usage:
 *   KITE_AUTH='token key:secret' npx tsx scripts/stock-daily-profit-study.ts
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
type TokenRow = { symbol: string; token: number; last: number };

const FROM_DAY = (process.env.FROM ?? '2024-01-01').slice(0, 10);
const TO_DAY = (process.env.TO ?? '2026-07-11').slice(0, 10);
const SAMPLE_5M = Number(process.env.SAMPLE_5M ?? '20');
const DELAY = 800;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractDate(d: string) {
  return (d.includes('T') ? d.replace('T', ' ') : d).slice(0, 10);
}

function extractHhMm(d: string) {
  return (d.includes('T') ? d.replace('T', ' ') : d).split(' ')[1]?.slice(0, 5) ?? '';
}

async function fetchCandles(token: number, interval: 'day' | '5minute', from: string, to: string): Promise<Candle[]> {
  const params = new URLSearchParams({ from, to });
  const url = `https://api.kite.trade/instruments/historical/${token}/${interval}?${params}`;
  const res = await fetch(url, { headers: { 'X-Kite-Version': '3', Authorization: authorization } });
  const body = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { candles?: (string | number)[][] };
  };
  if (body.status !== 'success' || !body.data?.candles?.length) {
    throw new Error(body.message ?? `no candles ${token}`);
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

/** Daily PDHL: signal on prior close vs its PDH/PDL, enter next open, exit same day. */
function backtestDailyPdhl(days: Candle[]) {
  const trades: { date: string; month: string; points: number; outcome: 'WIN' | 'LOSS' }[] = [];
  for (let i = 2; i < days.length; i += 1) {
    const signalDay = days[i - 1]!;
    const prev = days[i - 2]!;
    const d = days[i]!;
    const pdh = prev.high;
    const pdl = prev.low;

    let direction: 'BUY' | 'SELL' | null = null;
    if (signalDay.close > pdh && signalDay.close > signalDay.open) direction = 'BUY';
    else if (signalDay.close < pdl && signalDay.close < signalDay.open) direction = 'SELL';
    else continue;

    const entry = d.open;
    const risk = Math.max(Math.abs(signalDay.close - (direction === 'BUY' ? pdl : pdh)), entry * 0.005);
    const stop = direction === 'BUY' ? entry - risk : entry + risk;
    const target = direction === 'BUY' ? entry + risk * 1.5 : entry - risk * 1.5;

    let exit = d.close;
    let points = direction === 'BUY' ? exit - entry : entry - exit;
    if (direction === 'BUY') {
      if (d.low <= stop) {
        exit = stop;
        points = exit - entry;
      } else if (d.high >= target) {
        exit = target;
        points = exit - entry;
      }
    } else if (d.high >= stop) {
      exit = stop;
      points = entry - exit;
    } else if (d.low <= target) {
      exit = target;
      points = entry - exit;
    }

    trades.push({
      date: extractDate(d.date),
      month: extractDate(d.date).slice(0, 7),
      points,
      outcome: points > 0 ? 'WIN' : 'LOSS',
    });
  }
  return trades;
}

/** Intraday PDHL + engulfing style (same idea as discovery winner), cash session. */
function backtestIntradayPdhl(bars5: Candle[]) {
  const byDay = new Map<string, Candle[]>();
  for (const c of bars5) {
    const day = extractDate(c.date);
    const list = byDay.get(day) ?? [];
    list.push(c);
    byDay.set(day, list);
  }
  const days = [...byDay.keys()].sort();
  const trades: { date: string; month: string; points: number; outcome: 'WIN' | 'LOSS' }[] = [];

  for (let di = 1; di < days.length; di += 1) {
    const day = days[di]!;
    const prevDay = byDay.get(days[di - 1]!)!;
    const today = byDay.get(day)!;
    const pdh = Math.max(...prevDay.map((c) => c.high));
    const pdl = Math.min(...prevDay.map((c) => c.low));
    let traded = false;

    for (let i = 1; i < today.length; i += 1) {
      const c = today[i]!;
      const p = today[i - 1]!;
      const t = extractHhMm(c.date);
      if (t < '10:30' || t > '12:00') continue;
      if (traded) break;

      const bullEngulf = p.close < p.open && c.close > c.open && c.close >= p.open && c.open <= p.close;
      const bearEngulf = p.close > p.open && c.close < c.open && c.open >= p.close && c.close <= p.open;
      let direction: 'BUY' | 'SELL' | null = null;
      if (bullEngulf && c.close > pdl) direction = 'BUY';
      if (bearEngulf && c.close < pdh) direction = 'SELL';
      // PDHL break confirmation
      if (c.close > pdh && c.close > c.open) direction = 'BUY';
      if (c.close < pdl && c.close < c.open) direction = 'SELL';
      if (!direction) continue;

      const entry = c.close;
      const stop = direction === 'BUY' ? Math.min(c.low, pdl) : Math.max(c.high, pdh);
      const risk = Math.abs(entry - stop);
      if (risk < 0.5 || risk > entry * 0.04) continue;
      const target = direction === 'BUY' ? entry + risk * 2 : entry - risk * 2;

      let exit = today.at(-1)!.close;
      let points = direction === 'BUY' ? exit - entry : entry - exit;
      for (let j = i + 1; j < today.length; j += 1) {
        const x = today[j]!;
        if (direction === 'BUY') {
          if (x.low <= stop) {
            exit = stop;
            points = exit - entry;
            break;
          }
          if (x.high >= target) {
            exit = target;
            points = exit - entry;
            break;
          }
        } else {
          if (x.high >= stop) {
            exit = stop;
            points = entry - exit;
            break;
          }
          if (x.low <= target) {
            exit = target;
            points = entry - exit;
            break;
          }
        }
        if (extractHhMm(x.date) >= '15:15') {
          exit = x.close;
          points = direction === 'BUY' ? exit - entry : entry - exit;
          break;
        }
      }

      trades.push({
        date: day,
        month: day.slice(0, 7),
        points,
        outcome: points > 0 ? 'WIN' : 'LOSS',
      });
      traded = true;
    }
  }
  return trades;
}

function summarize(symbol: string, trades: { month: string; points: number; outcome: string }[]) {
  const net = trades.reduce((s, t) => s + t.points, 0);
  const wins = trades.filter((t) => t.outcome === 'WIN').length;
  const monthly: Record<string, number> = {};
  for (const t of trades) monthly[t.month] = (monthly[t.month] ?? 0) + t.points;
  const months = Object.values(monthly);
  const greenMonths = months.filter((m) => m > 0).length;
  const days = new Set(trades.map((t) => (t as { date?: string }).date).filter(Boolean));
  return {
    symbol,
    trades: trades.length,
    wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    netPts: net,
    greenMonths,
    monthsTotal: months.length,
    monthWinRate: months.length ? (greenMonths / months.length) * 100 : 0,
    monthly,
  };
}

async function main() {
  const tokenFile = join(root, 'reports/stock-tokens.json');
  const tokens = JSON.parse(readFileSync(tokenFile, 'utf8')) as { resolved: TokenRow[] };

  // patch known renames if present in quote retry file later
  const list = tokens.resolved;
  console.log(`Studying ${list.length} stocks for daily-profit feasibility…`);

  const dayResults = [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i]!;
    process.stdout.write(`[day ${i + 1}/${list.length}] ${row.symbol}… `);
    try {
      const candles = await fetchCandles(
        row.token,
        'day',
        `${FROM_DAY} 09:15:00`,
        `${TO_DAY} 15:30:00`,
      );
      const trades = backtestDailyPdhl(candles);
      const summary = summarize(row.symbol, trades);
      dayResults.push({ ...summary, bars: candles.length });
      console.log(`net ${summary.netPts.toFixed(1)} | WR ${summary.winRate.toFixed(0)}% | months ${summary.greenMonths}/${summary.monthsTotal}`);
    } catch (err) {
      console.log(`fail: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(DELAY);
  }

  // Top liquid-ish sample for 5m (highest last price * as proxy, or fixed liquid names)
  const preferred = [
    'RELIANCE',
    'TCS',
    'HDFCBANK',
    'ICICIBANK',
    'INFY',
    'ITC',
    'SBIN',
    'BHARTIARTL',
    'LT',
    'AXISBANK',
    'KOTAKBANK',
    'HINDUNILVR',
    'BAJFINANCE',
    'MARUTI',
    'SUNPHARMA',
    'TITAN',
    'NTPC',
    'POWERGRID',
    'ULTRACEMCO',
    'ASIANPAINT',
  ];
  const sample = preferred
    .map((s) => list.find((r) => r.symbol === s))
    .filter((r): r is TokenRow => !!r)
    .slice(0, SAMPLE_5M);

  const intraResults = [];
  console.log(`\nIntraday 5m PDHL sample (${sample.length} stocks)…`);
  for (let i = 0; i < sample.length; i += 1) {
    const row = sample[i]!;
    process.stdout.write(`[5m ${i + 1}/${sample.length}] ${row.symbol}… `);
    try {
      // ~95 calendar days of 5m (under Kite 100-day limit)
      const candles = await fetchCandles(
        row.token,
        '5minute',
        '2026-04-10 09:15:00',
        `${TO_DAY} 15:30:00`,
      );
      const trades = backtestIntradayPdhl(candles);
      const summary = summarize(row.symbol, trades);
      intraResults.push({ ...summary, bars: candles.length });
      console.log(`net ${summary.netPts.toFixed(1)} | trades ${summary.trades} | WR ${summary.winRate.toFixed(0)}%`);
    } catch (err) {
      console.log(`fail: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(DELAY);
  }

  dayResults.sort((a, b) => b.netPts - a.netPts);
  intraResults.sort((a, b) => b.netPts - a.netPts);

  const dayProfitable = dayResults.filter((r) => r.netPts > 0).length;
  const dayMonthOk = dayResults.filter((r) => r.monthWinRate >= 55).length;
  const intraProfitable = intraResults.filter((r) => r.netPts > 0).length;

  const report = {
    generatedAt: new Date().toISOString(),
    question: 'Can we go with stocks for daily profits?',
    verdict: {
      dailySwingPdhl: {
        stocksTested: dayResults.length,
        profitableStocks: dayProfitable,
        pctProfitable: dayResults.length ? (dayProfitable / dayResults.length) * 100 : 0,
        monthWinRate55Plus: dayMonthOk,
        note: 'Day-timeframe PDHL — not true intraday. Good for screening names, not every-day income.',
      },
      intraday5mSample: {
        stocksTested: intraResults.length,
        profitableStocks: intraProfitable,
        pctProfitable: intraResults.length ? (intraProfitable / intraResults.length) * 100 : 0,
        note: 'PDHL-style 5m on ~Feb–Jul 2026. Index-like daily certainty is weaker on single stocks.',
      },
      recommendation:
        intraProfitable / Math.max(intraResults.length, 1) >= 0.55
          ? 'POSSIBLE with a basket of liquid stocks + strict filters — not every day, not every stock.'
          : 'WEAK for reliable daily profits vs Nifty/Bank Nifty. Prefer index for daily edge; stocks as satellite.',
    },
    topDayStocks: dayResults.slice(0, 15),
    bottomDayStocks: dayResults.slice(-10),
    intradaySample: intraResults,
    failedSymbolsNote: 'LTIM/TATAMOTORS/ZOMATO may be renamed — check LTIMINDIA/TMPV/ETERNAL',
  };

  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports/stock-daily-profit-study.json'), JSON.stringify(report, null, 2));
  console.log('\n=== VERDICT ===');
  console.log(JSON.stringify(report.verdict, null, 2));
  console.log('Report: reports/stock-daily-profit-study.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

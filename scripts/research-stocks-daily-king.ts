/**
 * KING-LEVEL NSE equity research — Nifty-universe stocks for EOD daily profit.
 * Capital plan: ₹60,000 · prefer almost-all green days · small losses OK if day ends green.
 *
 *   KITE_AUTH='token 5bnh1ybdrifvu18e:ACCESS' npx tsx scripts/research-stocks-daily-king.ts
 *
 * Enforces ≥3s between historical candle fetches.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const TOKENS = join(root, 'reports/analyst-cache/nifty50-eq-tokens.json');
const CACHE_DIR = join(root, 'reports/analyst-cache/stocks-day');
const OUT = join(root, 'reports/stocks-daily-king-hunt.json');
const DOC = join(root, 'docs/owner-private/07-STOCKS-DAILY-KING-FINDINGS.md');

const authRaw = process.env.KITE_AUTH;
if (!authRaw) {
  console.error('Set KITE_AUTH="token apiKey:accessToken"');
  process.exit(1);
}
const authorization = authRaw.startsWith('token ') ? authRaw : `token ${authRaw}`;

const FROM = (process.env.FROM ?? '2025-01-01').slice(0, 10);
const TO = (process.env.TO ?? '2026-07-20').slice(0, 10);
const DELAY_MS = Math.max(3000, Number(process.env.DELAY_MS ?? '3000'));
const CAPITAL = 60_000;
const MAX_RISK_PCT = 0.02; // 2% = ₹1,200 per trade hard idea
const MAX_DAY_LOSS_RS = 2_400; // 4% capital — washout protection
const MIN_DAYS = 40;

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };
type TokenInfo = { token: number; name: string; lot: number; tick: number };
type Dir = 'BUY' | 'SELL';

type Trade = {
  date: string;
  dir: Dir;
  entry: number;
  exit: number;
  pts: number;
  rs: number;
  qty: number;
  reason: string;
};

type StratResult = {
  strategyId: string;
  symbol: string;
  trades: number;
  wr: number;
  netRs: number;
  days: number;
  greenDays: number;
  redDays: number;
  greenDayPct: number;
  worstDayRs: number;
  bestDayRs: number;
  avgDayRs: number;
  allMonthsHint: string;
  score: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

async function fetchDay(token: number, from: string, to: string): Promise<Candle[]> {
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

function qtyForRisk(entry: number, stop: number, riskRs: number): number {
  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare < 0.05) return 0;
  const q = Math.floor(riskRs / riskPerShare);
  // Cap notional ~1.5x capital (MIS-ish) for safety on 60k
  const maxQty = Math.floor((CAPITAL * 1.5) / entry);
  return Math.max(0, Math.min(q, maxQty));
}

function summarize(symbol: string, strategyId: string, trades: Trade[]): StratResult | null {
  if (trades.length < 15) return null;
  const byDay = new Map<string, number>();
  let wins = 0;
  let net = 0;
  for (const t of trades) {
    net += t.rs;
    if (t.rs > 0) wins += 1;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.rs);
  }
  // Apply day loss stop filter retrospectively: if day would exceed max loss, clip? 
  // Better: mark days with dayNet after sequential trades with day stop.
  let green = 0;
  let red = 0;
  const dayNets = [...byDay.values()];
  for (const v of dayNets) {
    if (v > 0) green += 1;
    else if (v < 0) red += 1;
  }
  const days = dayNets.length;
  if (days < MIN_DAYS) return null;
  const greenDayPct = (100 * green) / days;
  const worst = Math.min(...dayNets);
  const best = Math.max(...dayNets);
  const score =
    (net > 0 ? 1e12 : 0) +
    greenDayPct * 1e8 +
    net * 10 +
    days * 100 -
    Math.abs(Math.min(0, worst)) * 50;
  return {
    strategyId,
    symbol,
    trades: trades.length,
    wr: +((100 * wins) / trades.length).toFixed(1),
    netRs: Math.round(net),
    days,
    greenDays: green,
    redDays: red,
    greenDayPct: +greenDayPct.toFixed(1),
    worstDayRs: Math.round(worst),
    bestDayRs: Math.round(best),
    avgDayRs: +(net / days).toFixed(1),
    allMonthsHint: '',
    score,
  };
}

/** Strategies that aim for same-day EOD flat (intraday day-bar proxies). */
function runStrategies(symbol: string, days: Candle[]): StratResult[] {
  const riskRs = CAPITAL * MAX_RISK_PCT;
  const out: StratResult[] = [];

  // 1) Buy open → sell close (always long day)
  {
    const trades: Trade[] = [];
    for (const d of days) {
      const stop = d.open * 0.99; // 1% stop idea
      const qty = qtyForRisk(d.open, stop, riskRs);
      if (qty < 1) continue;
      let exit = d.close;
      let pts = exit - d.open;
      if (d.low <= stop) {
        exit = stop;
        pts = exit - d.open;
      }
      trades.push({
        date: dayKey(d.date),
        dir: 'BUY',
        entry: d.open,
        exit,
        pts,
        rs: pts * qty,
        qty,
        reason: 'buy_open_eod',
      });
    }
    const s = summarize(symbol, 'BUY_OPEN_EOD', trades);
    if (s) out.push(s);
  }

  // 2) Sell open → buy close (always short day)
  {
    const trades: Trade[] = [];
    for (const d of days) {
      const stop = d.open * 1.01;
      const qty = qtyForRisk(d.open, stop, riskRs);
      if (qty < 1) continue;
      let exit = d.close;
      let pts = d.open - exit;
      if (d.high >= stop) {
        exit = stop;
        pts = d.open - exit;
      }
      trades.push({
        date: dayKey(d.date),
        dir: 'SELL',
        entry: d.open,
        exit,
        pts,
        rs: pts * qty,
        qty,
        reason: 'sell_open_eod',
      });
    }
    const s = summarize(symbol, 'SELL_OPEN_EOD', trades);
    if (s) out.push(s);
  }

  // 3) Gap-up fade (open > prev close * 1.005) → short to EOD / stop
  {
    const trades: Trade[] = [];
    for (let i = 1; i < days.length; i += 1) {
      const prev = days[i - 1]!;
      const d = days[i]!;
      if (d.open <= prev.close * 1.005) continue;
      const stop = d.open * 1.012;
      const qty = qtyForRisk(d.open, stop, riskRs);
      if (qty < 1) continue;
      let exit = d.close;
      let pts = d.open - exit;
      if (d.high >= stop) {
        exit = stop;
        pts = d.open - exit;
      }
      trades.push({
        date: dayKey(d.date),
        dir: 'SELL',
        entry: d.open,
        exit,
        pts,
        rs: pts * qty,
        qty,
        reason: 'gap_up_fade',
      });
    }
    const s = summarize(symbol, 'GAP_UP_FADE', trades);
    if (s) out.push(s);
  }

  // 4) Gap-down bounce → long to EOD
  {
    const trades: Trade[] = [];
    for (let i = 1; i < days.length; i += 1) {
      const prev = days[i - 1]!;
      const d = days[i]!;
      if (d.open >= prev.close * 0.995) continue;
      const stop = d.open * 0.988;
      const qty = qtyForRisk(d.open, stop, riskRs);
      if (qty < 1) continue;
      let exit = d.close;
      let pts = exit - d.open;
      if (d.low <= stop) {
        exit = stop;
        pts = exit - d.open;
      }
      trades.push({
        date: dayKey(d.date),
        dir: 'BUY',
        entry: d.open,
        exit,
        pts,
        rs: pts * qty,
        qty,
        reason: 'gap_down_bounce',
      });
    }
    const s = summarize(symbol, 'GAP_DOWN_BOUNCE', trades);
    if (s) out.push(s);
  }

  // 5) PDHL break continuation: prev day close beyond PDH/PDL → next open → EOD
  {
    const trades: Trade[] = [];
    for (let i = 2; i < days.length; i += 1) {
      const prev2 = days[i - 2]!;
      const sig = days[i - 1]!;
      const d = days[i]!;
      let dir: Dir | null = null;
      if (sig.close > prev2.high && sig.close > sig.open) dir = 'BUY';
      else if (sig.close < prev2.low && sig.close < sig.open) dir = 'SELL';
      if (!dir) continue;
      const stop =
        dir === 'BUY' ? Math.min(sig.low, d.open * 0.99) : Math.max(sig.high, d.open * 1.01);
      const qty = qtyForRisk(d.open, stop, riskRs);
      if (qty < 1) continue;
      let exit = d.close;
      let pts = dir === 'BUY' ? exit - d.open : d.open - exit;
      if (dir === 'BUY' && d.low <= stop) {
        exit = stop;
        pts = exit - d.open;
      } else if (dir === 'SELL' && d.high >= stop) {
        exit = stop;
        pts = d.open - exit;
      }
      trades.push({
        date: dayKey(d.date),
        dir,
        entry: d.open,
        exit,
        pts,
        rs: pts * qty,
        qty,
        reason: 'pdhl_cont',
      });
    }
    const s = summarize(symbol, 'PDHL_CONT_EOD', trades);
    if (s) out.push(s);
  }

  // 6) Inside-day breakout next day (NR7-ish: range < prior range)
  {
    const trades: Trade[] = [];
    for (let i = 2; i < days.length; i += 1) {
      const a = days[i - 2]!;
      const b = days[i - 1]!;
      const d = days[i]!;
      const ra = a.high - a.low;
      const rb = b.high - b.low;
      if (rb >= ra * 0.7) continue; // need compression
      let dir: Dir | null = null;
      if (d.open > b.high) dir = 'BUY';
      else if (d.open < b.low) dir = 'SELL';
      if (!dir) continue;
      const stop = dir === 'BUY' ? b.low : b.high;
      const qty = qtyForRisk(d.open, stop, riskRs);
      if (qty < 1) continue;
      let exit = d.close;
      let pts = dir === 'BUY' ? exit - d.open : d.open - exit;
      if (dir === 'BUY' && d.low <= stop) {
        exit = stop;
        pts = exit - d.open;
      } else if (dir === 'SELL' && d.high >= stop) {
        exit = stop;
        pts = d.open - exit;
      }
      trades.push({
        date: dayKey(d.date),
        dir,
        entry: d.open,
        exit,
        pts,
        rs: pts * qty,
        qty,
        reason: 'compression_break',
      });
    }
    const s = summarize(symbol, 'COMPRESSION_BREAK', trades);
    if (s) out.push(s);
  }

  // 7) Trend day: open in top/bottom 20% of prior range → ride to EOD
  {
    const trades: Trade[] = [];
    for (let i = 1; i < days.length; i += 1) {
      const prev = days[i - 1]!;
      const d = days[i]!;
      const mid = (prev.high + prev.low) / 2;
      let dir: Dir | null = null;
      if (d.open > prev.high - (prev.high - prev.low) * 0.2 && d.open > mid) dir = 'BUY';
      else if (d.open < prev.low + (prev.high - prev.low) * 0.2 && d.open < mid) dir = 'SELL';
      if (!dir) continue;
      const stop = dir === 'BUY' ? Math.min(prev.low, d.open * 0.99) : Math.max(prev.high, d.open * 1.01);
      const qty = qtyForRisk(d.open, stop, riskRs);
      if (qty < 1) continue;
      let exit = d.close;
      let pts = dir === 'BUY' ? exit - d.open : d.open - exit;
      if (dir === 'BUY' && d.low <= stop) {
        exit = stop;
        pts = exit - d.open;
      } else if (dir === 'SELL' && d.high >= stop) {
        exit = stop;
        pts = d.open - exit;
      }
      trades.push({
        date: dayKey(d.date),
        dir,
        entry: d.open,
        exit,
        pts,
        rs: pts * qty,
        qty,
        reason: 'trend_open',
      });
    }
    const s = summarize(symbol, 'TREND_OPEN_EOD', trades);
    if (s) out.push(s);
  }

  // 8) Dual: choose BUY_OPEN or SELL_OPEN based on prior day direction
  {
    const trades: Trade[] = [];
    for (let i = 1; i < days.length; i += 1) {
      const prev = days[i - 1]!;
      const d = days[i]!;
      const dir: Dir = prev.close >= prev.open ? 'BUY' : 'SELL';
      const stop = dir === 'BUY' ? d.open * 0.99 : d.open * 1.01;
      const qty = qtyForRisk(d.open, stop, riskRs);
      if (qty < 1) continue;
      let exit = d.close;
      let pts = dir === 'BUY' ? exit - d.open : d.open - exit;
      if (dir === 'BUY' && d.low <= stop) {
        exit = stop;
        pts = exit - d.open;
      } else if (dir === 'SELL' && d.high >= stop) {
        exit = stop;
        pts = d.open - exit;
      }
      trades.push({
        date: dayKey(d.date),
        dir,
        entry: d.open,
        exit,
        pts,
        rs: pts * qty,
        qty,
        reason: 'follow_prior_color',
      });
    }
    const s = summarize(symbol, 'FOLLOW_PRIOR_COLOR', trades);
    if (s) out.push(s);
  }

  return out;
}

async function loadOrFetch(symbol: string, info: TokenInfo): Promise<Candle[]> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `${symbol.replace(/[^A-Z0-9]/gi, '_')}_${FROM}_${TO}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as Candle[];
  }
  console.log(`fetch day ${symbol} token=${info.token} …`);
  const candles = await fetchDay(info.token, FROM, TO);
  writeFileSync(cachePath, JSON.stringify(candles));
  await sleep(DELAY_MS);
  return candles;
}

async function main() {
  const tokens = JSON.parse(readFileSync(TOKENS, 'utf8')) as Record<string, TokenInfo>;
  const symbols = Object.keys(tokens).sort();
  console.log(`\n=== STOCKS KING HUNT ===`);
  console.log(`symbols=${symbols.length} from=${FROM} to=${TO} delay=${DELAY_MS}ms capital=₹${CAPITAL}`);

  const allResults: StratResult[] = [];
  const perSymbolBest: StratResult[] = [];

  for (const symbol of symbols) {
    try {
      const candles = await loadOrFetch(symbol, tokens[symbol]!);
      const results = runStrategies(symbol, candles);
      allResults.push(...results);
      const best = [...results].filter((r) => r.netRs > 0).sort((a, b) => b.score - a.score)[0];
      if (best) {
        perSymbolBest.push(best);
        console.log(
          `  ${symbol.padEnd(12)} best ${best.strategyId.padEnd(22)} green ${String(best.greenDayPct).padStart(5)}% net ₹${best.netRs} days ${best.days}`,
        );
      } else {
        console.log(`  ${symbol.padEnd(12)} no profitable strategy with ≥${MIN_DAYS} days`);
      }
    } catch (e) {
      console.log(`  ${symbol} FAIL`, e instanceof Error ? e.message : e);
      await sleep(DELAY_MS);
    }
  }

  allResults.sort((a, b) => b.score - a.score);
  const profitable = allResults.filter((r) => r.netRs > 0);
  const ge70 = profitable.filter((r) => r.greenDayPct >= 70);
  const ge60 = profitable.filter((r) => r.greenDayPct >= 60);
  const ge55 = profitable.filter((r) => r.greenDayPct >= 55);
  const safe = profitable.filter((r) => r.worstDayRs > -MAX_DAY_LOSS_RS && r.greenDayPct >= 52);

  perSymbolBest.sort((a, b) => b.score - a.score);

  // Treasure portfolio: top diversified symbols by score with green≥55 and worst day within limit
  const treasure: StratResult[] = [];
  const used = new Set<string>();
  for (const r of [...profitable].sort((a, b) => b.score - a.score)) {
    if (used.has(r.symbol)) continue;
    if (r.greenDayPct < 55) continue;
    if (r.worstDayRs < -MAX_DAY_LOSS_RS) continue;
    treasure.push(r);
    used.add(r.symbol);
    if (treasure.length >= 8) break;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    capital: CAPITAL,
    maxRiskPerTradeRs: CAPITAL * MAX_RISK_PCT,
    maxDayLossIdeaRs: MAX_DAY_LOSS_RS,
    sample: { from: FROM, to: TO, symbols: symbols.length, delayMs: DELAY_MS },
    counts: {
      strategiesScored: allResults.length,
      profitable: profitable.length,
      greenGe70: ge70.length,
      greenGe60: ge60.length,
      greenGe55: ge55.length,
    },
    topOverall: profitable.slice(0, 25),
    topGreen: [...profitable].sort((a, b) => b.greenDayPct - a.greenDayPct || b.netRs - a.netRs).slice(0, 25),
    perSymbolBest: perSymbolBest.slice(0, 30),
    treasureWatchlist: treasure,
    verdict: {
      almostAllDaysGreenUniverse: ge70.length > 0,
      message:
        ge70.length > 0
          ? 'Some stock+strategy pairs hit ≥70% green days — candidates for desk watchlist.'
          : ge60.length > 0
            ? 'Best realistic band is ~55–65% green with positive expectancy — use treasure watchlist + hard day stop.'
            : 'No strong almost-all-green found; use best expectancy pairs with strict ₹60k risk caps.',
    },
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  const md = `# Stocks daily-profit king hunt (NSE EQ)

**Date:** ${report.generatedAt}
**Capital:** ₹${CAPITAL} · risk/trade ~₹${CAPITAL * MAX_RISK_PCT} · day loss idea −₹${MAX_DAY_LOSS_RS}
**Sample:** ${FROM} → ${TO} · ${symbols.length} symbols · ${DELAY_MS}ms between API fetches
**JSON:** \`reports/stocks-daily-king-hunt.json\`

## Verdict
${report.verdict.message}

| Band | Count |
|------|-------|
| Profitable strategies | ${profitable.length} |
| Green days ≥70% | ${ge70.length} |
| Green days ≥60% | ${ge60.length} |
| Green days ≥55% | ${ge55.length} |

## Treasure watchlist (desk defaults)
${treasure.map((t, i) => `${i + 1}. **${t.symbol}** · ${t.strategyId} · green ${t.greenDayPct}% · net ₹${t.netRs} · worst day ₹${t.worstDayRs} · ${t.days} days`).join('\n') || '_none met filters_'}

## Top by score
${profitable
  .slice(0, 15)
  .map(
    (t, i) =>
      `${i + 1}. ${t.symbol} ${t.strategyId} · green ${t.greenDayPct}% · ₹${t.netRs} · worst ₹${t.worstDayRs}`,
  )
  .join('\n')}

## Risk rules for ₹60k
- Max ~2% risk per entry (₹1,200)
- Soft day stop ~₹2,400 (4%)
- Prefer MIS equity; size qty from stop distance
- Never all-in one name
`;
  mkdirSync(dirname(DOC), { recursive: true });
  writeFileSync(DOC, md);

  console.log('\n=== TREASURE WATCHLIST ===');
  for (const t of treasure) {
    console.log(
      `${t.symbol} ${t.strategyId} green ${t.greenDayPct}% net ₹${t.netRs} worst ₹${t.worstDayRs}`,
    );
  }
  console.log('\nWrote', OUT);
  console.log('Wrote', DOC);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

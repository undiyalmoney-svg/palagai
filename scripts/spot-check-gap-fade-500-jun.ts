/**
 * Replay GAP_FADE_500 on Jun 2025 + Jun 2026 (all weekdays).
 *   npx tsx scripts/spot-check-gap-fade-500-jun.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CACHE = join(root, 'reports/analyst-cache/stocks-day-2020');
const OUT = join(root, 'reports/gap-fade-500-jun-2025-2026.json');

const BOOK = [
  'APOLLOHOSP',
  'BRITANNIA',
  'CIPLA',
  'HDFCLIFE',
  'NESTLEIND',
  'NTPC',
  'SUNPHARMA',
  'TATACONSUM',
] as const;

const CAPITAL = 60_000;
const GAP_PCT = 0.003;
const STOP_PCT = 0.015;
const RISK_PCT = 0.025;
const MAX_PER_DAY = 3;
const MAX_DAY_LOSS = 2_400;

type Candle = { date: string; open: number; high: number; low: number; close: number };
type Trade = {
  date: string;
  symbol: string;
  dir: 'SELL';
  entry: number;
  exit: number;
  qty: number;
  gapPct: number;
  pnlRs: number;
  reason: string;
};

function dayKey(iso: string) {
  return iso.slice(0, 10);
}
function weekday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}
function qtyFor(entry: number, stop: number) {
  const r = Math.abs(entry - stop);
  if (r < 0.05) return 0;
  return Math.max(
    0,
    Math.min(Math.floor((CAPITAL * RISK_PCT) / r), Math.floor((CAPITAL * 1.5) / entry)),
  );
}

function load(): Map<string, Candle[]> {
  const map = new Map<string, Candle[]>();
  for (const f of readdirSync(CACHE)) {
    const sym = f.split('_')[0]!;
    if (!(BOOK as readonly string[]).includes(sym)) continue;
    map.set(sym, JSON.parse(readFileSync(join(CACHE, f), 'utf8')) as Candle[]);
  }
  return map;
}

function monthDays(series: Map<string, Candle[]>, yyyyMm: string): string[] {
  const set = new Set<string>();
  for (const days of series.values()) {
    for (const c of days) {
      const d = dayKey(c.date);
      if (d.startsWith(yyyyMm) && weekday(d) >= 1 && weekday(d) <= 5) set.add(d);
    }
  }
  return [...set].sort();
}

function signalsOnDate(series: Map<string, Candle[]>, date: string): Trade[] {
  const cands: Trade[] = [];
  for (const sym of BOOK) {
    const days = series.get(sym)!;
    const i = days.findIndex((c) => dayKey(c.date) === date);
    if (i < 1) continue;
    const d = days[i]!;
    const prev = days[i - 1]!;
    const gap = (d.open - prev.close) / prev.close;
    if (gap <= GAP_PCT) continue;
    const stop = d.open * (1 + STOP_PCT);
    const qty = qtyFor(d.open, stop);
    if (qty < 1) continue;
    let exit = d.close;
    let pts = d.open - exit;
    let reason = 'EOD';
    if (d.high >= stop) {
      exit = stop;
      pts = d.open - exit;
      reason = 'SL';
    }
    cands.push({
      date,
      symbol: sym,
      dir: 'SELL',
      entry: d.open,
      exit,
      qty,
      gapPct: gap,
      pnlRs: Math.round(pts * qty),
      reason,
    });
  }
  cands.sort((a, b) => b.gapPct - a.gapPct || a.symbol.localeCompare(b.symbol));
  return cands.slice(0, MAX_PER_DAY);
}

function runMonth(series: Map<string, Candle[]>, yyyyMm: string, label: string) {
  const dates = monthDays(series, yyyyMm);
  console.log(`\n========== ${label} (${dates.length} weekdays) ==========`);
  console.log(
    `DNA: GAP_FADE_500 · gap≥${GAP_PCT * 100}% · stop ${STOP_PCT * 100}% · risk ${RISK_PCT * 100}% · max ${MAX_PER_DAY}/day`,
  );
  console.log('');

  const dayRows: Array<{
    date: string;
    trades: Trade[];
    dayNet: number;
    clipped: number;
  }> = [];

  for (const date of dates) {
    const trades = signalsOnDate(series, date);
    let dayNet = trades.reduce((s, t) => s + t.pnlRs, 0);
    const clipped = Math.max(dayNet, -MAX_DAY_LOSS);
    dayRows.push({ date, trades, dayNet, clipped });

    const tag = clipped > 0 ? 'GREEN' : clipped < 0 ? 'RED  ' : 'FLAT ';
    console.log(
      `${date}  ${tag}  ₹${clipped >= 0 ? '+' : ''}${clipped}${dayNet !== clipped ? ` (raw ${dayNet})` : ''}  · ${trades.length} trade(s)`,
    );
    for (const t of trades) {
      console.log(
        `   ${t.symbol.padEnd(12)} SELL gap ${(t.gapPct * 100).toFixed(2)}%  qty ${String(t.qty).padStart(4)}  ${t.entry.toFixed(2)} → ${t.exit.toFixed(2)}  ₹${t.pnlRs >= 0 ? '+' : ''}${t.pnlRs}  ${t.reason}`,
      );
    }
  }

  const withSig = dayRows.filter((d) => d.trades.length > 0);
  const green = withSig.filter((d) => d.clipped > 0).length;
  const red = withSig.filter((d) => d.clipped < 0).length;
  const flat = dayRows.filter((d) => d.trades.length === 0 || d.clipped === 0).length;
  const total = dayRows.reduce((s, d) => s + d.clipped, 0);
  const avgCal = dates.length ? Math.round(total / dates.length) : 0;
  const avgSig = withSig.length ? Math.round(total / withSig.length) : 0;
  const hit500 = withSig.filter((d) => d.clipped >= 500).length;
  const best = dayRows.length ? Math.max(...dayRows.map((d) => d.clipped)) : 0;
  const worst = dayRows.length ? Math.min(...dayRows.map((d) => d.clipped)) : 0;

  console.log('');
  console.log(`── ${label} SUMMARY ──`);
  console.log(`Weekdays: ${dates.length} · days with trades: ${withSig.length}`);
  console.log(`Green / Red (signal days): ${green} / ${red} · flat/no-signal weekdays counted in month: ${flat}`);
  console.log(`Total net: ₹${total >= 0 ? '+' : ''}${total}`);
  console.log(`Avg / weekday: ₹${avgCal} · Avg / signal day: ₹${avgSig}`);
  console.log(`Days ≥₹500: ${hit500}/${withSig.length || 0}`);
  console.log(`Best ₹${best} · Worst ₹${worst}`);

  return {
    label,
    yyyyMm,
    weekdays: dates.length,
    signalDays: withSig.length,
    green,
    red,
    totalNet: total,
    avgWeekday: avgCal,
    avgSignalDay: avgSig,
    hit500,
    best,
    worst,
    days: dayRows,
  };
}

function main() {
  const series = load();
  console.log('Loaded', [...series.keys()].sort().join(', '));
  const jun2025 = runMonth(series, '2025-06', 'JUNE 2025');
  const jun2026 = runMonth(series, '2026-06', 'JUNE 2026');

  console.log('\n========== BOTH MONTHS ==========');
  console.log(
    `Jun 2025: ₹${jun2025.totalNet >= 0 ? '+' : ''}${jun2025.totalNet} · avg/day ₹${jun2025.avgWeekday}`,
  );
  console.log(
    `Jun 2026: ₹${jun2026.totalNet >= 0 ? '+' : ''}${jun2026.totalNet} · avg/day ₹${jun2026.avgWeekday}`,
  );
  console.log(
    `Combined: ₹${jun2025.totalNet + jun2026.totalNet >= 0 ? '+' : ''}${jun2025.totalNet + jun2026.totalNet}`,
  );

  writeFileSync(
    OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), jun2025, jun2026 }, null, 2),
  );
  console.log('\nWrote', OUT);
}

main();

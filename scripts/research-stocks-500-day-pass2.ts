/**
 * Pass-2: denser books for ~₹500/day — always-in + multi-symbol Nifty basket (2025+ cache).
 *   npx tsx scripts/research-stocks-500-day-pass2.ts
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CACHE_2020 = join(root, 'reports/analyst-cache/stocks-day-2020');
const CACHE_2025 = join(root, 'reports/analyst-cache/stocks-day');
const OUT = join(root, 'reports/stocks-500-day-pass2.json');

const CAPITAL = 60_000;
const MAX_DAY_LOSS = 2_400;

type Candle = { date: string; open: number; high: number; low: number; close: number };
type Dir = 'BUY' | 'SELL';
type Trade = { symbol: string; date: string; pnlRs: number };

function dayKey(iso: string) {
  return iso.slice(0, 10);
}
function weekday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}
function qty(entry: number, stop: number, riskPct: number) {
  const r = Math.abs(entry - stop);
  if (r < 0.05) return 0;
  return Math.max(0, Math.min(Math.floor((CAPITAL * riskPct) / r), Math.floor((CAPITAL * 1.5) / entry)));
}

function loadAll(): Map<string, Candle[]> {
  const map = new Map<string, Candle[]>();
  for (const dir of [CACHE_2020, CACHE_2025]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const sym = f.split('_')[0]!;
      if (map.has(sym) && dir === CACHE_2025) continue; // prefer long
      const raw = readFileSync(join(dir, f), 'utf8').trim();
      if (!raw) continue;
      try {
        map.set(sym, JSON.parse(raw) as Candle[]);
      } catch {
        /* */
      }
    }
  }
  return map;
}

function sim(
  symbol: string,
  days: Candle[],
  kind: string,
  stopPct: number,
  riskPct: number,
  gapPct = 0.005,
): Trade[] {
  const out: Trade[] = [];
  for (let i = 1; i < days.length; i += 1) {
    const d = days[i]!;
    const prev = days[i - 1]!;
    const date = dayKey(d.date);
    const wd = weekday(date);
    if (wd < 1 || wd > 5) continue;
    let dir: Dir | null = null;
    if (kind === 'FOLLOW') dir = prev.close >= prev.open ? 'BUY' : 'SELL';
    else if (kind === 'FADE') dir = prev.close >= prev.open ? 'SELL' : 'BUY';
    else if (kind === 'GAP_FADE') {
      if (d.open > prev.close * (1 + gapPct)) dir = 'SELL';
    } else if (kind === 'GAP_BOUNCE') {
      if (d.open < prev.close * (1 - gapPct)) dir = 'BUY';
    } else if (kind === 'ALWAYS_BUY') dir = 'BUY';
    else if (kind === 'ALWAYS_SELL') dir = 'SELL';
    if (!dir) continue;
    const stop = dir === 'BUY' ? d.open * (1 - stopPct) : d.open * (1 + stopPct);
    const q = qty(d.open, stop, riskPct);
    if (q < 1) continue;
    let exit = d.close;
    let pts = dir === 'BUY' ? exit - d.open : d.open - exit;
    if (dir === 'BUY' && d.low <= stop) {
      exit = stop;
      pts = exit - d.open;
    } else if (dir === 'SELL' && d.high >= stop) {
      exit = stop;
      pts = d.open - exit;
    }
    out.push({ symbol, date, pnlRs: pts * q });
  }
  return out;
}

function score(trades: Trade[], calDays: number, maxPerDay: number) {
  const by = new Map<string, number[]>();
  for (const t of trades) {
    const a = by.get(t.date) ?? [];
    a.push(t.pnlRs);
    by.set(t.date, a);
  }
  const dayVals: number[] = [];
  for (const [, arr] of by) {
    arr.sort((a, b) => Math.abs(b) - Math.abs(a));
    let s = arr.slice(0, maxPerDay).reduce((x, y) => x + y, 0);
    if (s < -MAX_DAY_LOSS) s = -MAX_DAY_LOSS;
    dayVals.push(s);
  }
  if (dayVals.length < 40) return null;
  const total = dayVals.reduce((a, b) => a + b, 0);
  const green = dayVals.filter((v) => v > 0).length;
  const hit500 = dayVals.filter((v) => v >= 500).length;
  const avgSig = total / dayVals.length;
  const avgCal = total / calDays;
  const worst = Math.min(...dayVals);
  return {
    signalDays: dayVals.length,
    greenPct: Math.round((100 * green) / dayVals.length * 10) / 10,
    avgSignalDayRs: Math.round(avgSig),
    avgCalendarDayRs: Math.round(avgCal),
    hit500Pct: Math.round((100 * hit500) / dayVals.length * 10) / 10,
    totalNet: Math.round(total),
    worstDay: Math.round(worst),
    median: Math.round([...dayVals].sort((a, b) => a - b)[Math.floor(dayVals.length / 2)]!),
  };
}

function main() {
  const series = loadAll();
  const long = [...series.entries()].filter(([, d]) => d.length >= 1000).map(([s]) => s);
  const mid = [...series.entries()].filter(([, d]) => d.length >= 200).map(([s]) => s);
  console.log(`long=${long.length} mid=${mid.length}`);

  const cal = new Set<string>();
  for (const s of long) for (const c of series.get(s)!) cal.add(dayKey(c.date));
  const calDays = [...cal].filter((d) => {
    const w = weekday(d);
    return w >= 1 && w <= 5;
  }).length;

  type Row = { id: string; members: string[] } & NonNullable<ReturnType<typeof score>>;
  const rows: Row[] = [];

  // 1) Always-in single + basket on long history
  for (const kind of ['FOLLOW', 'FADE', 'ALWAYS_BUY', 'ALWAYS_SELL']) {
    for (const stop of [0.008, 0.01, 0.012, 0.015]) {
      for (const risk of [0.01, 0.015, 0.02]) {
        for (const sym of long) {
          const tr = sim(sym, series.get(sym)!, kind, stop, risk);
          const sc = score(tr, calDays, 1);
          if (sc && sc.avgSignalDayRs > 200) {
            rows.push({ id: `${sym}|${kind}|s${stop}|r${risk}`, members: [sym], ...sc });
          }
        }
        // full long basket
        const allTr: Trade[] = [];
        for (const sym of long) allTr.push(...sim(sym, series.get(sym)!, kind, stop, risk));
        for (const maxPerDay of [1, 2, 3, 4]) {
          const sc = score(allTr, calDays, maxPerDay);
          if (sc && sc.avgCalendarDayRs > 50) {
            rows.push({
              id: `BASKET8|${kind}|s${stop}|r${risk}|max${maxPerDay}`,
              members: long,
              ...sc,
            });
          }
        }
      }
    }
  }

  // 2) Gap book denser — all mid symbols 2025+, pick top N by single quality then portfolio
  const gapSingles: Array<{ sym: string; kind: string; gap: number; stop: number; risk: number; sc: NonNullable<ReturnType<typeof score>>; trades: Trade[] }> = [];
  for (const sym of mid) {
    const days = series.get(sym)!;
    for (const kind of ['GAP_FADE', 'GAP_BOUNCE']) {
      for (const gap of [0.005, 0.008, 0.01]) {
        for (const stop of [0.01, 0.012, 0.015]) {
          for (const risk of [0.02, 0.025]) {
            const trades = sim(sym, days, kind, stop, risk, gap);
            const calM = new Set(days.map((c) => dayKey(c.date))).size;
            const sc = score(trades, Math.min(calDays, calM), 1);
            if (sc && sc.avgSignalDayRs >= 400 && sc.greenPct >= 55) {
              gapSingles.push({ sym, kind, gap, stop, risk, sc, trades });
            }
          }
        }
      }
    }
  }
  gapSingles.sort((a, b) => b.sc.avgSignalDayRs - a.sc.avgSignalDayRs);
  console.log(`strong gap singles: ${gapSingles.length}`);

  // unique best per symbol
  const bestSym = new Map<string, (typeof gapSingles)[0]>();
  for (const g of gapSingles) {
    if (!bestSym.has(g.sym)) bestSym.set(g.sym, g);
  }
  const topSyms = [...bestSym.values()].slice(0, 20);
  console.log('top gap symbols:', topSyms.map((t) => `${t.sym}:${t.sc.avgSignalDayRs}`).join(', '));

  // portfolios of size 4,6,8,10,12 from top
  for (const n of [4, 6, 8, 10, 12]) {
    const pick = topSyms.slice(0, n);
    if (pick.length < n) continue;
    const allTr: Trade[] = [];
    for (const p of pick) allTr.push(...p.trades);
    for (const maxPerDay of [2, 3, 4]) {
      // calendar from mid sample ~2025-2026
      const cal2 = new Set<string>();
      for (const p of pick) for (const c of series.get(p.sym)!) cal2.add(dayKey(c.date));
      const cal2n = [...cal2].filter((d) => weekday(d) >= 1 && weekday(d) <= 5).length;
      const sc = score(allTr, cal2n, maxPerDay);
      if (sc) {
        rows.push({
          id: `GAPPORT${n}|max${maxPerDay}|` + pick.map((p) => p.sym).join('+'),
          members: pick.map(
            (p) => `${p.sym}|${p.kind}|g${p.gap}|s${p.stop}|r${p.risk}`,
          ),
          ...sc,
        });
      }
    }
  }

  rows.sort(
    (a, b) =>
      b.avgCalendarDayRs - a.avgCalendarDayRs ||
      b.avgSignalDayRs - a.avgSignalDayRs ||
      b.greenPct - a.greenPct,
  );

  const hitCal300 = rows.filter((r) => r.avgCalendarDayRs >= 300 && r.greenPct >= 52);
  const hitCal200 = rows.filter((r) => r.avgCalendarDayRs >= 200 && r.greenPct >= 52);
  const hitSig500 = rows.filter((r) => r.avgSignalDayRs >= 500 && r.greenPct >= 55);

  console.log('\n=== Best calendar avg ===');
  for (const r of rows.slice(0, 15)) {
    console.log(
      `cal₹${r.avgCalendarDayRs} sig₹${r.avgSignalDayRs} green${r.greenPct}% hit${r.hit500Pct}% days${r.signalDays} worst${r.worstDay} | ${r.id.slice(0, 100)}`,
    );
  }
  console.log(`\ncal≥300 & green≥52: ${hitCal300.length}`);
  console.log(`cal≥200 & green≥52: ${hitCal200.length}`);
  console.log(`sig≥500 & green≥55: ${hitSig500.length}`);
  for (const r of hitCal300.slice(0, 8)) {
    console.log('HIT300', r.id, r);
  }
  for (const r of hitCal200.slice(0, 8)) {
    console.log('HIT200', r.id.slice(0, 120), `cal${r.avgCalendarDayRs} sig${r.avgSignalDayRs} g${r.greenPct}`);
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        calDays,
        top: rows.slice(0, 40),
        hitCal300: hitCal300.slice(0, 20),
        hitCal200: hitCal200.slice(0, 20),
        hitSig500: hitSig500.slice(0, 20),
        topGapSymbols: topSyms.slice(0, 15).map((t) => ({
          sym: t.sym,
          kind: t.kind,
          gap: t.gap,
          stop: t.stop,
          risk: t.risk,
          ...t.sc,
        })),
      },
      null,
      2,
    ),
  );
  console.log('Wrote', OUT);
}

main();

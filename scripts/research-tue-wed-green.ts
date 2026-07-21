/**
 * Hunt strategies that print GREEN on Tuesday + Wednesday for the treasure book.
 *   npx tsx scripts/research-tue-wed-green.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CACHE = join(root, 'reports/analyst-cache/stocks-day-2020');
const OUT = join(root, 'reports/tue-wed-green-hunt.json');
const DOC = join(root, 'docs/owner-private/09-TUE-WED-GREEN.md');

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
const MAX_DAY_LOSS = 2_400;

type Candle = { date: string; open: number; high: number; low: number; close: number };
type Dir = 'BUY' | 'SELL';
type Trade = {
  date: string;
  symbol: string;
  dir: Dir;
  pnlRs: number;
  gapAbs: number;
};

function dayKey(iso: string) {
  return iso.slice(0, 10);
}
function weekday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay(); // 2=Tue 3=Wed
}
function qty(entry: number, stop: number, riskPct: number) {
  const r = Math.abs(entry - stop);
  if (r < 0.05) return 0;
  return Math.max(
    0,
    Math.min(Math.floor((CAPITAL * riskPct) / r), Math.floor((CAPITAL * 1.5) / entry)),
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

type Kind = 'GAP_FADE' | 'GAP_BOUNCE' | 'FADE_COLOR' | 'FOLLOW_COLOR' | 'MIX_FADE_BOUNCE';

function collect(
  series: Map<string, Candle[]>,
  kind: Kind,
  gapPct: number,
  stopPct: number,
  targetPct: number,
  riskPct: number,
): Trade[] {
  const out: Trade[] = [];
  for (const sym of BOOK) {
    const days = series.get(sym)!;
    for (let i = 1; i < days.length; i += 1) {
      const d = days[i]!;
      const prev = days[i - 1]!;
      const date = dayKey(d.date);
      const wd = weekday(date);
      if (wd !== 2 && wd !== 3) continue; // Tue/Wed only

      let dir: Dir | null = null;
      let gapAbs = 0;
      const gap = (d.open - prev.close) / prev.close;

      if (kind === 'GAP_FADE') {
        if (gap <= gapPct) continue;
        dir = 'SELL';
        gapAbs = gap;
      } else if (kind === 'GAP_BOUNCE') {
        if (gap >= -gapPct) continue;
        dir = 'BUY';
        gapAbs = -gap;
      } else if (kind === 'MIX_FADE_BOUNCE') {
        if (gap > gapPct) {
          dir = 'SELL';
          gapAbs = gap;
        } else if (gap < -gapPct) {
          dir = 'BUY';
          gapAbs = -gap;
        } else continue;
      } else if (kind === 'FADE_COLOR') {
        dir = prev.close >= prev.open ? 'SELL' : 'BUY';
        gapAbs = Math.abs(prev.close - prev.open) / prev.close;
      } else if (kind === 'FOLLOW_COLOR') {
        dir = prev.close >= prev.open ? 'BUY' : 'SELL';
        gapAbs = Math.abs(prev.close - prev.open) / prev.close;
      }
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
      } else if (targetPct > 0) {
        const tp = dir === 'BUY' ? d.open * (1 + targetPct) : d.open * (1 - targetPct);
        if (dir === 'BUY' && d.high >= tp) {
          exit = tp;
          pts = exit - d.open;
        } else if (dir === 'SELL' && d.low <= tp) {
          exit = tp;
          pts = d.open - exit;
        }
      }
      out.push({ date, symbol: sym, dir, pnlRs: pts * q, gapAbs });
    }
  }
  return out;
}

function applyMax(trades: Trade[], maxN: number): Trade[] {
  const by = new Map<string, Trade[]>();
  for (const t of trades) {
    const a = by.get(t.date) ?? [];
    a.push(t);
    by.set(t.date, a);
  }
  const out: Trade[] = [];
  for (const [, arr] of by) {
    arr.sort((a, b) => b.gapAbs - a.gapAbs || a.symbol.localeCompare(b.symbol));
    out.push(...arr.slice(0, maxN));
  }
  return out;
}

type Score = {
  id: string;
  signalDays: number;
  tueDays: number;
  wedDays: number;
  green: number;
  red: number;
  greenPct: number;
  tueGreenPct: number;
  wedGreenPct: number;
  bothGreenHint: string;
  avgDay: number;
  totalNet: number;
  worst: number;
  best: number;
  hit500Pct: number;
  score: number;
};

function score(id: string, trades: Trade[], allTueWedDates: string[]): Score | null {
  const by = new Map<string, number>();
  for (const t of trades) {
    by.set(t.date, (by.get(t.date) ?? 0) + t.pnlRs);
  }
  // Include only days with signals for green% — also compute coverage of all Tue/Wed
  const vals: Array<{ date: string; v: number; wd: number }> = [];
  for (const [date, v0] of by) {
    let v = v0;
    if (v < -MAX_DAY_LOSS) v = -MAX_DAY_LOSS;
    vals.push({ date, v, wd: weekday(date) });
  }
  if (vals.length < 40) return null;

  let green = 0;
  let red = 0;
  let tueG = 0;
  let tueN = 0;
  let wedG = 0;
  let wedN = 0;
  let hit500 = 0;
  let total = 0;
  for (const { v, wd } of vals) {
    total += v;
    if (v > 0) green += 1;
    else if (v < 0) red += 1;
    if (v >= 500) hit500 += 1;
    if (wd === 2) {
      tueN += 1;
      if (v > 0) tueG += 1;
    }
    if (wd === 3) {
      wedN += 1;
      if (v > 0) wedG += 1;
    }
  }
  const greenPct = (100 * green) / vals.length;
  const tueGreenPct = tueN ? (100 * tueG) / tueN : 0;
  const wedGreenPct = wedN ? (100 * wedG) / wedN : 0;
  const avgDay = total / vals.length;

  // Pair weeks: for each ISO week, was Tue green AND Wed green when both had signals?
  const byWeek = new Map<string, { tue?: number; wed?: number }>();
  for (const { date, v } of vals) {
    const dt = new Date(date + 'T12:00:00');
    const week = `${dt.getFullYear()}-W${Math.ceil((((dt.getTime() - new Date(dt.getFullYear(), 0, 1).getTime()) / 86400000) + new Date(dt.getFullYear(), 0, 1).getDay() + 1) / 7)}`;
    const slot = byWeek.get(week) ?? {};
    const wd = weekday(date);
    if (wd === 2) slot.tue = v;
    if (wd === 3) slot.wed = v;
    byWeek.set(week, slot);
  }
  let bothOk = 0;
  let bothN = 0;
  for (const s of byWeek.values()) {
    if (s.tue === undefined || s.wed === undefined) continue;
    bothN += 1;
    if (s.tue > 0 && s.wed > 0) bothOk += 1;
  }
  const bothPct = bothN ? (100 * bothOk) / bothN : 0;

  let sc = 0;
  sc += greenPct * 200;
  sc += Math.min(tueGreenPct, wedGreenPct) * 250; // balance Tue & Wed
  sc += bothPct * 180;
  sc += Math.min(avgDay, 1500) * 30;
  if (greenPct >= 65) sc += 30_000;
  if (greenPct >= 70) sc += 40_000;
  if (Math.min(tueGreenPct, wedGreenPct) >= 65) sc += 35_000;
  if (bothPct >= 50) sc += 25_000;
  if (avgDay < 0) sc -= 100_000;

  return {
    id,
    signalDays: vals.length,
    tueDays: tueN,
    wedDays: wedN,
    green,
    red,
    greenPct: Math.round(greenPct * 10) / 10,
    tueGreenPct: Math.round(tueGreenPct * 10) / 10,
    wedGreenPct: Math.round(wedGreenPct * 10) / 10,
    bothGreenHint: `${bothOk}/${bothN} weeks both green (${bothPct.toFixed(0)}%)`,
    avgDay: Math.round(avgDay),
    totalNet: Math.round(total),
    worst: Math.round(Math.min(...vals.map((x) => x.v))),
    best: Math.round(Math.max(...vals.map((x) => x.v))),
    hit500Pct: Math.round((100 * hit500) / vals.length * 10) / 10,
    score: sc,
  };
}

/** Recent window: Jun 2025 + Jun 2026 Tue/Wed detail for champion */
function detailMonth(
  series: Map<string, Candle[]>,
  trades: Trade[],
  yyyyMm: string,
): Array<{ date: string; wd: string; net: number; n: number }> {
  const by = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!t.date.startsWith(yyyyMm)) continue;
    const a = by.get(t.date) ?? [];
    a.push(t);
    by.set(t.date, a);
  }
  const rows = [];
  for (const [date, arr] of [...by.entries()].sort()) {
    let net = arr.reduce((s, t) => s + t.pnlRs, 0);
    if (net < -MAX_DAY_LOSS) net = -MAX_DAY_LOSS;
    const wd = weekday(date) === 2 ? 'Tue' : 'Wed';
    rows.push({ date, wd, net: Math.round(net), n: arr.length });
  }
  return rows;
}

function main() {
  const series = load();
  const kinds: Kind[] = ['GAP_FADE', 'GAP_BOUNCE', 'MIX_FADE_BOUNCE', 'FADE_COLOR', 'FOLLOW_COLOR'];
  const gaps = [0.003, 0.005, 0.008, 0.01, 0.015, 0.02];
  const stops = [0.008, 0.01, 0.012, 0.015, 0.02];
  const targets = [0, 0.008, 0.01, 0.015];
  const risks = [0.015, 0.02, 0.025];
  const maxNs = [1, 2, 3];

  const scores: Score[] = [];
  const tradeCache = new Map<string, Trade[]>();

  for (const kind of kinds) {
    for (const gapPct of kind.includes('GAP') || kind === 'MIX_FADE_BOUNCE' ? gaps : [0]) {
      for (const stopPct of stops) {
        for (const targetPct of targets) {
          for (const riskPct of risks) {
            const raw = collect(series, kind, gapPct, stopPct, targetPct, riskPct);
            for (const maxN of maxNs) {
              const id = `${kind}|g${gapPct}|s${stopPct}|t${targetPct}|r${riskPct}|max${maxN}`;
              const capped = applyMax(raw, maxN);
              tradeCache.set(id, capped);
              const sc = score(id, capped, []);
              if (sc) scores.push(sc);
            }
          }
        }
      }
    }
  }

  scores.sort((a, b) => b.score - a.score);

  // Prefer: high green on BOTH Tue and Wed
  const balanced = [...scores]
    .filter((s) => s.avgDay > 0 && s.signalDays >= 60)
    .sort(
      (a, b) =>
        Math.min(b.tueGreenPct, b.wedGreenPct) - Math.min(a.tueGreenPct, a.wedGreenPct) ||
        b.greenPct - a.greenPct ||
        b.avgDay - a.avgDay,
    );

  const ultra = balanced.filter(
    (s) => Math.min(s.tueGreenPct, s.wedGreenPct) >= 65 && s.greenPct >= 65,
  );
  const good = balanced.filter(
    (s) => Math.min(s.tueGreenPct, s.wedGreenPct) >= 60 && s.greenPct >= 60,
  );

  console.log(`Scored ${scores.length} Tue/Wed combos`);
  console.log(`\n=== Best balanced Tue+Wed green ===`);
  for (const s of balanced.slice(0, 15)) {
    console.log(
      `g${s.greenPct}% tue${s.tueGreenPct}% wed${s.wedGreenPct}% avg₹${s.avgDay} ${s.bothGreenHint} days${s.signalDays} worst${s.worst} | ${s.id}`,
    );
  }
  console.log(`\n≥65% both Tue&Wed & overall: ${ultra.length}`);
  for (const s of ultra.slice(0, 10)) {
    console.log('ULTRA', s.id, `g${s.greenPct} tue${s.tueGreenPct} wed${s.wedGreenPct} avg${s.avgDay}`);
  }
  console.log(`≥60% both: ${good.length}`);
  for (const s of good.slice(0, 10)) {
    console.log('GOOD', s.id, `g${s.greenPct} tue${s.tueGreenPct} wed${s.wedGreenPct} avg${s.avgDay}`);
  }

  const champ = ultra[0] ?? good[0] ?? balanced[0]!;
  const champTrades = tradeCache.get(champ.id)!;

  console.log(`\n===== CHAMPION: ${champ.id} =====`);
  console.log(JSON.stringify(champ, null, 2));

  // Jun 2025 / Jun 2026 Tue+Wed only
  for (const mm of ['2025-06', '2026-06']) {
    const rows = detailMonth(series, champTrades, mm);
    console.log(`\n── ${mm} Tue/Wed with champion ──`);
    let g = 0;
    let r = 0;
    let net = 0;
    for (const row of rows) {
      const tag = row.net > 0 ? 'GREEN' : row.net < 0 ? 'RED  ' : 'FLAT ';
      if (row.net > 0) g += 1;
      else if (row.net < 0) r += 1;
      net += row.net;
      console.log(`${row.date} ${row.wd} ${tag} ₹${row.net >= 0 ? '+' : ''}${row.net} (${row.n} trades)`);
    }
    console.log(`Month Tue/Wed: ${g} green / ${r} red · net ₹${net >= 0 ? '+' : ''}${net}`);
  }

  // Also show current GAP_FADE_500 Tue/Wed only baseline
  const baselineId = 'GAP_FADE|g0.003|s0.015|t0|r0.025|max3';
  const base = scores.find((s) => s.id === baselineId);
  console.log('\nBaseline GAP_FADE_500 on Tue/Wed only:', base);

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        champion: champ,
        ultra: ultra.slice(0, 20),
        good: good.slice(0, 20),
        topBalanced: balanced.slice(0, 30),
        baselineTueWed: base,
        jun2025: detailMonth(series, champTrades, '2025-06'),
        jun2026: detailMonth(series, champTrades, '2026-06'),
      },
      null,
      2,
    ),
  );

  const lines = [
    '# Tuesday + Wednesday green hunt',
    '',
    `**Date:** ${new Date().toISOString()}`,
    '**Universe:** treasure 8 · Tue+Wed only · honest open gap-rank',
    '',
    '## Champion',
    `\`${champ.id}\``,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Overall green (Tue+Wed signal days) | **${champ.greenPct}%** |`,
    `| Tuesday green | **${champ.tueGreenPct}%** |`,
    `| Wednesday green | **${champ.wedGreenPct}%** |`,
    `| Weeks both Tue & Wed green | ${champ.bothGreenHint} |`,
    `| Avg signal day | ₹${champ.avgDay} |`,
    `| Total net | ₹${champ.totalNet} |`,
    `| Worst day | ₹${champ.worst} |`,
    '',
    ultra.length
      ? 'Strict ≥65% on both Tue and Wed: **FOUND**'
      : good.length
        ? 'Strict ≥65% both: not found · best ≥60% band used'
        : 'Could not reach 60% on both weekdays',
    '',
    'JSON: `reports/tue-wed-green-hunt.json`',
  ];
  writeFileSync(DOC, lines.join('\n'));
  console.log('\nWrote', OUT);
}

main();

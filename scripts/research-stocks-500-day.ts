/**
 * Hunt for ~₹500 / day equity strategies (₹60k capital).
 * Offline on cached day bars — combos of gap/stop/target/weekday/portfolio.
 *
 *   npx tsx scripts/research-stocks-500-day.ts
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CACHE_2020 = join(root, 'reports/analyst-cache/stocks-day-2020');
const CACHE_2025 = join(root, 'reports/analyst-cache/stocks-day');
const OUT = join(root, 'reports/stocks-500-day-hunt.json');
const DOC = join(root, 'docs/owner-private/08-STOCKS-500-DAY-HUNT.md');

const CAPITAL = 60_000;
const TARGET_AVG_DAY = 500;
const MAX_DAY_LOSS = 2_400;
const MIN_SIGNAL_DAYS = 80;

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Dir = 'BUY' | 'SELL';

type Trade = {
  symbol: string;
  date: string;
  dir: Dir;
  pnlRs: number;
  dna: string;
};

type Dna = {
  id: string;
  symbol: string;
  kind:
    | 'GAP_FADE'
    | 'GAP_BOUNCE'
    | 'FOLLOW_COLOR'
    | 'FADE_COLOR'
    | 'PDHL_CONT'
    | 'INSIDE_BREAK'
    | 'RANGE_FADE';
  gapPct: number; // 0 for non-gap
  stopPct: number;
  targetPct: number; // 0 = hold EOD only
  riskPct: number;
  weekdays: number[] | null; // 1=Mon..5=Fri, null=all
};

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function weekday(iso: string): number {
  // UTC-safe: use local from date parts
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay(); // 0 Sun
}

function qtyForRisk(entry: number, stop: number, riskPct: number): number {
  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare < 0.05) return 0;
  const riskRs = CAPITAL * riskPct;
  const q = Math.floor(riskRs / riskPerShare);
  const maxQty = Math.floor((CAPITAL * 1.5) / entry);
  return Math.max(0, Math.min(q, maxQty));
}

function loadSeries(): Map<string, Candle[]> {
  const map = new Map<string, Candle[]>();
  if (existsSync(CACHE_2020)) {
    for (const f of readdirSync(CACHE_2020)) {
      if (!f.endsWith('.json')) continue;
      const sym = f.split('_')[0]!;
      map.set(sym, JSON.parse(readFileSync(join(CACHE_2020, f), 'utf8')) as Candle[]);
    }
  }
  // Fill missing from 2025 cache (shorter history OK)
  if (existsSync(CACHE_2025)) {
    for (const f of readdirSync(CACHE_2025)) {
      if (!f.endsWith('.json')) continue;
      const sym = f.split('_')[0]!;
      if (map.has(sym)) continue;
      const raw = readFileSync(join(CACHE_2025, f), 'utf8').trim();
      if (!raw) continue;
      try {
        map.set(sym, JSON.parse(raw) as Candle[]);
      } catch {
        /* skip */
      }
    }
  }
  return map;
}

function simulateDna(days: Candle[], dna: Dna): Trade[] {
  const out: Trade[] = [];
  for (let i = 2; i < days.length; i += 1) {
    const d = days[i]!;
    const prev = days[i - 1]!;
    const prev2 = days[i - 2]!;
    const date = dayKey(d.date);
    const wd = weekday(date);
    if (wd === 0 || wd === 6) continue;
    if (dna.weekdays && !dna.weekdays.includes(wd)) continue;

    let dir: Dir | null = null;
    switch (dna.kind) {
      case 'GAP_FADE': {
        if (d.open <= prev.close * (1 + dna.gapPct)) break;
        dir = 'SELL';
        break;
      }
      case 'GAP_BOUNCE': {
        if (d.open >= prev.close * (1 - dna.gapPct)) break;
        dir = 'BUY';
        break;
      }
      case 'FOLLOW_COLOR': {
        dir = prev.close >= prev.open ? 'BUY' : 'SELL';
        break;
      }
      case 'FADE_COLOR': {
        dir = prev.close >= prev.open ? 'SELL' : 'BUY';
        break;
      }
      case 'PDHL_CONT': {
        if (prev.close > prev2.high && prev.close > prev.open) dir = 'BUY';
        else if (prev.close < prev2.low && prev.close < prev.open) dir = 'SELL';
        break;
      }
      case 'INSIDE_BREAK': {
        const ra = prev2.high - prev2.low;
        const rb = prev.high - prev.low;
        if (rb >= ra * 0.7) break;
        if (d.open > prev.high) dir = 'BUY';
        else if (d.open < prev.low) dir = 'SELL';
        break;
      }
      case 'RANGE_FADE': {
        const mid = (prev.high + prev.low) / 2;
        if (d.open > prev.high) dir = 'SELL';
        else if (d.open < prev.low) dir = 'BUY';
        else if (d.open > mid * 1.005) dir = 'SELL';
        else if (d.open < mid * 0.995) dir = 'BUY';
        break;
      }
    }
    if (!dir) continue;

    const stop = dir === 'BUY' ? d.open * (1 - dna.stopPct) : d.open * (1 + dna.stopPct);
    const qty = qtyForRisk(d.open, stop, dna.riskPct);
    if (qty < 1) continue;

    let exit = d.close;
    let pts = dir === 'BUY' ? exit - d.open : d.open - exit;

    // Stop first (conservative)
    if (dir === 'BUY' && d.low <= stop) {
      exit = stop;
      pts = exit - d.open;
    } else if (dir === 'SELL' && d.high >= stop) {
      exit = stop;
      pts = d.open - exit;
    } else if (dna.targetPct > 0) {
      const tp = dir === 'BUY' ? d.open * (1 + dna.targetPct) : d.open * (1 - dna.targetPct);
      if (dir === 'BUY' && d.high >= tp) {
        exit = tp;
        pts = exit - d.open;
      } else if (dir === 'SELL' && d.low <= tp) {
        exit = tp;
        pts = d.open - exit;
      }
    }

    out.push({
      symbol: dna.symbol,
      date,
      dir,
      pnlRs: pts * qty,
      dna: dna.id,
    });
  }
  return out;
}

type Score = {
  id: string;
  label: string;
  trades: number;
  signalDays: number;
  calendarDays: number;
  greenDays: number;
  redDays: number;
  greenPct: number;
  avgSignalDayRs: number;
  avgCalendarDayRs: number;
  medianSignalDayRs: number;
  totalNet: number;
  worstDay: number;
  bestDay: number;
  daysHit500: number;
  hit500Pct: number;
  score: number;
  members?: string[];
};

function dayNets(trades: Trade[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trades) {
    m.set(t.date, (m.get(t.date) ?? 0) + t.pnlRs);
  }
  // Apply soft day loss clip for portfolio realism
  for (const [d, v] of m) {
    if (v < -MAX_DAY_LOSS) m.set(d, -MAX_DAY_LOSS);
  }
  return m;
}

function scoreBook(
  id: string,
  label: string,
  trades: Trade[],
  calendarDays: number,
  members?: string[],
): Score | null {
  if (trades.length < 30) return null;
  const nets = dayNets(trades);
  const signalDays = nets.size;
  if (signalDays < MIN_SIGNAL_DAYS) return null;
  const vals = [...nets.values()];
  let green = 0;
  let red = 0;
  let hit500 = 0;
  let total = 0;
  for (const v of vals) {
    total += v;
    if (v > 0) green += 1;
    else if (v < 0) red += 1;
    if (v >= TARGET_AVG_DAY) hit500 += 1;
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const avgSignal = total / signalDays;
  const avgCal = total / Math.max(1, calendarDays);
  const greenPct = (100 * green) / signalDays;
  const worst = Math.min(...vals);
  const best = Math.max(...vals);
  const hit500Pct = (100 * hit500) / signalDays;

  // Prefer: avg signal day near/above 500, high green%, calendar avg, hit rate, not terrible worst
  let score = 0;
  score += Math.min(avgSignal, 1500) * 40;
  score += Math.min(avgCal, 800) * 80;
  score += greenPct * 120;
  score += hit500Pct * 90;
  score += Math.min(median, 1200) * 25;
  if (avgSignal >= TARGET_AVG_DAY) score += 50_000;
  if (avgCal >= TARGET_AVG_DAY * 0.5) score += 25_000;
  if (greenPct >= 55) score += 20_000;
  if (worst < -MAX_DAY_LOSS * 0.95) score -= 15_000;
  if (avgSignal < 0) score -= 100_000;

  return {
    id,
    label,
    trades: trades.length,
    signalDays,
    calendarDays,
    greenDays: green,
    redDays: red,
    greenPct: Math.round(greenPct * 10) / 10,
    avgSignalDayRs: Math.round(avgSignal),
    avgCalendarDayRs: Math.round(avgCal),
    medianSignalDayRs: Math.round(median),
    totalNet: Math.round(total),
    worstDay: Math.round(worst),
    bestDay: Math.round(best),
    daysHit500: hit500,
    hit500Pct: Math.round(hit500Pct * 10) / 10,
    score,
    members,
  };
}

function buildDnas(symbols: string[]): Dna[] {
  const gaps = [0.003, 0.005, 0.008, 0.01, 0.015, 0.02];
  const stops = [0.008, 0.01, 0.012, 0.015, 0.02];
  const targets = [0, 0.006, 0.01, 0.015, 0.02];
  const risks = [0.015, 0.02, 0.025];
  const weekdaySets: Array<number[] | null> = [
    null,
    [1, 2, 3, 4, 5],
    [2, 3, 4], // Tue-Thu
    [1, 3, 5], // MWF
    [2, 4], // Tue Thu
  ];

  const out: Dna[] = [];
  for (const symbol of symbols) {
    for (const gapPct of gaps) {
      for (const stopPct of stops) {
        for (const targetPct of targets) {
          for (const riskPct of risks) {
            for (const weekdays of weekdaySets) {
              // Skip silly: target tighter than stop noise only when target>0
              if (targetPct > 0 && targetPct < stopPct * 0.4) continue;
              for (const kind of ['GAP_FADE', 'GAP_BOUNCE'] as const) {
                const wdTag = weekdays ? weekdays.join('') : 'ALL';
                out.push({
                  id: `${symbol}|${kind}|g${gapPct}|s${stopPct}|t${targetPct}|r${riskPct}|w${wdTag}`,
                  symbol,
                  kind,
                  gapPct,
                  stopPct,
                  targetPct,
                  riskPct,
                  weekdays,
                });
              }
            }
          }
        }
      }
    }
    // Non-gap kinds (fewer params)
    for (const kind of ['FOLLOW_COLOR', 'FADE_COLOR', 'PDHL_CONT', 'INSIDE_BREAK', 'RANGE_FADE'] as const) {
      for (const stopPct of [0.01, 0.015]) {
        for (const targetPct of [0, 0.01, 0.015]) {
          for (const riskPct of [0.02]) {
            for (const weekdays of [null, [2, 3, 4]] as Array<number[] | null>) {
              const wdTag = weekdays ? weekdays.join('') : 'ALL';
              out.push({
                id: `${symbol}|${kind}|g0|s${stopPct}|t${targetPct}|r${riskPct}|w${wdTag}`,
                symbol,
                kind,
                gapPct: 0,
                stopPct,
                targetPct,
                riskPct,
                weekdays,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

function main() {
  const series = loadSeries();
  const symbols = [...series.keys()].sort();
  console.log(`Loaded ${symbols.length} symbols`);

  // Prefer long-history names for primary hunt
  const longSyms = symbols.filter((s) => (series.get(s)?.length ?? 0) >= 1000);
  const huntSyms = longSyms.length ? longSyms : symbols.slice(0, 12);
  console.log(`Hunting on: ${huntSyms.join(', ')}`);

  // Calendar span from union of long series
  const calSet = new Set<string>();
  for (const s of huntSyms) {
    for (const c of series.get(s)!) calSet.add(dayKey(c.date));
  }
  const calendarDays = [...calSet].filter((d) => {
    const w = weekday(d);
    return w >= 1 && w <= 5;
  }).length;

  const dnas = buildDnas(huntSyms);
  console.log(`DNA combos: ${dnas.length}`);

  const singleScores: Score[] = [];
  const tradeCache = new Map<string, Trade[]>();

  let i = 0;
  for (const dna of dnas) {
    i += 1;
    if (i % 2000 === 0) console.log(`  … ${i}/${dnas.length}`);
    const days = series.get(dna.symbol)!;
    const trades = simulateDna(days, dna);
    tradeCache.set(dna.id, trades);
    const sc = scoreBook(dna.id, dna.id, trades, calendarDays, [dna.id]);
    if (sc && sc.avgSignalDayRs > 0) singleScores.push(sc);
  }

  singleScores.sort((a, b) => b.score - a.score);
  const topSingles = singleScores.slice(0, 40);
  console.log(`Profitable singles: ${singleScores.length} · top avgSignal=${topSingles[0]?.avgSignalDayRs}`);

  // Portfolio: combine top DNAs across different symbols (max 1 DNA per symbol)
  const portfolioScores: Score[] = [];
  const topPerSymbol = new Map<string, Score[]>();
  for (const sc of singleScores) {
    const sym = sc.id.split('|')[0]!;
    const arr = topPerSymbol.get(sym) ?? [];
    if (arr.length < 8) {
      arr.push(sc);
      topPerSymbol.set(sym, arr);
    }
  }

  const pools = [...topPerSymbol.values()];
  // Greedy: start from best overall and add complementary symbols
  function evaluatePortfolio(memberIds: string[]): Score | null {
    const trades: Trade[] = [];
    for (const id of memberIds) {
      const t = tradeCache.get(id);
      if (t) trades.push(...t);
    }
    // Cap to 3 trades/day: keep highest |expected| — use first 3 by |pnl| after sorting abs
    const byDay = new Map<string, Trade[]>();
    for (const t of trades) {
      const arr = byDay.get(t.date) ?? [];
      arr.push(t);
      byDay.set(t.date, arr);
    }
    const capped: Trade[] = [];
    for (const [, arr] of byDay) {
      arr.sort((a, b) => Math.abs(b.pnlRs) - Math.abs(a.pnlRs));
      capped.push(...arr.slice(0, 3));
    }
    return scoreBook(
      `PORT:${memberIds.length}:${memberIds.map((x) => x.split('|')[0]).join('+')}`,
      memberIds.join(' || '),
      capped,
      calendarDays,
      memberIds,
    );
  }

  // All pairs / triples from top-3 per symbol
  const candLists = huntSyms.map((s) => (topPerSymbol.get(s) ?? []).slice(0, 3));
  // Pairs
  for (let a = 0; a < huntSyms.length; a += 1) {
    for (let b = a + 1; b < huntSyms.length; b += 1) {
      for (const sa of candLists[a] ?? []) {
        for (const sb of candLists[b] ?? []) {
          const sc = evaluatePortfolio([sa.id, sb.id]);
          if (sc) portfolioScores.push(sc);
        }
      }
    }
  }
  // Triples (sample to keep runtime sane)
  let tripleN = 0;
  for (let a = 0; a < huntSyms.length; a += 1) {
    for (let b = a + 1; b < huntSyms.length; b += 1) {
      for (let c = b + 1; c < huntSyms.length; c += 1) {
        for (const sa of (candLists[a] ?? []).slice(0, 2)) {
          for (const sb of (candLists[b] ?? []).slice(0, 2)) {
            for (const sc0 of (candLists[c] ?? []).slice(0, 2)) {
              const sc = evaluatePortfolio([sa.id, sb.id, sc0.id]);
              if (sc) portfolioScores.push(sc);
              tripleN += 1;
              if (tripleN > 2500) break;
            }
            if (tripleN > 2500) break;
          }
          if (tripleN > 2500) break;
        }
        if (tripleN > 2500) break;
      }
      if (tripleN > 2500) break;
    }
    if (tripleN > 2500) break;
  }

  // Quad: best 4 singles different symbols by avgSignal
  const bestBySym = huntSyms
    .map((s) => topPerSymbol.get(s)?.[0])
    .filter(Boolean) as Score[];
  bestBySym.sort((a, b) => b.avgSignalDayRs - a.avgSignalDayRs);
  if (bestBySym.length >= 4) {
    const sc = evaluatePortfolio(bestBySym.slice(0, 4).map((x) => x.id));
    if (sc) portfolioScores.push(sc);
  }
  if (bestBySym.length >= 5) {
    const sc = evaluatePortfolio(bestBySym.slice(0, 5).map((x) => x.id));
    if (sc) portfolioScores.push(sc);
  }
  if (bestBySym.length >= 6) {
    const sc = evaluatePortfolio(bestBySym.slice(0, 6).map((x) => x.id));
    if (sc) portfolioScores.push(sc);
  }

  portfolioScores.sort((a, b) => b.score - a.score);

  const hit500 = [...singleScores, ...portfolioScores]
    .filter((s) => s.avgSignalDayRs >= TARGET_AVG_DAY && s.greenPct >= 50)
    .sort((a, b) => b.score - a.score);

  const near500 = [...singleScores, ...portfolioScores]
    .filter((s) => s.avgSignalDayRs >= 350 && s.greenPct >= 52)
    .sort((a, b) => b.avgSignalDayRs - a.avgSignalDayRs || b.greenPct - a.greenPct);

  console.log('\n=== HIT avgSignal ≥ ₹500 & green≥50% ===');
  for (const s of hit500.slice(0, 15)) {
    console.log(
      `${s.avgSignalDayRs} avg · cal ${s.avgCalendarDayRs} · green ${s.greenPct}% · hit500 ${s.hit500Pct}% · worst ${s.worstDay} · ${s.id.slice(0, 100)}`,
    );
  }
  if (!hit500.length) console.log('(none strict)');

  console.log('\n=== NEAR (≥₹350 avg signal, green≥52%) ===');
  for (const s of near500.slice(0, 20)) {
    console.log(
      `${s.avgSignalDayRs} avg · cal ${s.avgCalendarDayRs} · green ${s.greenPct}% · days ${s.signalDays} · ${s.id.slice(0, 110)}`,
    );
  }

  console.log('\n=== TOP PORTFOLIOS ===');
  for (const s of portfolioScores.slice(0, 12)) {
    console.log(
      `${s.avgSignalDayRs} avg · cal ${s.avgCalendarDayRs} · green ${s.greenPct}% · hit500 ${s.hit500Pct}% · net ${s.totalNet} · ${s.id}`,
    );
  }

  const champion =
    hit500[0] ??
    near500[0] ??
    portfolioScores[0] ??
    topSingles[0] ??
    null;

  const payload = {
    generatedAt: new Date().toISOString(),
    capital: CAPITAL,
    targetAvgDay: TARGET_AVG_DAY,
    calendarDays,
    symbols: huntSyms,
    dnaCount: dnas.length,
    singlesProfitable: singleScores.length,
    portfoliosScored: portfolioScores.length,
    hit500Count: hit500.length,
    champion,
    topHit500: hit500.slice(0, 25),
    topNear: near500.slice(0, 25),
    topPortfolios: portfolioScores.slice(0, 25),
    topSingles: topSingles.slice(0, 25),
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));

  const lines: string[] = [];
  lines.push('# Stocks ₹500/day hunt');
  lines.push('');
  lines.push(`**Date:** ${payload.generatedAt}`);
  lines.push(`**Capital:** ₹${CAPITAL} · target avg signal-day ₹${TARGET_AVG_DAY}`);
  lines.push(`**Symbols:** ${huntSyms.join(', ')}`);
  lines.push(`**DNA combos:** ${dnas.length} · portfolios scored ${portfolioScores.length}`);
  lines.push('');
  lines.push('## Verdict');
  if (champion) {
    lines.push(
      `Champion: **${champion.id}** · avg signal-day ₹${champion.avgSignalDayRs} · calendar avg ₹${champion.avgCalendarDayRs} · green ${champion.greenPct}% · hit≥500 ${champion.hit500Pct}% · worst ₹${champion.worstDay} · net ₹${champion.totalNet}`,
    );
    if (champion.avgSignalDayRs >= TARGET_AVG_DAY) {
      lines.push('');
      lines.push('Strict ₹500 avg on signal days: **FOUND** (still not every calendar day).');
    } else {
      lines.push('');
      lines.push('Strict ₹500 every day: **not found**. Best realistic is champion above.');
    }
  } else {
    lines.push('No viable champion.');
  }
  lines.push('');
  lines.push('## Top hit/near');
  for (const s of (hit500.length ? hit500 : near500).slice(0, 12)) {
    lines.push(
      `- ₹${s.avgSignalDayRs} avg · cal ₹${s.avgCalendarDayRs} · green ${s.greenPct}% · ${s.id.slice(0, 140)}`,
    );
  }
  lines.push('');
  lines.push(`JSON: \`${OUT.replace(root + '/', '')}\``);
  mkdirSync(dirname(DOC), { recursive: true });
  writeFileSync(DOC, lines.join('\n'));
  console.log(`\nWrote ${OUT}`);
  console.log(`Wrote ${DOC}`);
  if (champion) {
    console.log(
      `\nCHAMPION → avgSignal ₹${champion.avgSignalDayRs} · cal ₹${champion.avgCalendarDayRs} · green ${champion.greenPct}% · ${champion.id}`,
    );
  }
}

main();

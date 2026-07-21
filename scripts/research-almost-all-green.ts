/**
 * Hunt: almost-all-days GREEN at EOD (treasure book).
 * Optimizes calendar green% and signal green%; no EOD look-ahead selection.
 *
 *   npx tsx scripts/research-almost-all-green.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CACHE = join(root, 'reports/analyst-cache/stocks-day-2020');
const OUT = join(root, 'reports/almost-all-green-hunt.json');
const DOC = join(root, 'docs/owner-private/10-ALMOST-ALL-GREEN-STOCKS.md');

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
type Trade = { date: string; symbol: string; dir: Dir; pnlRs: number; rank: number };

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

type Cfg = {
  id: string;
  kind: string;
  gapPct: number;
  stopPct: number;
  targetPct: number;
  riskPct: number;
  maxN: number;
  weekdays: number[] | null;
  /** require prior day same color as trade direction for fade/bounce */
  confirmPrior?: boolean;
  /** min prior day range % */
  minPriorRange?: number;
};

function collect(series: Map<string, Candle[]>, cfg: Cfg): Trade[] {
  const out: Trade[] = [];
  for (const sym of BOOK) {
    const days = series.get(sym)!;
    for (let i = 2; i < days.length; i += 1) {
      const d = days[i]!;
      const prev = days[i - 1]!;
      const prev2 = days[i - 2]!;
      const date = dayKey(d.date);
      const wd = weekday(date);
      if (wd < 1 || wd > 5) continue;
      if (cfg.weekdays && !cfg.weekdays.includes(wd)) continue;

      const gap = (d.open - prev.close) / prev.close;
      const priorRange = (prev.high - prev.low) / prev.close;
      if (cfg.minPriorRange && priorRange < cfg.minPriorRange) continue;

      let dir: Dir | null = null;
      let rank = 0;

      switch (cfg.kind) {
        case 'GAP_FADE':
          if (gap <= cfg.gapPct) break;
          dir = 'SELL';
          rank = gap;
          if (cfg.confirmPrior && !(prev.close > prev.open)) dir = null;
          break;
        case 'GAP_BOUNCE':
          if (gap >= -cfg.gapPct) break;
          dir = 'BUY';
          rank = -gap;
          if (cfg.confirmPrior && !(prev.close < prev.open)) dir = null;
          break;
        case 'MIX_GAP':
          if (gap > cfg.gapPct) {
            dir = 'SELL';
            rank = gap;
          } else if (gap < -cfg.gapPct) {
            dir = 'BUY';
            rank = -gap;
          }
          break;
        case 'FADE_COLOR':
          dir = prev.close >= prev.open ? 'SELL' : 'BUY';
          rank = Math.abs(prev.close - prev.open) / prev.close;
          break;
        case 'FOLLOW_COLOR':
          dir = prev.close >= prev.open ? 'BUY' : 'SELL';
          rank = Math.abs(prev.close - prev.open) / prev.close;
          break;
        case 'PDHL_FADE':
          // fade prior day break: if prev closed above prev2 high, fade short today
          if (prev.close > prev2.high) {
            dir = 'SELL';
            rank = (prev.close - prev2.high) / prev.close;
          } else if (prev.close < prev2.low) {
            dir = 'BUY';
            rank = (prev2.low - prev.close) / prev.close;
          }
          break;
        case 'TIGHT_TP_FADE':
          if (gap <= cfg.gapPct) break;
          dir = 'SELL';
          rank = gap;
          break;
        case 'TIGHT_TP_BOUNCE':
          if (gap >= -cfg.gapPct) break;
          dir = 'BUY';
          rank = -gap;
          break;
      }
      if (!dir) continue;

      const stop = dir === 'BUY' ? d.open * (1 - cfg.stopPct) : d.open * (1 + cfg.stopPct);
      const q = qty(d.open, stop, cfg.riskPct);
      if (q < 1) continue;

      let exit = d.close;
      let pts = dir === 'BUY' ? exit - d.open : d.open - exit;
      // Conservative path: if both SL and TP possible same day, assume SL first when stop hit
      if (dir === 'BUY' && d.low <= stop) {
        exit = stop;
        pts = exit - d.open;
      } else if (dir === 'SELL' && d.high >= stop) {
        exit = stop;
        pts = d.open - exit;
      } else if (cfg.targetPct > 0) {
        const tp = dir === 'BUY' ? d.open * (1 + cfg.targetPct) : d.open * (1 - cfg.targetPct);
        if (dir === 'BUY' && d.high >= tp) {
          exit = tp;
          pts = exit - d.open;
        } else if (dir === 'SELL' && d.low <= tp) {
          exit = tp;
          pts = d.open - exit;
        }
      }

      out.push({ date, symbol: sym, dir, pnlRs: pts * q, rank });
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
    arr.sort((a, b) => b.rank - a.rank || a.symbol.localeCompare(b.symbol));
    out.push(...arr.slice(0, maxN));
  }
  return out;
}

type Score = {
  id: string;
  calendarDays: number;
  signalDays: number;
  coveragePct: number;
  /** green / signal days */
  signalGreenPct: number;
  /** green / all weekdays (flat/no-trade = not green) */
  calendarGreenPct: number;
  /** green / (green+red); sit-outs ignored — "when we trade" */
  tradedGreenPct: number;
  green: number;
  red: number;
  flatOrSkip: number;
  avgSignal: number;
  avgCalendar: number;
  totalNet: number;
  worst: number;
  best: number;
  /** longest red streak on signal days */
  maxRedStreak: number;
  score: number;
};

function scoreBook(
  id: string,
  trades: Trade[],
  allWeekdays: string[],
): Score | null {
  const by = new Map<string, number>();
  for (const t of trades) {
    by.set(t.date, (by.get(t.date) ?? 0) + t.pnlRs);
  }
  const signalDates = [...by.keys()].sort();
  if (signalDates.length < 40) return null;

  let green = 0;
  let red = 0;
  let total = 0;
  const daySign: number[] = [];
  for (const d of signalDates) {
    let v = by.get(d)!;
    if (v < -MAX_DAY_LOSS) v = -MAX_DAY_LOSS;
    total += v;
    if (v > 0) {
      green += 1;
      daySign.push(1);
    } else if (v < 0) {
      red += 1;
      daySign.push(-1);
    } else {
      daySign.push(0);
    }
  }

  let maxRed = 0;
  let cur = 0;
  for (const s of daySign) {
    if (s < 0) {
      cur += 1;
      maxRed = Math.max(maxRed, cur);
    } else cur = 0;
  }

  const calGreen = green; // only signal greens count toward calendar green
  const flatOrSkip = allWeekdays.length - signalDates.length;
  const signalGreenPct = (100 * green) / signalDates.length;
  const tradedGreenPct = green + red > 0 ? (100 * green) / (green + red) : 0;
  const calendarGreenPct = (100 * calGreen) / allWeekdays.length;
  const coveragePct = (100 * signalDates.length) / allWeekdays.length;
  const avgSignal = total / signalDates.length;
  const avgCalendar = total / allWeekdays.length;

  // Score: prioritize signal green%, then coverage, then expectancy, punish long red streaks
  let score = 0;
  score += signalGreenPct * 500;
  score += tradedGreenPct * 200;
  score += Math.min(coveragePct, 80) * 40;
  score += Math.min(avgSignal, 800) * 20;
  score += calendarGreenPct * 80;
  if (signalGreenPct >= 75) score += 50_000;
  if (signalGreenPct >= 80) score += 80_000;
  if (signalGreenPct >= 85) score += 120_000;
  if (signalGreenPct >= 90) score += 200_000;
  if (coveragePct >= 30 && signalGreenPct >= 75) score += 40_000;
  if (coveragePct >= 50 && signalGreenPct >= 70) score += 30_000;
  if (avgSignal < 0) score -= 200_000;
  score -= maxRed * 3_000;
  if (maxRed >= 5) score -= 20_000;

  return {
    id,
    calendarDays: allWeekdays.length,
    signalDays: signalDates.length,
    coveragePct: Math.round(coveragePct * 10) / 10,
    signalGreenPct: Math.round(signalGreenPct * 10) / 10,
    calendarGreenPct: Math.round(calendarGreenPct * 10) / 10,
    tradedGreenPct: Math.round(tradedGreenPct * 10) / 10,
    green,
    red,
    flatOrSkip,
    avgSignal: Math.round(avgSignal),
    avgCalendar: Math.round(avgCalendar),
    totalNet: Math.round(total),
    worst: Math.round(Math.min(...[...by.values()].map((v) => Math.max(v, -MAX_DAY_LOSS)))),
    best: Math.round(Math.max(...by.values())),
    maxRedStreak: maxRed,
    score,
  };
}

function main() {
  const series = load();
  const cal = new Set<string>();
  for (const days of series.values()) {
    for (const c of days) {
      const d = dayKey(c.date);
      const w = weekday(d);
      if (w >= 1 && w <= 5) cal.add(d);
    }
  }
  const allWeekdays = [...cal].sort();

  const kinds = [
    'GAP_FADE',
    'GAP_BOUNCE',
    'MIX_GAP',
    'FADE_COLOR',
    'FOLLOW_COLOR',
    'PDHL_FADE',
    'TIGHT_TP_FADE',
    'TIGHT_TP_BOUNCE',
  ];
  const gaps = [0.005, 0.008, 0.01, 0.012, 0.015, 0.02, 0.025, 0.03];
  const stops = [0.01, 0.012, 0.015, 0.02, 0.025];
  const targets = [0, 0.005, 0.006, 0.008, 0.01, 0.012, 0.015];
  const risks = [0.015, 0.02, 0.025];
  const maxNs = [1, 2];
  const wdSets: Array<number[] | null> = [null, [2, 3, 4], [1, 2, 3, 4, 5], [2, 3]];

  const scores: Score[] = [];
  let n = 0;

  for (const kind of kinds) {
    const gapList = kind.includes('GAP') || kind.includes('TP_') || kind === 'MIX_GAP' ? gaps : [0];
    for (const gapPct of gapList) {
      for (const stopPct of stops) {
        // prefer target <= stop
        for (const targetPct of targets.filter((t) => t === 0 || t <= stopPct)) {
          for (const riskPct of risks) {
            for (const maxN of maxNs) {
              for (const weekdays of wdSets) {
                for (const confirmPrior of kind.startsWith('GAP') ? [false, true] : [false]) {
                  for (const minPriorRange of [0, 0.01, 0.015]) {
                    if (minPriorRange > 0 && !kind.includes('GAP') && kind !== 'MIX_GAP') continue;
                    n += 1;
                    const wdTag = weekdays ? weekdays.join('') : 'ALL';
                    const cfg: Cfg = {
                      id: `${kind}|g${gapPct}|s${stopPct}|t${targetPct}|r${riskPct}|max${maxN}|w${wdTag}|c${confirmPrior ? 1 : 0}|pr${minPriorRange}`,
                      kind,
                      gapPct,
                      stopPct,
                      targetPct,
                      riskPct,
                      maxN,
                      weekdays,
                      confirmPrior,
                      minPriorRange: minPriorRange || undefined,
                    };
                    const sc = scoreBook(cfg.id, applyMax(collect(series, cfg), maxN), allWeekdays);
                    if (sc && sc.avgSignal > 0) scores.push(sc);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`Evaluated ~${n} cfgs · profitable scored ${scores.length}`);

  // Rank by signal green first
  const bySignalGreen = [...scores].sort(
    (a, b) =>
      b.signalGreenPct - a.signalGreenPct ||
      b.coveragePct - a.coveragePct ||
      b.avgSignal - a.avgSignal,
  );

  // Almost-all: green≥80% with decent sample
  const g80 = bySignalGreen.filter((s) => s.signalGreenPct >= 80 && s.signalDays >= 50);
  const g85 = bySignalGreen.filter((s) => s.signalGreenPct >= 85 && s.signalDays >= 40);
  const g90 = bySignalGreen.filter((s) => s.signalGreenPct >= 90 && s.signalDays >= 30);
  const g75cov = bySignalGreen.filter(
    (s) => s.signalGreenPct >= 75 && s.coveragePct >= 25 && s.signalDays >= 80,
  );

  // Best calendar green (hard mode)
  const byCalGreen = [...scores].sort(
    (a, b) =>
      b.calendarGreenPct - a.calendarGreenPct ||
      b.signalGreenPct - a.signalGreenPct ||
      b.avgCalendar - a.avgCalendar,
  );

  console.log('\n=== ≥90% signal green (n≥30) ===');
  for (const s of g90.slice(0, 12)) {
    console.log(
      `sigG ${s.signalGreenPct}% cov ${s.coveragePct}% days ${s.signalDays} avg₹${s.avgSignal} redStreak ${s.maxRedStreak} | ${s.id.slice(0, 100)}`,
    );
  }
  if (!g90.length) console.log('(none)');

  console.log('\n=== ≥85% signal green ===');
  for (const s of g85.slice(0, 12)) {
    console.log(
      `sigG ${s.signalGreenPct}% cov ${s.coveragePct}% days ${s.signalDays} avg₹${s.avgSignal} redStreak ${s.maxRedStreak} | ${s.id.slice(0, 100)}`,
    );
  }

  console.log('\n=== ≥80% signal green ===');
  for (const s of g80.slice(0, 12)) {
    console.log(
      `sigG ${s.signalGreenPct}% cov ${s.coveragePct}% days ${s.signalDays} avg₹${s.avgSignal} redStreak ${s.maxRedStreak} | ${s.id.slice(0, 100)}`,
    );
  }

  console.log('\n=== ≥75% green + ≥25% coverage (practical almost-daily) ===');
  for (const s of g75cov.slice(0, 12)) {
    console.log(
      `sigG ${s.signalGreenPct}% cov ${s.coveragePct}% calG ${s.calendarGreenPct}% avg₹${s.avgSignal} | ${s.id.slice(0, 100)}`,
    );
  }

  console.log('\n=== Top calendar green% (almost every weekday) ===');
  for (const s of byCalGreen.slice(0, 10)) {
    console.log(
      `calG ${s.calendarGreenPct}% sigG ${s.signalGreenPct}% cov ${s.coveragePct}% avgCal₹${s.avgCalendar} | ${s.id.slice(0, 100)}`,
    );
  }

  // Composite champion: max signal green with coverage≥15% and days≥50
  const practical = bySignalGreen.filter((s) => s.signalDays >= 50 && s.coveragePct >= 10);
  const champion =
    g90[0] ??
    g85[0] ??
    g80.filter((s) => s.coveragePct >= 8)[0] ??
    g75cov[0] ??
    practical[0]!;

  // Best "almost all days" compromise: maximize min(signalGreen, coverage-adjusted)
  const compromise = [...scores]
    .filter((s) => s.signalDays >= 80 && s.avgSignal > 50)
    .sort(
      (a, b) =>
        b.signalGreenPct * 0.7 + b.coveragePct * 0.3 - (a.signalGreenPct * 0.7 + a.coveragePct * 0.3) ||
        b.avgSignal - a.avgSignal,
    );

  console.log('\n===== CHAMPION (highest green) =====');
  console.log(JSON.stringify(champion, null, 2));
  console.log('\n===== BEST COMPROMISE (green × coverage) =====');
  console.log(JSON.stringify(compromise[0], null, 2));

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Flat/no-trade days are NOT counted as green. Almost-all-calendar-green is extremely hard.',
        calendarWeekdays: allWeekdays.length,
        champion,
        compromise: compromise[0],
        g90: g90.slice(0, 20),
        g85: g85.slice(0, 20),
        g80: g80.slice(0, 20),
        g75cov: g75cov.slice(0, 20),
        topCalendarGreen: byCalGreen.slice(0, 20),
        topCompromise: compromise.slice(0, 20),
      },
      null,
      2,
    ),
  );

  const lines = [
    '# Almost-all-days green (stocks EOD)',
    '',
    `**Date:** ${new Date().toISOString()}`,
    '**Book:** treasure 8 · honest open rank · sit-out allowed',
    '',
    '## Hard truth',
    'Making **almost every calendar weekday** green is not achievable on day-bar equity with ₹60k without look-ahead.',
    'What *is* achievable: **very high green% on days we choose to trade**, and sit out the rest.',
    '',
    '## Champion (max signal green)',
    `\`${champion.id}\``,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Signal-day green | **${champion.signalGreenPct}%** |`,
    `| Coverage of weekdays | ${champion.coveragePct}% |`,
    `| Calendar green (strict) | ${champion.calendarGreenPct}% |`,
    `| Signal days | ${champion.signalDays} |`,
    `| Avg signal day | ₹${champion.avgSignal} |`,
    `| Max red streak | ${champion.maxRedStreak} |`,
    `| Worst day | ₹${champion.worst} |`,
    '',
    '## Best compromise (green × how often we trade)',
    compromise[0]
      ? `\`${compromise[0].id}\` · sigG **${compromise[0].signalGreenPct}%** · cov ${compromise[0].coveragePct}% · avg ₹${compromise[0].avgSignal}`
      : 'n/a',
    '',
    '## Operating rule',
    '**Only trade the signal. No signal → flat day (preserve capital). Forced daily trades destroy green rate.**',
    '',
    `JSON: \`reports/almost-all-green-hunt.json\``,
  ];
  writeFileSync(DOC, lines.join('\n'));
  console.log('\nWrote', OUT);
  console.log('Wrote', DOC);
}

main();

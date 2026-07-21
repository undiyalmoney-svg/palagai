/**
 * Honest ₹500/day hunt — NO look-ahead when picking which names to trade.
 * At open we only know: gap, prior color, ranges. Max N names/day by observable rank.
 *
 *   npx tsx scripts/research-stocks-500-honest.ts
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CACHE_2020 = join(root, 'reports/analyst-cache/stocks-day-2020');
const OUT = join(root, 'reports/stocks-500-day-honest.json');
const DOC = join(root, 'docs/owner-private/08-STOCKS-500-DAY-HUNT.md');

const CAPITAL = 60_000;
const MAX_DAY_LOSS = 2_400;
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

type Candle = { date: string; open: number; high: number; low: number; close: number };
type Dir = 'BUY' | 'SELL';

type Signal = {
  symbol: string;
  date: string;
  dir: Dir;
  entry: number;
  stop: number;
  qty: number;
  pnlRs: number; // filled after exit — only used for scoring, not selection
  rankKey: number; // higher = prefer at open
  dna: string;
};

function dayKey(iso: string) {
  return iso.slice(0, 10);
}
function weekday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}
function qtyFor(entry: number, stop: number, riskPct: number) {
  const r = Math.abs(entry - stop);
  if (r < 0.05) return 0;
  return Math.max(
    0,
    Math.min(Math.floor((CAPITAL * riskPct) / r), Math.floor((CAPITAL * 1.5) / entry)),
  );
}

function loadBook(): Map<string, Candle[]> {
  const map = new Map<string, Candle[]>();
  for (const f of readdirSync(CACHE_2020)) {
    const sym = f.split('_')[0]!;
    if (!(BOOK as readonly string[]).includes(sym)) continue;
    map.set(sym, JSON.parse(readFileSync(join(CACHE_2020, f), 'utf8')) as Candle[]);
  }
  return map;
}

function exitPnl(dir: Dir, d: Candle, entry: number, stop: number, qty: number, targetPct: number) {
  let exit = d.close;
  let pts = dir === 'BUY' ? exit - entry : entry - exit;
  if (dir === 'BUY' && d.low <= stop) {
    exit = stop;
    pts = exit - entry;
  } else if (dir === 'SELL' && d.high >= stop) {
    exit = stop;
    pts = entry - exit;
  } else if (targetPct > 0) {
    const tp = dir === 'BUY' ? entry * (1 + targetPct) : entry * (1 - targetPct);
    if (dir === 'BUY' && d.high >= tp) {
      exit = tp;
      pts = exit - entry;
    } else if (dir === 'SELL' && d.low <= tp) {
      exit = tp;
      pts = entry - exit;
    }
  }
  return pts * qty;
}

type DnaCfg = {
  id: string;
  kind: 'GAP_FADE' | 'GAP_BOUNCE' | 'FADE_COLOR' | 'FOLLOW_COLOR' | 'MIXED_GAP';
  gapPct: number;
  stopPct: number;
  targetPct: number;
  riskPct: number;
  weekdays: number[] | null;
  /** symbol overrides for MIXED */
  mixed?: Record<string, 'GAP_FADE' | 'GAP_BOUNCE'>;
};

function signalsForSymbol(
  symbol: string,
  days: Candle[],
  cfg: DnaCfg,
  kind: DnaCfg['kind'] | 'GAP_FADE' | 'GAP_BOUNCE',
): Signal[] {
  const out: Signal[] = [];
  const useKind = kind === 'MIXED_GAP' ? 'GAP_FADE' : kind;
  for (let i = 1; i < days.length; i += 1) {
    const d = days[i]!;
    const prev = days[i - 1]!;
    const date = dayKey(d.date);
    const wd = weekday(date);
    if (wd < 1 || wd > 5) continue;
    if (cfg.weekdays && !cfg.weekdays.includes(wd)) continue;

    let dir: Dir | null = null;
    let rankKey = 0;
    const gap = (d.open - prev.close) / prev.close;

    if (useKind === 'GAP_FADE') {
      if (gap <= cfg.gapPct) continue;
      dir = 'SELL';
      rankKey = gap; // largest gap-up first
    } else if (useKind === 'GAP_BOUNCE') {
      if (gap >= -cfg.gapPct) continue;
      dir = 'BUY';
      rankKey = -gap; // largest gap-down first
    } else if (useKind === 'FADE_COLOR') {
      dir = prev.close >= prev.open ? 'SELL' : 'BUY';
      rankKey = Math.abs(prev.close - prev.open) / prev.close;
    } else if (useKind === 'FOLLOW_COLOR') {
      dir = prev.close >= prev.open ? 'BUY' : 'SELL';
      rankKey = Math.abs(prev.close - prev.open) / prev.close;
    }
    if (!dir) continue;

    const stop = dir === 'BUY' ? d.open * (1 - cfg.stopPct) : d.open * (1 + cfg.stopPct);
    const q = qtyFor(d.open, stop, cfg.riskPct);
    if (q < 1) continue;
    const pnlRs = exitPnl(dir, d, d.open, stop, q, cfg.targetPct);
    out.push({
      symbol,
      date,
      dir,
      entry: d.open,
      stop,
      qty: q,
      pnlRs,
      rankKey,
      dna: cfg.id,
    });
  }
  return out;
}

function collectSignals(series: Map<string, Candle[]>, cfg: DnaCfg): Signal[] {
  const all: Signal[] = [];
  for (const sym of BOOK) {
    const days = series.get(sym);
    if (!days) continue;
    let kind: DnaCfg['kind'] | 'GAP_FADE' | 'GAP_BOUNCE' = cfg.kind;
    if (cfg.kind === 'MIXED_GAP' && cfg.mixed?.[sym]) {
      kind = cfg.mixed[sym]!;
    } else if (cfg.kind === 'MIXED_GAP') {
      continue;
    }
    all.push(...signalsForSymbol(sym, days, cfg, kind));
  }
  return all;
}

/** Honest day cap: pick top maxN by rankKey (known at open). */
function applyDayCap(signals: Signal[], maxN: number): Signal[] {
  const byDay = new Map<string, Signal[]>();
  for (const s of signals) {
    const a = byDay.get(s.date) ?? [];
    a.push(s);
    byDay.set(s.date, a);
  }
  const out: Signal[] = [];
  for (const [, arr] of byDay) {
    arr.sort((a, b) => b.rankKey - a.rankKey || a.symbol.localeCompare(b.symbol));
    out.push(...arr.slice(0, maxN));
  }
  return out;
}

function score(signals: Signal[], calendarDays: number) {
  const byDay = new Map<string, number>();
  for (const s of signals) {
    byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.pnlRs);
  }
  const vals: number[] = [];
  for (const [, v0] of byDay) {
    let v = v0;
    if (v < -MAX_DAY_LOSS) v = -MAX_DAY_LOSS;
    vals.push(v);
  }
  if (vals.length < 60) return null;
  const total = vals.reduce((a, b) => a + b, 0);
  const green = vals.filter((v) => v > 0).length;
  const hit500 = vals.filter((v) => v >= 500).length;
  const sorted = [...vals].sort((a, b) => a - b);
  return {
    signalDays: vals.length,
    greenPct: Math.round((100 * green) / vals.length * 10) / 10,
    avgSignalDayRs: Math.round(total / vals.length),
    avgCalendarDayRs: Math.round(total / calendarDays),
    hit500Pct: Math.round((100 * hit500) / vals.length * 10) / 10,
    medianSignalDayRs: Math.round(sorted[Math.floor(sorted.length / 2)]!),
    totalNet: Math.round(total),
    worstDay: Math.round(Math.min(...vals)),
    bestDay: Math.round(Math.max(...vals)),
  };
}

function main() {
  if (!existsSync(CACHE_2020)) throw new Error('need stocks-day-2020 cache');
  const series = loadBook();
  const cal = new Set<string>();
  for (const days of series.values()) for (const c of days) cal.add(dayKey(c.date));
  const calendarDays = [...cal].filter((d) => {
    const w = weekday(d);
    return w >= 1 && w <= 5;
  }).length;

  const gaps = [0.003, 0.005, 0.008, 0.01, 0.015];
  const stops = [0.008, 0.01, 0.012, 0.015];
  const targets = [0, 0.01, 0.015];
  const risks = [0.015, 0.02, 0.025];
  const wds: Array<number[] | null> = [null, [2, 3, 4], [1, 3, 5]];
  const maxNs = [1, 2, 3];

  type Row = {
    id: string;
    cfg: string;
    maxN: number;
  } & NonNullable<ReturnType<typeof score>>;

  const rows: Row[] = [];

  // Uniform books
  for (const kind of ['GAP_FADE', 'GAP_BOUNCE', 'FADE_COLOR', 'FOLLOW_COLOR'] as const) {
    for (const gapPct of kind.startsWith('GAP') ? gaps : [0]) {
      for (const stopPct of stops) {
        for (const targetPct of targets) {
          for (const riskPct of risks) {
            for (const weekdays of wds) {
              const wdTag = weekdays ? weekdays.join('') : 'ALL';
              const cfg: DnaCfg = {
                id: `${kind}|g${gapPct}|s${stopPct}|t${targetPct}|r${riskPct}|w${wdTag}`,
                kind,
                gapPct,
                stopPct,
                targetPct,
                riskPct,
                weekdays,
              };
              const raw = collectSignals(series, cfg);
              for (const maxN of maxNs) {
                const capped = applyDayCap(raw, maxN);
                const sc = score(capped, calendarDays);
                if (!sc || sc.avgSignalDayRs <= 0) continue;
                rows.push({ id: `${cfg.id}|max${maxN}`, cfg: cfg.id, maxN, ...sc });
              }
            }
          }
        }
      }
    }
  }

  // Mixed champion-style from pass1 research
  const mixedVariants: Array<Record<string, 'GAP_FADE' | 'GAP_BOUNCE'>> = [
    {
      CIPLA: 'GAP_FADE',
      SUNPHARMA: 'GAP_BOUNCE',
      APOLLOHOSP: 'GAP_BOUNCE',
      NTPC: 'GAP_BOUNCE',
    },
    {
      CIPLA: 'GAP_FADE',
      SUNPHARMA: 'GAP_BOUNCE',
      BRITANNIA: 'GAP_FADE',
      HDFCLIFE: 'GAP_BOUNCE',
    },
    {
      CIPLA: 'GAP_FADE',
      APOLLOHOSP: 'GAP_BOUNCE',
      NTPC: 'GAP_BOUNCE',
      SUNPHARMA: 'GAP_BOUNCE',
      BRITANNIA: 'GAP_FADE',
      TATACONSUM: 'GAP_BOUNCE',
    },
  ];

  for (const mixed of mixedVariants) {
    for (const gapPct of [0.005, 0.008, 0.01]) {
      for (const stopPct of [0.012, 0.015]) {
        for (const riskPct of [0.02, 0.025]) {
          for (const weekdays of [null, [2, 3, 4]] as Array<number[] | null>) {
            const wdTag = weekdays ? weekdays.join('') : 'ALL';
            const cfg: DnaCfg = {
              id: `MIXED|g${gapPct}|s${stopPct}|r${riskPct}|w${wdTag}|${Object.keys(mixed).join('+')}`,
              kind: 'MIXED_GAP',
              gapPct,
              stopPct,
              targetPct: 0,
              riskPct,
              weekdays,
              mixed,
            };
            const raw = collectSignals(series, cfg);
            for (const maxN of maxNs) {
              const sc = score(applyDayCap(raw, maxN), calendarDays);
              if (!sc || sc.avgSignalDayRs <= 0) continue;
              rows.push({ id: `${cfg.id}|max${maxN}`, cfg: cfg.id, maxN, ...sc });
            }
          }
        }
      }
    }
  }

  rows.sort(
    (a, b) =>
      b.avgCalendarDayRs - a.avgCalendarDayRs ||
      b.greenPct - a.greenPct ||
      b.avgSignalDayRs - a.avgSignalDayRs,
  );

  const hitDaily500 = rows.filter(
    (r) => r.avgCalendarDayRs >= 500 && r.greenPct >= 55 && r.worstDay >= -MAX_DAY_LOSS,
  );
  const hitSig500 = rows.filter((r) => r.avgSignalDayRs >= 500 && r.greenPct >= 55);
  const hitCal200 = rows.filter((r) => r.avgCalendarDayRs >= 200 && r.greenPct >= 55);

  console.log(`Scored ${rows.length} honest combos · calendar days ${calendarDays}`);
  console.log('\n=== TOP by calendar avg (honest open rank) ===');
  for (const r of rows.slice(0, 20)) {
    console.log(
      `cal₹${r.avgCalendarDayRs} sig₹${r.avgSignalDayRs} green${r.greenPct}% hit500 ${r.hit500Pct}% days${r.signalDays} worst${r.worstDay} med${r.medianSignalDayRs} | ${r.id.slice(0, 110)}`,
    );
  }
  console.log(`\nStrict every-weekday ~₹500 (cal≥500 green≥55): ${hitDaily500.length}`);
  for (const r of hitDaily500.slice(0, 10)) {
    console.log('FOUND', r.id, `cal${r.avgCalendarDayRs} sig${r.avgSignalDayRs} g${r.greenPct}`);
  }
  console.log(`Signal-day ≥₹500 green≥55: ${hitSig500.length}`);
  console.log(`Calendar ≥₹200 green≥55: ${hitCal200.length}`);
  for (const r of hitCal200.slice(0, 8)) {
    console.log('CAL200', r.id.slice(0, 100), `cal${r.avgCalendarDayRs} g${r.greenPct}`);
  }

  const champion = hitDaily500[0] ?? hitCal200[0] ?? hitSig500[0] ?? rows[0]!;

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Selection at open by gap/range rank only — no EOD look-ahead',
        capital: CAPITAL,
        calendarDays,
        book: BOOK,
        scored: rows.length,
        hitDaily500: hitDaily500.length,
        champion,
        topCalendar: rows.slice(0, 30),
        topHitDaily500: hitDaily500.slice(0, 20),
        topHitSig500: hitSig500
          .sort((a, b) => b.avgSignalDayRs - a.avgSignalDayRs)
          .slice(0, 20),
      },
      null,
      2,
    ),
  );

  const lines = [
    '# Stocks ₹500/day hunt (honest)',
    '',
    `**Date:** ${new Date().toISOString()}`,
    '**Method:** open-only rank (gap size / prior range) · no EOD look-ahead pick',
    `**Book:** ${BOOK.join(', ')}`,
    '',
    '## Verdict',
  ];
  if (hitDaily500.length) {
    lines.push(
      `**FOUND** calendar-avg ≥ ₹500: \`${champion.id}\` · cal ₹${champion.avgCalendarDayRs} · sig ₹${champion.avgSignalDayRs} · green ${champion.greenPct}% · hit≥500 ${champion.hit500Pct}% · worst ₹${champion.worstDay}`,
    );
  } else {
    lines.push(
      `Strict every-weekday ₹500 **not found** after honest ranking. Best: \`${champion.id}\` · cal ₹${champion.avgCalendarDayRs} · sig ₹${champion.avgSignalDayRs} · green ${champion.greenPct}% · hit≥500 ${champion.hit500Pct}% · worst ₹${champion.worstDay}`,
    );
  }
  lines.push('');
  lines.push('## Top calendar');
  for (const r of rows.slice(0, 12)) {
    lines.push(
      `- cal ₹${r.avgCalendarDayRs} · sig ₹${r.avgSignalDayRs} · green ${r.greenPct}% · ${r.id}`,
    );
  }
  lines.push('');
  lines.push('## Practical ship DNA');
  lines.push(
    'Prefer gap fade/bounce mixed book, max 2 names/day by largest gap, stop ~1.2–1.5%, risk 2–2.5%.',
  );
  lines.push('');
  lines.push(`JSON: \`reports/stocks-500-day-honest.json\``);
  writeFileSync(DOC, lines.join('\n'));
  console.log('\nCHAMPION', champion.id);
  console.log(
    `cal₹${champion.avgCalendarDayRs} sig₹${champion.avgSignalDayRs} green${champion.greenPct}% hit${champion.hit500Pct}% worst${champion.worstDay}`,
  );
  console.log('Wrote', OUT);
}

main();

/**
 * CrudeOilM — entry window + weekday hunt on cached 5m bars.
 * Read-only research; does not change app strategy.
 *
 *   npx tsx scripts/crude-session-window-hunt.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CACHE = join(root, 'reports/analyst-cache/crudeoilm-5m-merged.json');
const OUT = join(root, 'reports/crude-session-window-hunt.json');

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Dir = 'BUY' | 'SELL';

const RS = 10;
const EXIT_BY = '23:10';

function hhmm(iso: string): string {
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m?.[1] ?? '00:00';
}
function day(iso: string): string {
  return iso.slice(0, 10);
}
function month(iso: string): string {
  return iso.slice(0, 7);
}
function dow(iso: string): number {
  // 0=Sun..6=Sat in local calendar date
  return new Date(`${day(iso)}T12:00:00`).getDay();
}
const DOW_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function prevDayHl(candles: Candle[], before: number, tradingDate: string): { pdh: number; pdl: number } | null {
  let prev: string | null = null;
  for (let i = before - 1; i >= 0; i -= 1) {
    const d = day(candles[i]!.date);
    if (d < tradingDate) {
      prev = d;
      break;
    }
  }
  if (!prev) return null;
  let pdh = -Infinity;
  let pdl = Infinity;
  for (let i = 0; i < before; i += 1) {
    const c = candles[i]!;
    if (day(c.date) !== prev) continue;
    pdh = Math.max(pdh, c.high);
    pdl = Math.min(pdl, c.low);
  }
  if (!Number.isFinite(pdh) || !Number.isFinite(pdl)) return null;
  return { pdh, pdl };
}

function orbRange(
  candles: Candle[],
  tradingDate: string,
  orStart: string,
  orEnd: string,
): { high: number; low: number } | null {
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (day(c.date) !== tradingDate) continue;
    const t = hhmm(c.date);
    if (t < orStart || t > orEnd) continue;
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high, low };
}

interface Cfg {
  kind: 'pdhl_break' | 'orb_break';
  entryStart: string;
  entryEnd: string;
  stopPts: number;
  targetPts: number;
  maxTradesDay: number;
  maxTradesMonth: number;
  dayLossStop: number;
  orStart?: string;
  orEnd?: string;
  allowedDow?: number[]; // 1=Mon..5=Fri
}

interface Trade {
  date: string;
  dow: number;
  entryTime: string;
  exitTime: string;
  dir: Dir;
  pts: number;
}

function simulate(candles: Candle[], cfg: Cfg): Trade[] {
  const trades: Trade[] = [];
  let open: {
    dir: Dir;
    entry: number;
    stop: number;
    target: number;
    entryTime: string;
    date: string;
  } | null = null;

  let tradingDate: string | null = null;
  let tradingMonth: string | null = null;
  let dayNet = 0;
  let tradesToday = 0;
  let tradesMonth = 0;
  let dayStopped = false;

  for (let i = 40; i < candles.length; i += 1) {
    const c = candles[i]!;
    const d = day(c.date);
    const t = hhmm(c.date);
    const m = month(c.date);

    if (tradingDate !== d) {
      tradingDate = d;
      dayNet = 0;
      tradesToday = 0;
      dayStopped = false;
    }
    if (tradingMonth !== m) {
      tradingMonth = m;
      tradesMonth = 0;
    }

    if (open) {
      let exit: number | null = null;
      let reason = '';
      if (open.dir === 'BUY') {
        if (c.low <= open.stop) {
          exit = open.stop;
          reason = 'SL';
        } else if (c.high >= open.target) {
          exit = open.target;
          reason = 'TP';
        }
      } else {
        if (c.high >= open.stop) {
          exit = open.stop;
          reason = 'SL';
        } else if (c.low <= open.target) {
          exit = open.target;
          reason = 'TP';
        }
      }
      if (!exit && (t >= EXIT_BY || d !== open.date)) {
        exit = c.close;
        reason = 'TIME';
      }
      if (exit != null) {
        const pts = open.dir === 'BUY' ? exit - open.entry : open.entry - exit;
        trades.push({
          date: open.date,
          dow: dow(open.entryTime),
          entryTime: open.entryTime,
          exitTime: c.date,
          dir: open.dir,
          pts,
        });
        dayNet += pts;
        tradesToday += 1;
        tradesMonth += 1;
        if (dayNet <= -cfg.dayLossStop) dayStopped = true;
        open = null;
        void reason;
      }
      continue;
    }

    if (dayStopped) continue;
    if (tradesToday >= cfg.maxTradesDay) continue;
    if (tradesMonth >= cfg.maxTradesMonth) continue;
    if (t < cfg.entryStart || t > cfg.entryEnd) continue;
    if (cfg.allowedDow && !cfg.allowedDow.includes(dow(c.date))) continue;

    let dir: Dir | null = null;
    if (cfg.kind === 'pdhl_break') {
      const levels = prevDayHl(candles, i, d);
      if (!levels) continue;
      if (c.close > levels.pdh && c.close > c.open) dir = 'BUY';
      else if (c.close < levels.pdl && c.close < c.open) dir = 'SELL';
    } else {
      const orb = orbRange(candles, d, cfg.orStart ?? '09:00', cfg.orEnd ?? '10:00');
      if (!orb) continue;
      if (c.close > orb.high && c.close > c.open) dir = 'BUY';
      else if (c.close < orb.low && c.close < c.open) dir = 'SELL';
    }
    if (!dir) continue;
    if (dayNet - cfg.stopPts < -cfg.dayLossStop) continue;

    const entry = c.close;
    open = {
      dir,
      entry,
      stop: dir === 'BUY' ? entry - cfg.stopPts : entry + cfg.stopPts,
      target: dir === 'BUY' ? entry + cfg.targetPts : entry - cfg.targetPts,
      entryTime: c.date,
      date: d,
    };
  }
  return trades;
}

function summarize(trades: Trade[], label: string) {
  const wins = trades.filter((t) => t.pts > 0).length;
  const losses = trades.filter((t) => t.pts < 0).length;
  const netPts = trades.reduce((a, t) => a + t.pts, 0);
  const byMonth = new Map<string, number>();
  const byDow = new Map<number, { n: number; pts: number; wins: number }>();
  for (const t of trades) {
    const m = t.date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + t.pts);
    const b = byDow.get(t.dow) ?? { n: 0, pts: 0, wins: 0 };
    b.n += 1;
    b.pts += t.pts;
    if (t.pts > 0) b.wins += 1;
    byDow.set(t.dow, b);
  }
  const months = [...byMonth.entries()].map(([month, pts]) => ({ month, pts, rs: pts * RS }));
  const green = months.filter((m) => m.pts > 0).length;
  return {
    label,
    trades: trades.length,
    wins,
    losses,
    wr: trades.length ? (100 * wins) / trades.length : 0,
    netPts,
    netRs: netPts * RS,
    avgMonthRs: months.length ? (netPts * RS) / months.length : 0,
    greenMonths: green,
    months: months.length,
    monthsDetail: months,
    byDow: [1, 2, 3, 4, 5]
      .map((d) => {
        const b = byDow.get(d) ?? { n: 0, pts: 0, wins: 0 };
        return {
          dow: DOW_NAME[d],
          trades: b.n,
          netPts: b.pts,
          netRs: b.pts * RS,
          wr: b.n ? (100 * b.wins) / b.n : 0,
        };
      })
      .filter((x) => x.trades > 0),
  };
}

function windows(): Array<{ start: string; end: string; bucket: string }> {
  const out: Array<{ start: string; end: string; bucket: string }> = [];
  const starts = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
    '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00',
  ];
  for (const start of starts) {
    for (const dur of [60, 90, 120, 150]) {
      const [h, m] = start.split(':').map(Number);
      const endMin = h! * 60 + m! + dur;
      if (endMin > 21 * 60 + 30) continue; // entries not after ~21:30
      const eh = Math.floor(endMin / 60);
      const em = endMin % 60;
      const end = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
      const bucket =
        start < '12:00' ? 'morning' : start < '16:00' ? 'midday' : start < '19:00' ? 'afternoon' : 'evening';
      out.push({ start, end, bucket });
    }
  }
  // dedupe
  const seen = new Set<string>();
  return out.filter((w) => {
    const k = `${w.start}-${w.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function main(): void {
  const raw = JSON.parse(readFileSync(CACHE, 'utf8')) as Candle[];
  const candles = raw.map((c) => ({
    ...c,
    date: c.date.includes('T') ? c.date : c.date.replace(' ', 'T'),
  }));

  const results: ReturnType<typeof summarize>[] = [];
  const winList = windows();

  for (const w of winList) {
    for (const kind of ['pdhl_break', 'orb_break'] as const) {
      for (const stop of kind === 'pdhl_break' ? [80] : [60, 80]) {
        for (const tp of [200]) {
          const cfg: Cfg = {
            kind,
            entryStart: w.start,
            entryEnd: w.end,
            stopPts: stop,
            targetPts: tp,
            maxTradesDay: kind === 'orb_break' ? 1 : 2,
            maxTradesMonth: 8,
            dayLossStop: stop * 3,
            orStart: '09:00',
            orEnd: '10:00',
          };
          const trades = simulate(candles, cfg);
          if (trades.length < 5) continue;
          results.push(
            summarize(
              trades,
              `${kind}|${w.start.replace(':', '')}-${w.end.replace(':', '')}|SL${stop}|TP${tp}|${w.bucket}`,
            ),
          );
        }
      }
    }
  }

  results.sort((a, b) => b.netRs - a.netRs || b.wr - a.wr);

  // Weekday filters on champion window
  const champBase: Cfg = {
    kind: 'pdhl_break',
    entryStart: '19:00',
    entryEnd: '21:00',
    stopPts: 80,
    targetPts: 200,
    maxTradesDay: 2,
    maxTradesMonth: 8,
    dayLossStop: 240,
  };
  const weekdayVariants = [
    { name: 'all_weekdays', dows: [1, 2, 3, 4, 5] },
    { name: 'Mon-Wed', dows: [1, 2, 3] },
    { name: 'Wed-Fri', dows: [3, 4, 5] },
    { name: 'Tue-Thu', dows: [2, 3, 4] },
    { name: 'Mon+Wed+Fri', dows: [1, 3, 5] },
    { name: 'Tue+Thu', dows: [2, 4] },
    { name: 'Mon_only', dows: [1] },
    { name: 'Tue_only', dows: [2] },
    { name: 'Wed_only', dows: [3] },
    { name: 'Thu_only', dows: [4] },
    { name: 'Fri_only', dows: [5] },
  ].map((v) => {
    const trades = simulate(candles, { ...champBase, allowedDow: v.dows });
    return summarize(trades, `pdhl|1900-2100|SL80|TP200|${v.name}`);
  });

  // Best morning orb weekday
  const mornBase: Cfg = {
    kind: 'orb_break',
    entryStart: '10:00',
    entryEnd: '12:00',
    stopPts: 60,
    targetPts: 200,
    maxTradesDay: 1,
    maxTradesMonth: 8,
    dayLossStop: 180,
    orStart: '09:00',
    orEnd: '10:00',
  };
  const morningWeekday = [1, 2, 3, 4, 5].map((d) => {
    const trades = simulate(candles, { ...mornBase, allowedDow: [d] });
    return summarize(trades, `orb|1000-1200|SL60|TP200|${DOW_NAME[d]}_only`);
  });

  const byBucket = {
    morning: results.filter((r) => r.label.includes('|morning')).slice(0, 8),
    midday: results.filter((r) => r.label.includes('|midday')).slice(0, 8),
    afternoon: results.filter((r) => r.label.includes('|afternoon')).slice(0, 8),
    evening: results.filter((r) => r.label.includes('|evening')).slice(0, 8),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    sample: {
      from: candles[0]?.date,
      to: candles.at(-1)?.date,
      bars: candles.length,
      note: 'Short sample May–Jul 2026 only — not multi-year proof',
      session: 'CRUDEOILM approx 09:00–23:15 IST',
      rupeesPerPoint: RS,
    },
    topOverall: results.slice(0, 20),
    byBucket,
    championWindowWeekdays: weekdayVariants.sort((a, b) => b.netRs - a.netRs),
    morningOrbByWeekday: morningWeekday.sort((a, b) => b.netRs - a.netRs),
    verdict: {
      bestOverall: results[0],
      bestMorning: byBucket.morning[0] ?? null,
      bestMidday: byBucket.midday[0] ?? null,
      bestAfternoon: byBucket.afternoon[0] ?? null,
      bestEvening: byBucket.evening[0] ?? null,
    },
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  const fmt = (r: ReturnType<typeof summarize> | null | undefined) =>
    r
      ? `${r.label}\n    ₹${Math.round(r.netRs)} · avg/mo ₹${Math.round(r.avgMonthRs)} · ${r.trades} tr · WR ${r.wr.toFixed(0)}% · green ${r.greenMonths}/${r.months}`
      : 'n/a';

  console.log('\n=== CRUDE SESSION WINDOW HUNT (May–Jul 2026 cache) ===\n');
  console.log('BEST OVERALL:\n ', fmt(report.verdict.bestOverall));
  console.log('\nBEST MORNING:\n ', fmt(report.verdict.bestMorning));
  console.log('\nBEST MIDDAY:\n ', fmt(report.verdict.bestMidday));
  console.log('\nBEST AFTERNOON:\n ', fmt(report.verdict.bestAfternoon));
  console.log('\nBEST EVENING:\n ', fmt(report.verdict.bestEvening));
  console.log('\n--- Champion 19:00–21:00 by weekday filter ---');
  for (const r of report.championWindowWeekdays.slice(0, 8)) {
    console.log(`  ₹${Math.round(r.netRs).toString().padStart(6)}  ${r.label}  (${r.trades} tr, WR ${r.wr.toFixed(0)}%)`);
    if (r.byDow.length) {
      console.log('    days:', r.byDow.map((d) => `${d.dow} ₹${Math.round(d.netRs)}`).join(' · '));
    }
  }
  console.log('\n--- Morning ORB 10:00–12:00 by single weekday ---');
  for (const r of report.morningOrbByWeekday) {
    console.log(`  ₹${Math.round(r.netRs).toString().padStart(6)}  ${r.label}  (${r.trades} tr)`);
  }
  console.log(`\nWrote ${OUT}`);
}

main();

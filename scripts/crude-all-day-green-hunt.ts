/**
 * CRUDEOILM hunt — ~100 strategies, prefer all-day-green both sessions.
 * If none exist on sample, pick best all-months-green with highest green-day %.
 *
 *   npx tsx scripts/crude-all-day-green-hunt.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CACHE = join(root, 'reports/analyst-cache/crudeoilm-5m-merged.json');
const OUT = join(root, 'reports/crude-all-day-green-hunt.json');

type Candle = { date: string; open: number; high: number; low: number; close: number };
type Dir = 'BUY' | 'SELL';

const RS = 10;
const EXIT_BY = '23:10';

function hhmm(iso: string): string {
  return iso.match(/T(\d{2}:\d{2})/)?.[1] ?? '00:00';
}
function day(iso: string): string {
  return iso.slice(0, 10);
}
function month(iso: string): string {
  return iso.slice(0, 7);
}

function prevDayHl(candles: Candle[], before: number, tradingDate: string): { pdh: number; pdl: number } | null {
  let prev: string | null = null;
  for (let i = before - 1; i >= 0; i -= 1) {
    if (day(candles[i]!.date) < tradingDate) {
      prev = day(candles[i]!.date);
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
  return Number.isFinite(pdh) && Number.isFinite(pdl) ? { pdh, pdl } : null;
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
  return Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null;
}

interface Cfg {
  id: string;
  book: 'morning' | 'evening';
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
  candleConfirm: boolean;
  /** Skip if OR width > this (pts). 0 = off. */
  maxOrWidth: number;
}

interface Trade {
  date: string;
  pts: number;
  book: 'morning' | 'evening';
}

function simulateOne(candles: Candle[], cfg: Cfg): Trade[] {
  const trades: Trade[] = [];
  let open: {
    dir: Dir;
    entry: number;
    stop: number;
    target: number;
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
      if (open.dir === 'BUY') {
        if (c.low <= open.stop) exit = open.stop;
        else if (c.high >= open.target) exit = open.target;
      } else {
        if (c.high >= open.stop) exit = open.stop;
        else if (c.low <= open.target) exit = open.target;
      }
      if (exit == null && (t >= EXIT_BY || d !== open.date)) exit = c.close;
      if (exit != null) {
        const pts = open.dir === 'BUY' ? exit - open.entry : open.entry - exit;
        trades.push({ date: open.date, pts, book: cfg.book });
        dayNet += pts;
        tradesToday += 1;
        tradesMonth += 1;
        if (dayNet <= -cfg.dayLossStop) dayStopped = true;
        open = null;
      }
      continue;
    }

    if (dayStopped || tradesToday >= cfg.maxTradesDay || tradesMonth >= cfg.maxTradesMonth) continue;
    if (t < cfg.entryStart || t > cfg.entryEnd) continue;

    let dir: Dir | null = null;
    if (cfg.kind === 'pdhl_break') {
      const levels = prevDayHl(candles, i, d);
      if (!levels) continue;
      if (c.close > levels.pdh) dir = 'BUY';
      else if (c.close < levels.pdl) dir = 'SELL';
    } else {
      const orb = orbRange(candles, d, cfg.orStart ?? '09:00', cfg.orEnd ?? '10:00');
      if (!orb) continue;
      if (cfg.maxOrWidth > 0 && orb.high - orb.low > cfg.maxOrWidth) continue;
      if (c.close > orb.high) dir = 'BUY';
      else if (c.close < orb.low) dir = 'SELL';
    }
    if (!dir) continue;
    if (cfg.candleConfirm) {
      if (dir === 'BUY' && c.close <= c.open) continue;
      if (dir === 'SELL' && c.close >= c.open) continue;
    }
    if (dayNet - cfg.stopPts < -cfg.dayLossStop) continue;

    const entry = c.close;
    open = {
      dir,
      entry,
      stop: dir === 'BUY' ? entry - cfg.stopPts : entry + cfg.stopPts,
      target: dir === 'BUY' ? entry + cfg.targetPts : entry - cfg.targetPts,
      date: d,
    };
  }
  return trades;
}

function simulatePair(candles: Candle[], morning: Cfg, evening: Cfg): Trade[] {
  const trades: Trade[] = [];
  let open: {
    dir: Dir;
    entry: number;
    stop: number;
    target: number;
    date: string;
    book: 'morning' | 'evening';
  } | null = null;
  let tradingDate: string | null = null;
  let tradingMonth: string | null = null;
  let dayNet = 0;
  let morningToday = 0;
  let eveningToday = 0;
  let tradesMonth = 0;
  let dayStopped = false;
  const dayLoss = Math.max(morning.dayLossStop, evening.dayLossStop);

  const tryEntry = (cfg: Cfg, i: number, c: Candle, d: string, t: string, count: number): boolean => {
    if (count >= cfg.maxTradesDay) return false;
    if (t < cfg.entryStart || t > cfg.entryEnd) return false;
    let dir: Dir | null = null;
    if (cfg.kind === 'pdhl_break') {
      const levels = prevDayHl(candles, i, d);
      if (!levels) return false;
      if (c.close > levels.pdh) dir = 'BUY';
      else if (c.close < levels.pdl) dir = 'SELL';
    } else {
      const orb = orbRange(candles, d, cfg.orStart ?? '09:00', cfg.orEnd ?? '10:00');
      if (!orb) return false;
      if (cfg.maxOrWidth > 0 && orb.high - orb.low > cfg.maxOrWidth) return false;
      if (c.close > orb.high) dir = 'BUY';
      else if (c.close < orb.low) dir = 'SELL';
    }
    if (!dir) return false;
    if (cfg.candleConfirm) {
      if (dir === 'BUY' && c.close <= c.open) return false;
      if (dir === 'SELL' && c.close >= c.open) return false;
    }
    if (dayNet - cfg.stopPts < -dayLoss) return false;
    const entry = c.close;
    open = {
      dir,
      entry,
      stop: dir === 'BUY' ? entry - cfg.stopPts : entry + cfg.stopPts,
      target: dir === 'BUY' ? entry + cfg.targetPts : entry - cfg.targetPts,
      date: d,
      book: cfg.book,
    };
    return true;
  };

  for (let i = 40; i < candles.length; i += 1) {
    const c = candles[i]!;
    const d = day(c.date);
    const t = hhmm(c.date);
    const m = month(c.date);
    if (tradingDate !== d) {
      tradingDate = d;
      dayNet = 0;
      morningToday = 0;
      eveningToday = 0;
      dayStopped = false;
    }
    if (tradingMonth !== m) {
      tradingMonth = m;
      tradesMonth = 0;
    }

    if (open) {
      let exit: number | null = null;
      if (open.dir === 'BUY') {
        if (c.low <= open.stop) exit = open.stop;
        else if (c.high >= open.target) exit = open.target;
      } else {
        if (c.high >= open.stop) exit = open.stop;
        else if (c.low <= open.target) exit = open.target;
      }
      if (exit == null && (t >= EXIT_BY || d !== open.date)) exit = c.close;
      if (exit != null) {
        const pts = open.dir === 'BUY' ? exit - open.entry : open.entry - exit;
        trades.push({ date: open.date, pts, book: open.book });
        dayNet += pts;
        tradesMonth += 1;
        if (open.book === 'morning') morningToday += 1;
        else eveningToday += 1;
        if (dayNet <= -dayLoss) dayStopped = true;
        open = null;
      }
      continue;
    }

    if (dayStopped) continue;
    if (tradesMonth >= Math.max(morning.maxTradesMonth, evening.maxTradesMonth)) continue;
    if (!tryEntry(morning, i, c, d, t, morningToday)) {
      tryEntry(evening, i, c, d, t, eveningToday);
    }
  }
  return trades;
}

interface Score {
  id: string;
  book: string;
  trades: number;
  wr: number;
  netRs: number;
  days: number;
  greenDays: number;
  redDays: number;
  greenDayPct: number;
  allDaysGreen: boolean;
  months: number;
  greenMonths: number;
  allMonthsGreen: boolean;
  worstDayPts: number;
  worstMonthPts: number;
  rankKey: number;
}

function score(trades: Trade[], id: string, book: string): Score {
  const byDay = new Map<string, number>();
  const byMonth = new Map<string, number>();
  let wins = 0;
  let netPts = 0;
  for (const t of trades) {
    netPts += t.pts;
    if (t.pts > 0) wins += 1;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.pts);
    byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? 0) + t.pts);
  }
  const dayNets = [...byDay.values()];
  const monthNets = [...byMonth.values()];
  const greenDays = dayNets.filter((p) => p >= 0).length;
  const redDays = dayNets.filter((p) => p < 0).length;
  const greenMonths = monthNets.filter((p) => p > 0).length;
  const greenDayPct = dayNets.length ? (100 * greenDays) / dayNets.length : 0;
  const allDaysGreen = dayNets.length > 0 && redDays === 0;
  const allMonthsGreen = monthNets.length > 0 && greenMonths === monthNets.length;
  // Prefer: all days green >> all months green >> green day % >> profit
  const rankKey =
    (allDaysGreen ? 1e12 : 0) +
    (allMonthsGreen ? 1e9 : 0) +
    greenDayPct * 1e6 +
    netPts * RS;
  return {
    id,
    book,
    trades: trades.length,
    wr: trades.length ? (100 * wins) / trades.length : 0,
    netRs: netPts * RS,
    days: dayNets.length,
    greenDays,
    redDays,
    greenDayPct,
    allDaysGreen,
    months: monthNets.length,
    greenMonths,
    allMonthsGreen,
    worstDayPts: dayNets.length ? Math.min(...dayNets) : 0,
    worstMonthPts: monthNets.length ? Math.min(...monthNets) : 0,
    rankKey,
  };
}

function buildMorning100(): Cfg[] {
  const out: Cfg[] = [];
  const windows = [
    ['10:00', '12:00'],
    ['10:30', '12:00'],
    ['10:30', '11:30'],
    ['10:00', '11:30'],
    ['11:00', '12:00'],
  ] as const;
  const orbs = [
    ['09:00', '10:00'],
    ['09:00', '09:30'],
  ] as const;
  const stops = [50, 60, 80, 100];
  const tps = [150, 200, 250];
  const widths = [0, 120, 180];
  for (const [es, ee] of windows) {
    for (const [os, oe] of orbs) {
      for (const stop of stops) {
        for (const tp of tps) {
          if (tp < stop * 1.8) continue;
          for (const w of widths) {
            for (const confirm of [true]) {
              out.push({
                id: `M|ORB|${es}-${ee}|OR${os}-${oe}|SL${stop}|TP${tp}|W${w}|c1`,
                book: 'morning',
                kind: 'orb_break',
                entryStart: es,
                entryEnd: ee,
                stopPts: stop,
                targetPts: tp,
                maxTradesDay: 1,
                maxTradesMonth: 12,
                dayLossStop: Math.max(stop * 2, 120),
                orStart: os,
                orEnd: oe,
                candleConfirm: confirm,
                maxOrWidth: w,
              });
            }
          }
        }
      }
    }
  }
  return out.slice(0, 55);
}

function buildEvening100(): Cfg[] {
  const out: Cfg[] = [];
  const windows = [
    ['18:00', '20:00'],
    ['18:30', '20:30'],
    ['19:00', '21:00'],
    ['19:00', '20:30'],
    ['19:30', '21:00'],
    ['20:00', '21:30'],
  ] as const;
  const stops = [50, 60, 80, 100];
  const tps = [150, 200, 250];
  for (const [es, ee] of windows) {
    for (const stop of stops) {
      for (const tp of tps) {
        if (tp < stop * 1.8) continue;
        for (const maxDay of [1, 2]) {
          out.push({
            id: `E|PDHL|${es}-${ee}|SL${stop}|TP${tp}|md${maxDay}|c1`,
            book: 'evening',
            kind: 'pdhl_break',
            entryStart: es,
            entryEnd: ee,
            stopPts: stop,
            targetPts: tp,
            maxTradesDay: maxDay,
            maxTradesMonth: 12,
            dayLossStop: Math.max(stop * 2, 120),
            candleConfirm: true,
            maxOrWidth: 0,
          });
        }
      }
    }
  }
  return out.slice(0, 55);
}

function main(): void {
  const raw = JSON.parse(readFileSync(CACHE, 'utf8')) as Candle[];
  const candles = raw.map((c) => ({
    ...c,
    date: c.date.includes('T') ? c.date : c.date.replace(' ', 'T'),
  }));

  const currentM: Cfg = {
    id: 'M|CURRENT|10:30-12:00|OR09:00-10:00|SL80|TP200|W0|c1',
    book: 'morning',
    kind: 'orb_break',
    entryStart: '10:30',
    entryEnd: '12:00',
    stopPts: 80,
    targetPts: 200,
    maxTradesDay: 1,
    maxTradesMonth: 8,
    dayLossStop: 240,
    orStart: '09:00',
    orEnd: '10:00',
    candleConfirm: true,
    maxOrWidth: 0,
  };
  const currentE: Cfg = {
    id: 'E|CURRENT|19:00-21:00|SL80|TP200|md2|c1',
    book: 'evening',
    kind: 'pdhl_break',
    entryStart: '19:00',
    entryEnd: '21:00',
    stopPts: 80,
    targetPts: 200,
    maxTradesDay: 2,
    maxTradesMonth: 8,
    dayLossStop: 240,
    candleConfirm: true,
    maxOrWidth: 0,
  };

  let mornings = [currentM, ...buildMorning100().filter((c) => c.id !== currentM.id)];
  let evenings = [currentE, ...buildEvening100().filter((c) => c.id !== currentE.id)];
  // Keep ~50 each → ~100 total
  mornings = mornings.slice(0, 50);
  evenings = evenings.slice(0, 50);

  const cfgById = new Map<string, Cfg>();
  const mScores: Score[] = [];
  const eScores: Score[] = [];

  for (const cfg of mornings) {
    cfgById.set(cfg.id, cfg);
    mScores.push(score(simulateOne(candles, cfg), cfg.id, 'morning'));
  }
  for (const cfg of evenings) {
    cfgById.set(cfg.id, cfg);
    eScores.push(score(simulateOne(candles, cfg), cfg.id, 'evening'));
  }

  const rank = (a: Score, b: Score) => b.rankKey - a.rankKey || b.netRs - a.netRs;
  mScores.sort(rank);
  eScores.sort(rank);

  const mAllDay = mScores.filter((s) => s.allDaysGreen && s.trades >= 3);
  const eAllDay = eScores.filter((s) => s.allDaysGreen && s.trades >= 3);
  const mAllMo = mScores.filter((s) => s.allMonthsGreen && s.trades >= 3);
  const eAllMo = eScores.filter((s) => s.allMonthsGreen && s.trades >= 3);

  // Pair top candidates by rank (not only all-day — may be empty)
  const mPool = (mAllDay.length ? mAllDay : mAllMo.length ? mAllMo : mScores)
    .filter((s) => s.trades >= 3)
    .slice(0, 10);
  const ePool = (eAllDay.length ? eAllDay : eAllMo.length ? eAllMo : eScores)
    .filter((s) => s.trades >= 3)
    .slice(0, 10);

  type PairScore = Score & { morningId: string; eveningId: string };
  const pairs: PairScore[] = [];
  for (const m of mPool) {
    for (const e of ePool) {
      const trades = simulatePair(candles, cfgById.get(m.id)!, cfgById.get(e.id)!);
      const s = score(trades, `${m.id} ++ ${e.id}`, 'both');
      pairs.push({ ...s, morningId: m.id, eveningId: e.id });
    }
  }
  pairs.sort(rank);

  const champ = pairs[0]!;
  const currentPair = {
    ...score(simulatePair(candles, currentM, currentE), 'CURRENT_DESK', 'both'),
    morningId: currentM.id,
    eveningId: currentE.id,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    sample: {
      from: candles[0]?.date,
      to: candles.at(-1)?.date,
      bars: candles.length,
      note: 'Mar–Jul 2026 CRUDEOILM only — short sample',
      rupeesPerPoint: RS,
      morningStrategies: mornings.length,
      eveningStrategies: evenings.length,
      pairs: pairs.length,
    },
    finding: {
      anyMorningAllDaysGreen: mAllDay.length,
      anyEveningAllDaysGreen: eAllDay.length,
      anyPairAllDaysGreen: pairs.filter((p) => p.allDaysGreen).length,
      note:
        mAllDay.length === 0 && eAllDay.length === 0
          ? 'No strategy in the grid had EVERY traded day green on this sample. Champion maximizes months-green + green-day% + profit.'
          : 'All-day-green candidates found.',
    },
    currentDesk: currentPair,
    topMorning: mScores.slice(0, 12),
    topEvening: eScores.slice(0, 12),
    morningAllDaysGreen: mAllDay.slice(0, 10),
    eveningAllDaysGreen: eAllDay.slice(0, 10),
    morningAllMonthsGreen: mAllMo.slice(0, 10),
    eveningAllMonthsGreen: eAllMo.slice(0, 10),
    topPairs: pairs.slice(0, 15),
    champion: champ,
    championCfgs: {
      morning: cfgById.get(champ.morningId),
      evening: cfgById.get(champ.eveningId),
    },
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  const fmt = (s: Score) =>
    `₹${Math.round(s.netRs)} · ${s.trades}tr · WR ${s.wr.toFixed(0)}% · greenDays ${s.greenDays}/${s.days} (${s.greenDayPct.toFixed(0)}%) · months ${s.greenMonths}/${s.months}${s.allDaysGreen ? ' · ALL-DAY' : ''}${s.allMonthsGreen ? ' · ALL-MO' : ''} · worstDay ${s.worstDayPts.toFixed(0)}`;

  console.log('\n=== CRUDE HUNT ~100 STRATS (Mar–Jul 2026) ===\n');
  console.log(`Morning ${mornings.length} · Evening ${evenings.length} · Pairs ${pairs.length}`);
  console.log(`All-day-green mornings: ${mAllDay.length} · evenings: ${eAllDay.length} · pairs: ${pairs.filter((p) => p.allDaysGreen).length}`);
  console.log('\nCURRENT DESK:');
  console.log(' ', fmt(currentPair));
  console.log('\nTOP 5 MORNING:');
  for (const s of mScores.slice(0, 5)) console.log(' ', fmt(s), '\n   ', s.id);
  console.log('\nTOP 5 EVENING:');
  for (const s of eScores.slice(0, 5)) console.log(' ', fmt(s), '\n   ', s.id);
  console.log('\nCHAMPION PAIR:');
  console.log(' ', fmt(champ));
  console.log('  M:', champ.morningId);
  console.log('  E:', champ.eveningId);
  console.log(`\nDelta vs current: ₹${Math.round(champ.netRs - currentPair.netRs)} · greenDay ${champ.greenDayPct.toFixed(0)}% vs ${currentPair.greenDayPct.toFixed(0)}%`);
  console.log(`\nWrote ${OUT}`);
}

main();

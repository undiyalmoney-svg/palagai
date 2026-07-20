/**
 * RESEARCH ONLY — Hunt filters that make BOTH Tuesday AND Friday profitable.
 * Reuses the same champion PDHL simulator as research-tue-fri-pdhl.ts.
 *
 *   npx tsx scripts/research-tue-fri-profit-hunt.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const OUT = join(root, 'reports/tue-fri-profit-hunt.json');

type Candle = { date: string; open: number; high: number; low: number; close: number };
type Dir = 'BUY' | 'SELL';

interface Params {
  id: string;
  maxStopPts: number;
  minStopPts: number;
  targetR: number;
  dayMaxLoss: number;
  earliest: string;
  lastEntry: string;
  rsPerPt: number;
}

interface Trade {
  date: string;
  dow: number;
  dir: Dir;
  pts: number;
  rs: number;
  riskPts: number;
  exitReason: string;
  orWidth: number;
  entryHhmm: string;
  dayTradeNum: number;
  bias: Dir;
}

function hhmm(iso: string): string {
  return iso.match(/T(\d{2}:\d{2})/)?.[1] ?? '00:00';
}
function day(iso: string): string {
  return iso.slice(0, 10);
}
function dow(iso: string): number {
  return new Date(`${day(iso)}T12:00:00`).getDay();
}
function emaLast(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += closes[i]!;
  let prev = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i += 1) prev = closes[i]! * k + prev * (1 - k);
  return prev;
}
function openingRange(dayBars: Candle[]): { high: number; low: number; mid: number } | null {
  let high = -Infinity;
  let low = Infinity;
  for (const c of dayBars) {
    const t = hhmm(c.date);
    if (t >= '09:15' && t < '10:15') {
      high = Math.max(high, c.high);
      low = Math.min(low, c.low);
    }
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { high, low, mid: (high + low) / 2 };
}
function swingAt(candles: Candle[], idx: number, lookback = 3): { high: number; low: number } | null {
  if (idx < lookback) return null;
  let high = -Infinity;
  let low = Infinity;
  for (let i = idx - lookback; i < idx; i += 1) {
    high = Math.max(high, candles[i]!.high);
    low = Math.min(low, candles[i]!.low);
  }
  return Number.isFinite(high) ? { high, low } : null;
}
function load(path: string): Candle[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Candle[];
  return raw.map((c) => ({
    ...c,
    date: c.date.includes('T') ? c.date : c.date.replace(' ', 'T'),
  }));
}

/** Exact champion DNA path matching research-tue-fri-pdhl.ts */
function simulate(candles: Candle[], p: Params): Trade[] {
  const trades: Trade[] = [];
  let open: {
    dir: Dir;
    entry: number;
    stop: number;
    target: number;
    entryTime: string;
    date: string;
    risk: number;
    orHigh: number;
    orLow: number;
    orMid: number;
    bias: Dir;
    dayTradeNum: number;
    entryIdx: number;
  } | null = null;

  let tradingDate: string | null = null;
  let dayNet = 0;
  let tradesToday = 0;
  let dayStopped = false;
  let dayBars: Candle[] = [];

  for (let i = 60; i < candles.length; i += 1) {
    const c = candles[i]!;
    const d = day(c.date);
    const t = hhmm(c.date);

    if (tradingDate !== d) {
      tradingDate = d;
      dayNet = 0;
      tradesToday = 0;
      dayStopped = false;
      dayBars = [];
    }
    dayBars.push(c);

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
      if (exit == null) {
        const closes = candles.slice(Math.max(0, i - 80), i + 1).map((x) => x.close);
        const ema = emaLast(closes, 20);
        if (ema != null) {
          if (open.dir === 'BUY' && c.close < ema) {
            exit = c.close;
            reason = 'EMA20';
          }
          if (open.dir === 'SELL' && c.close > ema) {
            exit = c.close;
            reason = 'EMA20';
          }
        }
      }
      if (exit == null && t >= '15:15') {
        exit = c.close;
        reason = 'CLOSE';
      }
      if (exit != null) {
        const pts = open.dir === 'BUY' ? exit - open.entry : open.entry - exit;
        trades.push({
          date: open.date,
          dow: dow(open.entryTime),
          dir: open.dir,
          pts,
          rs: pts * p.rsPerPt,
          riskPts: open.risk,
          exitReason: reason,
          orWidth: open.orHigh - open.orLow,
          entryHhmm: hhmm(open.entryTime),
          dayTradeNum: open.dayTradeNum,
          bias: open.bias,
        });
        dayNet += pts;
        tradesToday += 1;
        if (dayNet <= -p.dayMaxLoss) dayStopped = true;
        open = null;
      }
      continue;
    }

    if (dayStopped) continue;
    if (t < '10:15') continue;
    if (t < p.earliest || t > p.lastEntry) continue;

    const or = openingRange(dayBars);
    if (!or) continue;
    const bias: Dir = c.close >= or.mid ? 'BUY' : 'SELL';
    const swing = swingAt(candles, i, 3);
    if (!swing) continue;

    let dir: Dir | null = null;
    if (bias === 'BUY' && c.close > swing.high) dir = 'BUY';
    else if (bias === 'SELL' && c.close < swing.low) dir = 'SELL';
    if (!dir) continue;

    const entry = c.close;
    let stop = dir === 'BUY' ? c.low : c.high;
    let risk = Math.abs(entry - stop);
    if (risk < p.minStopPts) continue;
    if (risk > p.maxStopPts) {
      stop = dir === 'BUY' ? entry - p.maxStopPts : entry + p.maxStopPts;
      risk = p.maxStopPts;
    }
    if (dayNet - risk < -p.dayMaxLoss) continue;

    const targetPts = risk * p.targetR;
    open = {
      dir,
      entry,
      stop,
      target: dir === 'BUY' ? entry + targetPts : entry - targetPts,
      entryTime: c.date,
      date: d,
      risk,
      orHigh: or.high,
      orLow: or.low,
      orMid: or.mid,
      bias,
      dayTradeNum: tradesToday + 1,
      entryIdx: i,
    };
  }
  return trades;
}

type DayStats = {
  trades: number;
  wins: number;
  losses: number;
  wr: number;
  netRs: number;
  days: number;
  greenDays: number;
  greenDayPct: number;
};

function dayStats(rows: Trade[]): DayStats {
  const byDate = new Map<string, number>();
  let wins = 0;
  let losses = 0;
  let netRs = 0;
  for (const t of rows) {
    netRs += t.rs;
    if (t.rs > 0) wins += 1;
    else if (t.rs < 0) losses += 1;
    byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.rs);
  }
  let green = 0;
  for (const v of byDate.values()) if (v > 0) green += 1;
  const days = byDate.size;
  return {
    trades: rows.length,
    wins,
    losses,
    wr: rows.length ? (100 * wins) / rows.length : 0,
    netRs,
    days,
    greenDays: green,
    greenDayPct: days ? (100 * green) / days : 0,
  };
}

type Filter = { id: string; label: string; fn: (t: Trade) => boolean };

function buildFilters(isBank: boolean): Filter[] {
  const orCuts = isBank ? [120, 150, 180, 220, 280, 9999] : [50, 70, 90, 110, 130, 9999];
  const windows: Array<[string, string, string]> = [
    ['any', '00:00', '99:99'],
    ['before_11', '00:00', '11:00'],
    ['before_12', '00:00', '12:00'],
    ['after_11', '11:00', '99:99'],
    ['after_12', '12:00', '99:99'],
    ['mid_11_14', '11:00', '14:00'],
    ['late_avoid_early', '11:30', '15:00'],
    ['sweet_12_14', '12:00', '14:00'],
  ];
  const maxTrades = [1, 2, 3, 99];
  const dirs: Array<'ANY' | 'BUY' | 'SELL'> = ['ANY', 'BUY', 'SELL'];
  const dropEmaLoss = [false, true];

  const out: Filter[] = [];
  for (const maxT of maxTrades) {
    for (const [wId, lo, hi] of windows) {
      for (const orCut of orCuts) {
        for (const dir of dirs) {
          for (const dropEma of dropEmaLoss) {
            const id = `max${maxT}|${wId}|or<${orCut}|${dir}|emaDrop${dropEma ? 1 : 0}`;
            out.push({
              id,
              label: `maxTrades=${maxT === 99 ? '∞' : maxT}; window=${wId}; OR<${orCut === 9999 ? '∞' : orCut}; dir=${dir}; dropLosingEMA=${dropEma}`,
              fn: (t) => {
                if (t.dayTradeNum > maxT) return false;
                if (t.entryHhmm < lo || t.entryHhmm >= hi) return false;
                if (orCut < 9999 && t.orWidth >= orCut) return false;
                if (dir === 'BUY' && t.dir !== 'BUY') return false;
                if (dir === 'SELL' && t.dir !== 'SELL') return false;
                if (dropEma && t.exitReason === 'EMA20' && t.rs < 0) return false;
                return true;
              },
            });
          }
        }
      }
    }
  }
  return out;
}

type HuntResult = {
  filterId: string;
  label: string;
  tue: DayStats;
  fri: DayStats;
  tueFri: DayStats;
  bothProfitable: boolean;
  minDayNet: number;
  score: number;
  hasHypotheticalEmaDrop: boolean;
};

function huntDayPair(tue: Trade[], fri: Trade[], isBank: boolean): HuntResult[] {
  const filters = buildFilters(isBank);
  const results: HuntResult[] = [];

  for (const f of filters) {
    const tueF = tue.filter(f.fn);
    const friF = fri.filter(f.fn);
    if (tueF.length < 30 || friF.length < 30) continue;
    const ts = dayStats(tueF);
    const fs = dayStats(friF);
    const both = ts.netRs > 0 && fs.netRs > 0;
    const combined = dayStats([...tueF, ...friF]);
    const minDayNet = Math.min(ts.netRs, fs.netRs);
    const hasHypotheticalEmaDrop = f.label.includes('dropLosingEMA=true');
    const score =
      (both ? 1_000_000_000 : 0) +
      (hasHypotheticalEmaDrop ? 0 : 50_000_000) +
      minDayNet * 10 +
      combined.netRs +
      combined.greenDayPct * 100;
    results.push({
      filterId: f.id,
      label: f.label,
      tue: ts,
      fri: fs,
      tueFri: combined,
      bothProfitable: both,
      minDayNet,
      score,
      hasHypotheticalEmaDrop,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function huntSeparateThenCombine(tue: Trade[], fri: Trade[], isBank: boolean) {
  const filters = buildFilters(isBank).filter((f) => !f.label.includes('dropLosingEMA=true'));
  let bestTue: { f: Filter; s: DayStats } | null = null;
  let bestFri: { f: Filter; s: DayStats } | null = null;

  for (const f of filters) {
    const tueF = tue.filter(f.fn);
    const friF = fri.filter(f.fn);
    if (tueF.length >= 30) {
      const s = dayStats(tueF);
      if (!bestTue || s.netRs > bestTue.s.netRs) bestTue = { f, s };
    }
    if (friF.length >= 30) {
      const s = dayStats(friF);
      if (!bestFri || s.netRs > bestFri.s.netRs) bestFri = { f, s };
    }
  }
  if (!bestTue || !bestFri) return null;
  return {
    tueFilter: bestTue.f.label,
    friFilter: bestFri.f.label,
    tue: {
      netRs: Math.round(bestTue.s.netRs),
      trades: bestTue.s.trades,
      wr: +bestTue.s.wr.toFixed(1),
      greenDayPct: +bestTue.s.greenDayPct.toFixed(1),
    },
    fri: {
      netRs: Math.round(bestFri.s.netRs),
      trades: bestFri.s.trades,
      wr: +bestFri.s.wr.toFixed(1),
      greenDayPct: +bestFri.s.greenDayPct.toFixed(1),
    },
    bothProfitable: bestTue.s.netRs > 0 && bestFri.s.netRs > 0,
  };
}

function compact(r: HuntResult) {
  return {
    label: r.label,
    bothProfitable: r.bothProfitable,
    hypotheticalEmaDrop: r.hasHypotheticalEmaDrop,
    tueNetRs: Math.round(r.tue.netRs),
    friNetRs: Math.round(r.fri.netRs),
    tueFriNetRs: Math.round(r.tueFri.netRs),
    tueTrades: r.tue.trades,
    friTrades: r.fri.trades,
    tueWr: +r.tue.wr.toFixed(1),
    friWr: +r.fri.wr.toFixed(1),
    tueGreenPct: +r.tue.greenDayPct.toFixed(1),
    friGreenPct: +r.fri.greenDayPct.toFixed(1),
    minDayNet: Math.round(r.minDayNet),
  };
}

function analyze(name: string, path: string, params: Params) {
  const candles = load(path);
  const all = simulate(candles, params);
  const tue = all.filter((t) => t.dow === 2);
  const fri = all.filter((t) => t.dow === 5);
  const isBank = params.id === 'bank';

  const baseline = {
    tue: {
      netRs: Math.round(dayStats(tue).netRs),
      trades: tue.length,
      wr: +dayStats(tue).wr.toFixed(1),
    },
    fri: {
      netRs: Math.round(dayStats(fri).netRs),
      trades: fri.length,
      wr: +dayStats(fri).wr.toFixed(1),
    },
  };

  const ranked = huntDayPair(tue, fri, isBank);
  const bothOk = ranked.filter((r) => r.bothProfitable);
  const bothOkReal = bothOk.filter((r) => !r.hasHypotheticalEmaDrop);
  const separate = huntSeparateThenCombine(tue, fri, isBank);

  const practical = bothOkReal.filter(
    (r) => r.tue.trades >= 80 && r.fri.trades >= 80 && r.tue.greenDayPct >= 45 && r.fri.greenDayPct >= 45,
  );

  return {
    instrument: name,
    sample: { from: candles[0]?.date, to: candles.at(-1)?.date, bars: candles.length },
    baseline,
    filtersTried: ranked.length,
    bothProfitableCount: bothOk.length,
    bothProfitableWithoutEmaHack: bothOkReal.length,
    topPracticalSameRule: practical.slice(0, 12).map(compact),
    topBothGreenReal: bothOkReal.slice(0, 12).map(compact),
    topBothGreenIncludingEmaHack: bothOk.slice(0, 8).map(compact),
    separateDayRules: separate,
    verdict: {
      canMakeBothProfitableWithSameRule: bothOkReal.length > 0,
      bestPractical: practical[0] ? compact(practical[0]) : bothOkReal[0] ? compact(bothOkReal[0]) : null,
      separateDayRulesWork: separate?.bothProfitable ?? false,
      separateDayRules: separate,
    },
  };
}

function main(): void {
  const nifty = analyze('Nifty 50', join(root, 'reports/analyst-cache/nifty-5m-2020-2026.json'), {
    id: 'nifty',
    maxStopPts: 30,
    minStopPts: 3,
    targetR: 1,
    dayMaxLoss: 60,
    earliest: '09:20',
    lastEntry: '15:10',
    rsPerPt: 65,
  });

  const bank = analyze('Bank Nifty', join(root, 'reports/analyst-cache/banknifty-5m-2020-2026.json'), {
    id: 'bank',
    maxStopPts: 45,
    minStopPts: 3,
    targetR: 1,
    dayMaxLoss: 60,
    earliest: '09:20',
    lastEntry: '15:10',
    rsPerPt: 30,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'Research only — make BOTH Tue AND Fri profitable',
    years: '2020-01-01 → 2026-07-10 (~6.5 years)',
    dna: 'Champion PDHL OR+swing, 1R, EMA-20, day −60',
    note: 'dropLosingEMA=true is a hypothetical post-hoc removal of losing EMA exits — not a live rule until re-simulated.',
    nifty,
    bank,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== MAKE TUE + FRI BOTH PROFITABLE (~6.5y) ===\n');
  for (const inst of [nifty, bank]) {
    console.log(`\n## ${inst.instrument}`);
    console.log(`Baseline: Tue ₹${inst.baseline.tue.netRs} | Fri ₹${inst.baseline.fri.netRs}`);
    console.log(
      `Both-green same-rule (real): ${inst.bothProfitableWithoutEmaHack} / ${inst.filtersTried} filters`,
    );
    console.log('Verdict:', JSON.stringify(inst.verdict, null, 2));
  }
  console.log(`\nWrote ${OUT}`);
}

main();

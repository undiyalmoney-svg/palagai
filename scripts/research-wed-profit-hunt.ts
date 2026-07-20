/**
 * RESEARCH + apply check: make Wednesday green with same-style filters as Tue/Fri.
 *   npx tsx scripts/research-wed-profit-hunt.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const OUT = join(root, 'reports/wed-profit-hunt.json');

type Candle = { date: string; open: number; high: number; low: number; close: number };
type Dir = 'BUY' | 'SELL';
type Trade = {
  date: string;
  dow: number;
  dir: Dir;
  rs: number;
  orWidth: number;
  entryHhmm: string;
  dayTradeNum: number;
};

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
function openingRange(dayBars: Candle[]) {
  let high = -Infinity;
  let low = Infinity;
  for (const c of dayBars) {
    const t = hhmm(c.date);
    if (t >= '09:15' && t < '10:15') {
      high = Math.max(high, c.high);
      low = Math.min(low, c.low);
    }
  }
  if (!Number.isFinite(high)) return null;
  return { high, low, mid: (high + low) / 2 };
}
function swingAt(candles: Candle[], idx: number, lookback = 3) {
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

function simulate(
  candles: Candle[],
  p: {
    maxStopPts: number;
    minStopPts: number;
    targetR: number;
    dayMaxLoss: number;
    earliest: string;
    lastEntry: string;
    rsPerPt: number;
  },
): Trade[] {
  const trades: Trade[] = [];
  let open: {
    dir: Dir;
    entry: number;
    stop: number;
    target: number;
    entryTime: string;
    date: string;
    orHigh: number;
    orLow: number;
    dayTradeNum: number;
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
          rs: pts * p.rsPerPt,
          orWidth: open.orHigh - open.orLow,
          entryHhmm: hhmm(open.entryTime),
          dayTradeNum: open.dayTradeNum,
        });
        dayNet += pts;
        tradesToday += 1;
        if (dayNet <= -p.dayMaxLoss) dayStopped = true;
        open = null;
      }
      continue;
    }

    if (dayStopped) continue;
    if (t < '10:15' || t < p.earliest || t > p.lastEntry) continue;
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
    open = {
      dir,
      entry,
      stop,
      target: dir === 'BUY' ? entry + risk * p.targetR : entry - risk * p.targetR,
      entryTime: c.date,
      date: d,
      orHigh: or.high,
      orLow: or.low,
      dayTradeNum: tradesToday + 1,
    };
  }
  return trades;
}

function stats(rows: Trade[]) {
  let net = 0;
  let wins = 0;
  const by = new Map<string, number>();
  for (const t of rows) {
    net += t.rs;
    if (t.rs > 0) wins += 1;
    by.set(t.date, (by.get(t.date) ?? 0) + t.rs);
  }
  let green = 0;
  for (const v of by.values()) if (v > 0) green += 1;
  return {
    trades: rows.length,
    wr: rows.length ? +((100 * wins) / rows.length).toFixed(1) : 0,
    netRs: Math.round(net),
    days: by.size,
    greenPct: by.size ? +((100 * green) / by.size).toFixed(1) : 0,
  };
}

type F = { label: string; fn: (t: Trade) => boolean };

function buildFilters(isBank: boolean): F[] {
  const orCuts = isBank ? [120, 180, 220, 280, 9999] : [70, 90, 110, 130, 9999];
  const windows: Array<[string, string, string]> = [
    ['any', '00:00', '99:99'],
    ['before_11', '00:00', '11:00'],
    ['before_12', '00:00', '12:00'],
    ['after_11', '11:00', '99:99'],
    ['after_12', '12:00', '99:99'],
    ['late_avoid_early', '11:30', '15:00'],
    ['sweet_12_14', '12:00', '14:00'],
    ['mid_11_14', '11:00', '14:00'],
  ];
  const maxT = [1, 2, 3, 99];
  const dirs: Array<'ANY' | 'BUY' | 'SELL'> = ['ANY', 'BUY', 'SELL'];
  const out: F[] = [];
  for (const m of maxT) {
    for (const [w, lo, hi] of windows) {
      for (const or of orCuts) {
        for (const d of dirs) {
          out.push({
            label: `max${m === 99 ? '∞' : m}|${w}|or<${or === 9999 ? '∞' : or}|${d}`,
            fn: (t) =>
              t.dayTradeNum <= m &&
              t.entryHhmm >= lo &&
              t.entryHhmm < hi &&
              (or >= 9999 || t.orWidth < or) &&
              (d === 'ANY' || t.dir === d),
          });
        }
      }
    }
  }
  return out;
}

function hunt(name: string, path: string, p: Parameters<typeof simulate>[1], isBank: boolean) {
  const all = simulate(load(path), p);
  const wed = all.filter((t) => t.dow === 3);
  const base = stats(wed);
  const ranked = buildFilters(isBank)
    .map((f) => {
      const rows = wed.filter(f.fn);
      if (rows.length < 40) return null;
      const s = stats(rows);
      return { label: f.label, ...s, green: s.netRs > 0 };
    })
    .filter(Boolean) as Array<ReturnType<typeof stats> & { label: string; green: boolean }>;
  ranked.sort((a, b) => (b.green ? 1e9 : 0) - (a.green ? 1e9 : 0) + b.netRs - a.netRs);
  const green = ranked.filter((r) => r.green);
  const sameKey = isBank ? 'max2|late_avoid_early|or<∞|ANY' : 'max3|late_avoid_early|or<∞|ANY';
  const same = ranked.find((r) => r.label === sameKey) ?? null;
  const practical = green.find(
    (r) =>
      r.label.includes('late_avoid_early') &&
      r.label.includes('|ANY') &&
      !r.label.includes('|BUY') &&
      !r.label.includes('|SELL'),
  );
  return {
    instrument: name,
    baseline: base,
    greenCount: green.length,
    tried: ranked.length,
    sameAsTueFriRule: same,
    bestPracticalLateWindow: practical ?? green[0] ?? null,
    topGreen: green.slice(0, 10),
  };
}

function main() {
  const nifty = hunt(
    'Nifty 50',
    join(root, 'reports/analyst-cache/nifty-5m-2020-2026.json'),
    {
      maxStopPts: 30,
      minStopPts: 3,
      targetR: 1,
      dayMaxLoss: 60,
      earliest: '09:20',
      lastEntry: '15:10',
      rsPerPt: 65,
    },
    false,
  );
  const bank = hunt(
    'Bank Nifty',
    join(root, 'reports/analyst-cache/banknifty-5m-2020-2026.json'),
    {
      maxStopPts: 45,
      minStopPts: 3,
      targetR: 1,
      dayMaxLoss: 60,
      earliest: '09:20',
      lastEntry: '15:10',
      rsPerPt: 30,
    },
    true,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    years: '2020–2026',
    nifty,
    bank,
    recommendation: {
      applySameTueFriRuleToWed:
        (nifty.sameAsTueFriRule?.green ?? false) || (bank.sameAsTueFriRule?.green ?? false),
      niftySameRule: nifty.sameAsTueFriRule,
      bankSameRule: bank.sameAsTueFriRule,
      note: 'If same Tue/Fri rule (11:30 + max trades) turns Wed green, extend optimized weekdays to Tue/Wed/Fri.',
    },
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.recommendation, null, 2));
  console.log('\nNifty Wed baseline', nifty.baseline, 'same rule', nifty.sameAsTueFriRule);
  console.log('Bank Wed baseline', bank.baseline, 'same rule', bank.sameAsTueFriRule);
  console.log('Nifty top', nifty.topGreen.slice(0, 3));
  console.log('Bank top', bank.topGreen.slice(0, 3));
  console.log('Wrote', OUT);
}

main();

/**
 * RESEARCH ONLY — Tuesday & Friday deep dive for Nifty / Bank Nifty champion PDHL DNA.
 * Does not change app strategy. Writes reports/tue-fri-optimization-research.json
 *
 *   npx tsx scripts/research-tue-fri-pdhl.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const OUT = join(root, 'reports/tue-fri-optimization-research.json');

type Candle = { date: string; open: number; high: number; low: number; close: number; volume?: number };
type Dir = 'BUY' | 'SELL';

interface Params {
  id: string;
  name: string;
  maxStopPts: number;
  minStopPts: number;
  targetR: number;
  dayMaxLoss: number;
  earliest: string;
  lastEntry: string;
  rsPerPt: number;
}

interface Trade {
  instrument: string;
  date: string;
  dow: number; // 0=Sun..6=Sat
  dir: Dir;
  entryTime: string;
  exitTime: string;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  pts: number;
  rs: number;
  riskPts: number;
  exitReason: string;
  orHigh: number;
  orLow: number;
  orWidth: number;
  orMid: number;
  bias: Dir;
  entryHhmm: string;
  holdBars: number;
  dayTradeNum: number;
  priorDayNetPts: number;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  for (let i = period; i < closes.length; i += 1) {
    prev = closes[i]! * k + prev * (1 - k);
  }
  return prev;
}

function openingRange(
  dayBars: Candle[],
  marketOpen = '09:15',
  firstHourEnd = '10:15',
): { high: number; low: number; mid: number } | null {
  let high = -Infinity;
  let low = Infinity;
  for (const c of dayBars) {
    const t = hhmm(c.date);
    if (t >= marketOpen && t < firstHourEnd) {
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
    priorDayNetPts: number;
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
          instrument: p.id,
          date: open.date,
          dow: dow(open.entryTime),
          dir: open.dir,
          entryTime: open.entryTime,
          exitTime: c.date,
          entry: open.entry,
          stop: open.stop,
          target: open.target,
          exit,
          pts,
          rs: pts * p.rsPerPt,
          riskPts: open.risk,
          exitReason: reason,
          orHigh: open.orHigh,
          orLow: open.orLow,
          orWidth: open.orHigh - open.orLow,
          orMid: open.orMid,
          bias: open.bias,
          entryHhmm: hhmm(open.entryTime),
          holdBars: i - open.entryIdx,
          dayTradeNum: open.dayTradeNum,
          priorDayNetPts: open.priorDayNetPts,
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
      priorDayNetPts: dayNet,
      entryIdx: i,
    };
  }
  return trades;
}

function load(path: string): Candle[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Candle[];
  return raw.map((c) => ({
    ...c,
    date: c.date.includes('T') ? c.date : c.date.replace(' ', 'T'),
  }));
}

function bucketEntry(hh: string): string {
  if (hh < '10:30') return '10:15–10:29';
  if (hh < '11:00') return '10:30–10:59';
  if (hh < '12:00') return '11:00–11:59';
  if (hh < '13:00') return '12:00–12:59';
  if (hh < '14:00') return '13:00–13:59';
  if (hh < '15:00') return '14:00–14:59';
  return '15:00+';
}

function orWidthBucket(w: number, isBank: boolean): string {
  const s = isBank ? [80, 120, 180, 250] : [40, 60, 90, 130];
  if (w < s[0]!) return `narrow(<${s[0]})`;
  if (w < s[1]!) return `mid(${s[0]}–${s[1]})`;
  if (w < s[2]!) return `wide(${s[1]}–${s[2]})`;
  if (w < s[3]!) return `vwide(${s[2]}–${s[3]})`;
  return `extreme(≥${s[3]})`;
}

function summarize(trades: Trade[]) {
  const wins = trades.filter((t) => t.pts > 0);
  const losses = trades.filter((t) => t.pts < 0);
  const netRs = trades.reduce((a, t) => a + t.rs, 0);
  const netPts = trades.reduce((a, t) => a + t.pts, 0);
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.rs);
  const dayNets = [...byDay.values()];
  const greenDays = dayNets.filter((x) => x >= 0).length;
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    wr: trades.length ? (100 * wins.length) / trades.length : 0,
    netPts,
    netRs,
    avgWinRs: wins.length ? wins.reduce((a, t) => a + t.rs, 0) / wins.length : 0,
    avgLossRs: losses.length ? losses.reduce((a, t) => a + t.rs, 0) / losses.length : 0,
    days: dayNets.length,
    greenDays,
    greenDayPct: dayNets.length ? (100 * greenDays) / dayNets.length : 0,
    worstDayRs: dayNets.length ? Math.min(...dayNets) : 0,
    bestDayRs: dayNets.length ? Math.max(...dayNets) : 0,
  };
}

function groupBy<T extends string | number>(trades: Trade[], keyFn: (t: Trade) => T) {
  const map = new Map<T, Trade[]>();
  for (const t of trades) {
    const k = keyFn(t);
    const arr = map.get(k) ?? [];
    arr.push(t);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([key, rows]) => ({ key, ...summarize(rows) }))
    .sort((a, b) => b.netRs - a.netRs);
}

function patternCuts(trades: Trade[], isBank: boolean) {
  const wins = trades.filter((t) => t.pts > 0);
  const losses = trades.filter((t) => t.pts < 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    win: {
      n: wins.length,
      avgOrWidth: avg(wins.map((t) => t.orWidth)),
      avgRisk: avg(wins.map((t) => t.riskPts)),
      avgHoldBars: avg(wins.map((t) => t.holdBars)),
      exitMix: groupBy(wins, (t) => t.exitReason).map((g) => ({
        reason: g.key,
        n: g.trades,
        pct: wins.length ? (100 * g.trades) / wins.length : 0,
      })),
      entryBucket: groupBy(wins, (t) => bucketEntry(t.entryHhmm)).slice(0, 8),
      orWidthBucket: groupBy(wins, (t) => orWidthBucket(t.orWidth, isBank)),
      tradeNum: groupBy(wins, (t) => (t.dayTradeNum === 1 ? '1st' : t.dayTradeNum === 2 ? '2nd' : '3rd+')),
    },
    loss: {
      n: losses.length,
      avgOrWidth: avg(losses.map((t) => t.orWidth)),
      avgRisk: avg(losses.map((t) => t.riskPts)),
      avgHoldBars: avg(losses.map((t) => t.holdBars)),
      exitMix: groupBy(losses, (t) => t.exitReason).map((g) => ({
        reason: g.key,
        n: g.trades,
        pct: losses.length ? (100 * g.trades) / losses.length : 0,
      })),
      entryBucket: groupBy(losses, (t) => bucketEntry(t.entryHhmm)).slice(0, 8),
      orWidthBucket: groupBy(losses, (t) => orWidthBucket(t.orWidth, isBank)),
      tradeNum: groupBy(losses, (t) => (t.dayTradeNum === 1 ? '1st' : t.dayTradeNum === 2 ? '2nd' : '3rd+')),
    },
  };
}

/** Counterfactual: apply filters to trade list (post-hoc / what-if on same signals). */
function counterfactuals(all: Trade[], tueFri: Trade[], isBank: boolean) {
  const orCut = isBank ? 180 : 90;
  const lateCut = '11:00';
  const variants: Array<{ name: string; rows: Trade[]; note: string }> = [
    { name: 'baseline_all_days', rows: all, note: 'Full champion DNA all weekdays' },
    {
      name: 'skip_Tue',
      rows: all.filter((t) => t.dow !== 2),
      note: 'No Tuesday entries',
    },
    {
      name: 'skip_Fri',
      rows: all.filter((t) => t.dow !== 5),
      note: 'No Friday entries',
    },
    {
      name: 'skip_Tue_and_Fri',
      rows: all.filter((t) => t.dow !== 2 && t.dow !== 5),
      note: 'Trade Mon/Wed/Thu only',
    },
    {
      name: 'TueFri_only_first_trade',
      rows: all.filter((t) => (t.dow !== 2 && t.dow !== 5) || t.dayTradeNum === 1),
      note: 'On Tue/Fri allow only 1st trade of day',
    },
    {
      name: 'TueFri_skip_wide_OR',
      rows: all.filter((t) => (t.dow !== 2 && t.dow !== 5) || t.orWidth < orCut),
      note: `On Tue/Fri skip if OR width ≥ ${orCut}`,
    },
    {
      name: 'TueFri_skip_late_entry',
      rows: all.filter((t) => (t.dow !== 2 && t.dow !== 5) || t.entryHhmm < lateCut),
      note: `On Tue/Fri no entries after ${lateCut}`,
    },
    {
      name: 'TueFri_TP_only_keep_SL_EMA',
      rows: (() => {
        // Approximate: drop EMA exits that were losers on Tue/Fri (keep SL/TP/CLOSE)
        return all.filter((t) => {
          if (t.dow !== 2 && t.dow !== 5) return true;
          if (t.exitReason === 'EMA20' && t.pts < 0) return false;
          return true;
        });
      })(),
      note: 'Hypothetical: remove losing EMA exits on Tue/Fri (approx)',
    },
    {
      name: 'TueFri_only_narrow_OR_and_first',
      rows: all.filter(
        (t) =>
          (t.dow !== 2 && t.dow !== 5) ||
          (t.dayTradeNum === 1 && t.orWidth < orCut && t.entryHhmm < lateCut),
      ),
      note: `Tue/Fri: 1st trade only + OR<${orCut} + entry before ${lateCut}`,
    },
  ];

  // Also characterize Tue/Fri-only subsets for context
  void tueFri;

  return variants.map((v) => ({
    name: v.name,
    note: v.note,
    ...summarize(v.rows),
    deltaRsVsBaseline: summarize(v.rows).netRs - summarize(all).netRs,
  }));
}

function analyzeInstrument(name: string, id: string, path: string, params: Params) {
  const candles = load(path);
  const all = simulate(candles, params);
  const byDow = [1, 2, 3, 4, 5].map((d) => {
    const rows = all.filter((t) => t.dow === d);
    return { dow: DOW[d], dowNum: d, ...summarize(rows), patterns: patternCuts(rows, id === 'bank') };
  });
  const tue = all.filter((t) => t.dow === 2);
  const fri = all.filter((t) => t.dow === 5);
  const mid = all.filter((t) => t.dow === 1 || t.dow === 3 || t.dow === 4);

  const weekdayShare = byDow.map((b) => ({
    dow: b.dow,
    netRsSharePct: summarize(all).netRs ? (100 * b.netRs) / summarize(all).netRs : 0,
    tradeSharePct: all.length ? (100 * b.trades) / all.length : 0,
    greenDayPct: b.greenDayPct,
    wr: b.wr,
    netRs: b.netRs,
  }));

  return {
    instrument: name,
    sample: { from: candles[0]?.date, to: candles.at(-1)?.date, bars: candles.length },
    params,
    overall: summarize(all),
    byWeekday: byDow.map(({ patterns: _p, ...rest }) => rest),
    weekdayShare,
    tuesday: {
      summary: summarize(tue),
      patterns: patternCuts(tue, id === 'bank'),
      vsMidweek: {
        midweek: summarize(mid),
        tueMinusMidAvgRsPerTrade:
          (summarize(tue).trades ? summarize(tue).netRs / summarize(tue).trades : 0) -
          (summarize(mid).trades ? summarize(mid).netRs / summarize(mid).trades : 0),
      },
    },
    friday: {
      summary: summarize(fri),
      patterns: patternCuts(fri, id === 'bank'),
      vsMidweek: {
        midweek: summarize(mid),
        friMinusMidAvgRsPerTrade:
          (summarize(fri).trades ? summarize(fri).netRs / summarize(fri).trades : 0) -
          (summarize(mid).trades ? summarize(mid).netRs / summarize(mid).trades : 0),
      },
    },
    counterfactuals: counterfactuals(all, [...tue, ...fri], id === 'bank'),
    topLosingTueFriDays: [...groupBy([...tue, ...fri], (t) => t.date)]
      .filter((g) => g.netRs < 0)
      .sort((a, b) => a.netRs - b.netRs)
      .slice(0, 12)
      .map((g) => ({
        date: g.key,
        dow: DOW[dow(`${g.key}T12:00:00`)],
        ...summarize([...tue, ...fri].filter((t) => t.date === g.key)),
      })),
    topWinningTueFriDays: [...groupBy([...tue, ...fri], (t) => t.date)]
      .filter((g) => g.netRs > 0)
      .sort((a, b) => b.netRs - a.netRs)
      .slice(0, 12)
      .map((g) => ({
        date: g.key,
        dow: DOW[dow(`${g.key}T12:00:00`)],
        ...summarize([...tue, ...fri].filter((t) => t.date === g.key)),
      })),
  };
}

function main(): void {
  const nifty = analyzeInstrument('Nifty 50', 'nifty', join(root, 'reports/analyst-cache/nifty-5m-2020-2026.json'), {
    id: 'nifty',
    name: 'Nifty champion',
    maxStopPts: 30,
    minStopPts: 3,
    targetR: 1,
    dayMaxLoss: 60,
    earliest: '09:20',
    lastEntry: '15:10',
    rsPerPt: 65,
  });

  const bank = analyzeInstrument(
    'Bank Nifty',
    'bank',
    join(root, 'reports/analyst-cache/banknifty-5m-2020-2026.json'),
    {
      id: 'bank',
      name: 'Bank champion',
      maxStopPts: 45,
      minStopPts: 3,
      targetR: 1,
      dayMaxLoss: 60,
      earliest: '09:20',
      lastEntry: '15:10',
      rsPerPt: 30,
    },
  );

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'Research only — no app code changed',
    dna: 'Champion PDHL OR+swing breakout, 1R, EMA-20 exit, day stop −60, Nifty SL cap 30 / Bank 45',
    chargesNote:
      'Index-point P&L below is gross of brokerage/taxes. Today +₹1950 should net charges (brokerage, STT, exchange, GST, stamp) before weekly curve claims.',
    nifty,
    bank,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  const line = (label: string, s: ReturnType<typeof summarize>) =>
    `${label}: ₹${Math.round(s.netRs)} · ${s.trades}tr · WR ${s.wr.toFixed(0)}% · greenDays ${s.greenDayPct.toFixed(0)}%`;

  console.log('\n=== TUE/FRI RESEARCH (champion DNA, 2020–2026) ===\n');
  for (const inst of [nifty, bank]) {
    console.log(`\n## ${inst.instrument}`);
    console.log(line('Overall', inst.overall));
    for (const w of inst.byWeekday) {
      console.log(
        `  ${w.dow}: ₹${Math.round(w.netRs).toString().padStart(8)} · ${String(w.trades).padStart(4)}tr · WR ${w.wr.toFixed(0).padStart(2)}% · green ${w.greenDayPct.toFixed(0)}%`,
      );
    }
    console.log('  Best counterfactuals:');
    for (const c of [...inst.counterfactuals].sort((a, b) => b.netRs - a.netRs).slice(0, 5)) {
      console.log(
        `    ${c.name}: ₹${Math.round(c.netRs)} (Δ ₹${Math.round(c.deltaRsVsBaseline)}) · ${c.note}`,
      );
    }
  }
  console.log(`\nWrote ${OUT}`);
}

main();

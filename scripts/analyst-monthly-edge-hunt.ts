/**
 * Analyst hunt: Nifty 50 + Bank Nifty 5m, 2020–2026
 * Goal: monthly profit ideally 300–1000 pts every month; minimize SL; multi-entry OK.
 * Research only — does not change the Angular app.
 *
 *   KITE_AUTH="$(cat .kite-auth)" npx tsx scripts/analyst-monthly-edge-hunt.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFeatures } from './strategy-discovery/features.ts';
import { fetchHistorical5m, INSTRUMENTS, type InstrumentKey } from './strategy-discovery/fetch-data.ts';
import {
  computeStop,
  computeTarget,
  entrySignal,
  inTimeWindow,
  srLevels,
  trendBias,
} from './strategy-discovery/modules.ts';
import type {
  BarFeatures,
  ClosedTrade,
  EntryId,
  ExitId,
  SrId,
  StopId,
  StrategyDna,
  TargetId,
  TimeId,
  TrendId,
} from './strategy-discovery/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const cacheDir = join(root, 'reports', 'analyst-cache');
const outDir = join(root, 'reports');

const FROM = process.env.FROM ?? '2020-01-01 09:15:00';
const TO = process.env.TO ?? '2026-07-11 15:30:00';

const authRaw = process.env.KITE_AUTH ?? (existsSync(join(root, '.kite-auth'))
  ? readFileSync(join(root, '.kite-auth'), 'utf8').trim()
  : '');
if (!authRaw) {
  console.error('Need KITE_AUTH or .kite-auth');
  process.exit(1);
}
const authorization = authRaw.startsWith('token ') ? authRaw : `token ${authRaw}`;

mkdirSync(cacheDir, { recursive: true });

interface HuntConfig {
  id: string;
  dna: StrategyDna;
  /** Cap absolute stop distance (pts). Skip trade if wider. */
  maxRiskPts: number;
  /** Optional fixed stop distance overriding dna stop geometry. */
  fixedSlPts: number | null;
  /** Lock day after this net profit (pts). 0 = off. */
  dayProfitLock: number;
  /** Stop day after this net loss (pts). 0 = off. */
  dayLossStop: number;
  /** Max trades/day (0 = unlimited via dna.time). */
  maxTradesDay: number;
}

interface MonthStats {
  month: string;
  points: number;
  trades: number;
  wins: number;
  losses: number;
}

interface HuntResult {
  instrument: string;
  id: string;
  dna: StrategyDna;
  maxRiskPts: number;
  fixedSlPts: number | null;
  dayProfitLock: number;
  dayLossStop: number;
  maxTradesDay: number;
  netPts: number;
  trades: number;
  winRate: number;
  pf: number;
  avgRisk: number;
  medianRisk: number;
  months: MonthStats[];
  monthsTotal: number;
  monthsGreen: number;
  monthsInBand: number; // 300–1000
  monthsAbove300: number;
  pctGreen: number;
  pctInBand: number;
  minMonth: number;
  maxMonth: number;
  avgMonth: number;
  score: number;
}

function cachePath(key: InstrumentKey): string {
  return join(cacheDir, `${key}-5m-2020-2026.json`);
}

async function loadCandles(key: InstrumentKey) {
  const path = cachePath(key);
  if (existsSync(path)) {
    console.log(`Cache hit ${path}`);
    return JSON.parse(readFileSync(path, 'utf8')) as {
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }[];
  }
  const meta = INSTRUMENTS[key];
  console.log(`Fetching ${meta.name} ${FROM} → ${TO}…`);
  const candles = await fetchHistorical5m({
    token: meta.token,
    from: FROM,
    to: TO,
    authorization,
    chunkDays: 60,
    delayMs: 2500,
  });
  writeFileSync(path, JSON.stringify(candles));
  console.log(`Saved ${candles.length} bars → ${path}`);
  return candles;
}

/** Backtest with risk cap + optional fixed SL + day budget. */
function backtestHunt(features: BarFeatures[], cfg: HuntConfig): ClosedTrade[] {
  const { dna } = cfg;
  const trades: ClosedTrade[] = [];
  let open: {
    direction: 'BUY' | 'SELL';
    entryTime: string;
    entry: number;
    stop: number;
    target: number;
    risk: number;
  } | null = null;

  let day = '';
  let dayTrades = 0;
  let dayNet = 0;
  let dayStopped = false;

  for (let i = 40; i < features.length; i += 1) {
    const f = features[i]!;
    const prev = features[i - 1] ?? null;

    if (f.day !== day) {
      day = f.day;
      dayTrades = 0;
      dayNet = 0;
      dayStopped = false;
    }

    if (open) {
      let exitPrice: number | null = null;
      let points = 0;

      if (open.direction === 'BUY') {
        if (f.low <= open.stop) {
          exitPrice = open.stop;
          points = exitPrice - open.entry;
        } else if (f.high >= open.target) {
          exitPrice = open.target;
          points = exitPrice - open.entry;
        }
      } else if (f.high >= open.stop) {
        exitPrice = open.stop;
        points = open.entry - exitPrice;
      } else if (f.low <= open.target) {
        exitPrice = open.target;
        points = open.entry - exitPrice;
      }

      const bias = trendBias(f, dna.trend);
      const opposite =
        (open.direction === 'BUY' && bias === 'SELL') ||
        (open.direction === 'SELL' && bias === 'BUY');

      if (exitPrice === null) {
        if (dna.exit === 'ema_exit') {
          if (open.direction === 'BUY' && f.close < f.ema20) {
            exitPrice = f.close;
            points = exitPrice - open.entry;
          } else if (open.direction === 'SELL' && f.close > f.ema20) {
            exitPrice = f.close;
            points = open.entry - exitPrice;
          }
        } else if (dna.exit === 'opposite_signal' && opposite) {
          exitPrice = f.close;
          points = open.direction === 'BUY' ? exitPrice - open.entry : open.entry - exitPrice;
        }
      }

      if (exitPrice === null && f.hhmm >= '15:15') {
        exitPrice = f.close;
        points = open.direction === 'BUY' ? exitPrice - open.entry : open.entry - exitPrice;
      }

      if (exitPrice !== null) {
        trades.push({
          entryTime: open.entryTime,
          exitTime: f.date,
          direction: open.direction,
          entry: open.entry,
          exit: exitPrice,
          stop: open.stop,
          target: open.target,
          points,
          rMultiple: points / open.risk,
          outcome: points > 0 ? 'WIN' : 'LOSS',
          month: f.day.slice(0, 7),
          year: f.day.slice(0, 4),
        });
        dayNet += points;
        open = null;

        if (cfg.dayProfitLock > 0 && dayNet >= cfg.dayProfitLock) dayStopped = true;
        if (cfg.dayLossStop > 0 && dayNet <= -cfg.dayLossStop) dayStopped = true;
        // Soft EOD-profit mode: once day is green after a close, optional lock
        if (cfg.dayProfitLock === -1 && dayNet > 0) dayStopped = true;
      }
      continue;
    }

    if (dayStopped) continue;
    if (cfg.maxTradesDay > 0 && dayTrades >= cfg.maxTradesDay) continue;
    if (!inTimeWindow(f.hhmm, dna.time)) continue;

    const bias = trendBias(f, dna.trend);
    const levels = srLevels(f, dna.sr);
    const signal = entrySignal(f, prev, dna.entry, bias, levels);
    if (!signal) continue;

    const entry = f.close;
    let stop =
      cfg.fixedSlPts != null
        ? signal === 'BUY'
          ? entry - cfg.fixedSlPts
          : entry + cfg.fixedSlPts
        : computeStop(f, signal, entry, dna.stop, levels);

    let risk = Math.abs(entry - stop);
    if (risk < 3) continue;
    if (risk > cfg.maxRiskPts) {
      // tighten to maxRisk if geometry is wider (user: reduce SL as much as possible)
      if (cfg.fixedSlPts == null) {
        stop = signal === 'BUY' ? entry - cfg.maxRiskPts : entry + cfg.maxRiskPts;
        risk = cfg.maxRiskPts;
      } else {
        continue;
      }
    }

    const target =
      cfg.fixedSlPts != null
        ? signal === 'BUY'
          ? entry + risk * (dna.target === 'r_1_5' ? 1.5 : dna.target === 'r_2' ? 2 : dna.target === 'r_2_5' ? 2.5 : 1)
          : entry - risk * (dna.target === 'r_1_5' ? 1.5 : dna.target === 'r_2' ? 2 : dna.target === 'r_2_5' ? 2.5 : 1)
        : computeTarget(f, signal, entry, stop, dna.target, levels);

    open = { direction: signal, entryTime: f.date, entry, stop, target, risk };
    dayTrades += 1;
  }

  return trades;
}

function summarize(instrument: string, cfg: HuntConfig, trades: ClosedTrade[]): HuntResult {
  const byMonth = new Map<string, MonthStats>();
  const risks: number[] = [];
  let wins = 0;
  let gp = 0;
  let gl = 0;

  for (const t of trades) {
    const risk = Math.abs(t.entry - t.stop);
    risks.push(risk);
    const m = byMonth.get(t.month) ?? {
      month: t.month,
      points: 0,
      trades: 0,
      wins: 0,
      losses: 0,
    };
    m.points += t.points;
    m.trades += 1;
    if (t.points > 0) {
      wins += 1;
      gp += t.points;
      m.wins += 1;
    } else {
      gl += Math.abs(t.points);
      m.losses += 1;
    }
    byMonth.set(t.month, m);
  }

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const monthPts = months.map((m) => m.points);
  const monthsGreen = monthPts.filter((p) => p > 0).length;
  const monthsInBand = monthPts.filter((p) => p >= 300 && p <= 1000).length;
  const monthsAbove300 = monthPts.filter((p) => p >= 300).length;
  const netPts = trades.reduce((s, t) => s + t.points, 0);
  const pf = gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
  const avgRisk = risks.length ? risks.reduce((a, b) => a + b, 0) / risks.length : 0;
  const sorted = [...risks].sort((a, b) => a - b);
  const medianRisk = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const minMonth = monthPts.length ? Math.min(...monthPts) : 0;
  const maxMonth = monthPts.length ? Math.max(...monthPts) : 0;
  const avgMonth = monthPts.length ? monthPts.reduce((a, b) => a + b, 0) / monthPts.length : 0;
  const pctGreen = months.length ? (monthsGreen / months.length) * 100 : 0;
  const pctInBand = months.length ? (monthsInBand / months.length) * 100 : 0;

  // Score: prioritize green months, band hit rate, net, low avg risk, floor of worst month
  const score =
    pctGreen * 2.5 +
    pctInBand * 3 +
    monthsAbove300 * 1.5 +
    Math.min(netPts / 100, 40) +
    Math.max(0, 40 - avgRisk) +
    Math.max(0, minMonth / 20) -
    Math.max(0, -minMonth) * 0.05 +
    Math.min(pf, 4) * 8;

  return {
    instrument,
    id: cfg.id,
    dna: cfg.dna,
    maxRiskPts: cfg.maxRiskPts,
    fixedSlPts: cfg.fixedSlPts,
    dayProfitLock: cfg.dayProfitLock,
    dayLossStop: cfg.dayLossStop,
    maxTradesDay: cfg.maxTradesDay,
    netPts,
    trades: trades.length,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    pf,
    avgRisk,
    medianRisk,
    months,
    monthsTotal: months.length,
    monthsGreen,
    monthsInBand,
    monthsAbove300,
    pctGreen,
    pctInBand,
    minMonth,
    maxMonth,
    avgMonth,
    score,
  };
}

function dna(
  trend: TrendId,
  sr: SrId,
  entry: EntryId,
  stop: StopId,
  target: TargetId,
  time: TimeId,
  exit: ExitId,
): StrategyDna {
  return { trend, sr, entry, stop, target, time, exit };
}

function buildConfigs(): HuntConfig[] {
  const configs: HuntConfig[] = [];
  const trends: TrendId[] = ['opening_range', 'ema50', 'supertrend', 'prev_day_trend', 'vwap'];
  const srs: SrId[] = ['pdhl', 'swing', 'session_hl'];
  const entries: EntryId[] = ['bullish_engulfing', 'breakout', 'break_retest', 'pullback', 'hammer'];
  // For bearish_engulfing we need pair — entrySignal handles direction via bias; use engulfing via both by testing bullish with bias
  // Also test bearish separately with opening_range
  const entries2: EntryId[] = ['bearish_engulfing', 'inside_bar_break'];
  const allEntries = [...entries, ...entries2];
  const times: TimeId[] = ['1030_1200', '0920_1030', 'whole_day', '1300_1430'];
  const targets: TargetId[] = ['r_1', 'r_1_5', 'r_2', 'atr_target'];
  const exits: ExitId[] = ['fixed_rr', 'end_of_day', 'ema_exit'];
  const slCaps = [15, 20, 25, 30, 35, 45];
  const fixedSls = [15, 20, 25, 30];
  const dayLocks = [0, 20, 30, 45, -1]; // -1 = lock when day green
  const dayLosses = [0, 30, 45, 60];

  // Priority grid (research DNA + low SL)
  let n = 0;
  for (const trend of ['opening_range', 'ema50', 'supertrend'] as TrendId[]) {
    for (const sr of ['pdhl', 'swing'] as SrId[]) {
      for (const entry of ['bullish_engulfing', 'bearish_engulfing', 'breakout', 'break_retest'] as EntryId[]) {
        for (const time of ['1030_1200', 'whole_day'] as TimeId[]) {
          for (const target of ['r_1_5', 'r_2', 'r_1'] as TargetId[]) {
            for (const exit of ['fixed_rr', 'ema_exit'] as ExitId[]) {
              for (const maxRisk of [20, 25, 30, 45]) {
                for (const lock of [0, 30, 45, -1]) {
                  for (const lossStop of [45, 60]) {
                    n += 1;
                    if (n > 2800) break;
                    configs.push({
                      id: `${trend}|${sr}|${entry}|cap${maxRisk}|${target}|${time}|${exit}|L${lock}|S${lossStop}`,
                      dna: dna(trend, sr, entry, 'candle_hl', target, time, exit),
                      maxRiskPts: maxRisk,
                      fixedSlPts: null,
                      dayProfitLock: lock,
                      dayLossStop: lossStop,
                      maxTradesDay: 0,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Fixed tight SL pack
  for (const trend of ['opening_range', 'ema50'] as TrendId[]) {
    for (const entry of ['bullish_engulfing', 'breakout'] as EntryId[]) {
      for (const sl of fixedSls) {
        for (const target of ['r_1_5', 'r_2'] as TargetId[]) {
          for (const time of ['1030_1200', 'whole_day'] as TimeId[]) {
            for (const lock of [0, 45, -1]) {
              configs.push({
                id: `fixedSL${sl}|${trend}|pdhl|${entry}|${target}|${time}|L${lock}`,
                dna: dna(trend, 'pdhl', entry, 'fixed_points', target, time, 'fixed_rr'),
                maxRiskPts: sl,
                fixedSlPts: sl,
                dayProfitLock: lock,
                dayLossStop: 45,
                maxTradesDay: 0,
              });
            }
          }
        }
      }
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  return configs.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

async function runInstrument(key: InstrumentKey): Promise<HuntResult[]> {
  const candles = await loadCandles(key);
  console.log(`Features ${key}: ${candles.length} bars…`);
  const features = buildFeatures(candles);
  const configs = buildConfigs();
  console.log(`Testing ${configs.length} configs on ${INSTRUMENTS[key].name}…`);

  const results: HuntResult[] = [];
  const t0 = Date.now();
  for (let i = 0; i < configs.length; i += 1) {
    const cfg = configs[i]!;
    const trades = backtestHunt(features, cfg);
    if (trades.length < 80) continue;
    results.push(summarize(key, cfg, trades));
    if ((i + 1) % 200 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${i + 1}/${configs.length} (${elapsed}s) kept=${results.length}`);
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function printTop(label: string, rows: HuntResult[], n = 15) {
  console.log(`\n======== TOP ${n} — ${label} ========`);
  for (const r of rows.slice(0, n)) {
    console.log(
      `${r.score.toFixed(1)} | net=${r.netPts.toFixed(0)} | green=${r.monthsGreen}/${r.monthsTotal} (${r.pctGreen.toFixed(0)}%) | band300-1000=${r.monthsInBand} | minM=${r.minMonth.toFixed(0)} avgM=${r.avgMonth.toFixed(0)} | avgSL=${r.avgRisk.toFixed(1)} | WR=${r.winRate.toFixed(0)}% PF=${r.pf.toFixed(2)} | ${r.id}`,
    );
  }
}

async function main() {
  const keys = (process.env.INSTRUMENT ?? 'nifty,banknifty')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is InstrumentKey => s === 'nifty' || s === 'banknifty');

  const all: Record<string, HuntResult[]> = {};
  for (const key of keys) {
    const rows = await runInstrument(key);
    all[key] = rows;
    printTop(key, rows, 20);

    // Best for "every month green" aspiration
    const mostGreen = [...rows].sort(
      (a, b) => b.pctGreen - a.pctGreen || b.minMonth - a.minMonth || b.score - a.score,
    );
    printTop(`${key} — highest green-month %`, mostGreen, 10);

    const bestBand = [...rows].sort(
      (a, b) => b.monthsInBand - a.monthsInBand || b.pctGreen - a.pctGreen || b.score - a.score,
    );
    printTop(`${key} — most months in 300–1000`, bestBand, 10);

    const lowSlGreen = [...rows]
      .filter((r) => r.avgRisk <= 30 && r.pctGreen >= 55)
      .sort((a, b) => b.pctGreen - a.pctGreen || a.avgRisk - b.avgRisk);
    printTop(`${key} — low SL (≤30) & green≥55%`, lowSlGreen, 10);

    writeFileSync(
      join(outDir, `analyst-monthly-hunt-${key}.json`),
      JSON.stringify(
        {
          range: { from: FROM, to: TO },
          generatedAt: new Date().toISOString(),
          tested: rows.length,
          top50: rows.slice(0, 50),
          mostGreen: mostGreen.slice(0, 30),
          bestBand: bestBand.slice(0, 30),
          lowSlGreen: lowSlGreen.slice(0, 30),
          perfectMonths: rows.filter((r) => r.monthsGreen === r.monthsTotal && r.monthsTotal >= 12),
          nearPerfect: rows.filter(
            (r) => r.pctGreen >= 85 && r.minMonth >= -100 && r.monthsAbove300 >= r.monthsTotal * 0.5,
          ),
        },
        null,
        2,
      ),
    );
  }

  writeFileSync(join(outDir, 'analyst-monthly-hunt-summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    range: { from: FROM, to: TO },
    note: 'Goal was 300–1000 pts EVERY month. Report nearest achievers; perfect streak may not exist.',
    instruments: Object.fromEntries(
      Object.entries(all).map(([k, rows]) => [
        k,
        {
          testedKept: rows.length,
          bestOverall: rows[0] ?? null,
          bestGreenPct: [...rows].sort((a, b) => b.pctGreen - a.pctGreen)[0] ?? null,
          bestBand: [...rows].sort((a, b) => b.monthsInBand - a.monthsInBand)[0] ?? null,
          anyPerfectAllMonthsGreen: rows.some((r) => r.monthsGreen === r.monthsTotal && r.monthsTotal >= 60),
        },
      ]),
    ),
  }, null, 2));

  console.log('\nWrote reports/analyst-monthly-hunt-*.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Grid-search entry/exit configs on live Kite OHLC to maximize net profit and profitable days.
 *
 * Usage:
 *   KITE_AUTH='token key:secret' npx tsx scripts/profit-optimizer.ts
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createFirstHourBreakoutState,
  runFirstHourBreakout,
  resolveFirstHourRange,
} from '../src/app/core/strategy-engine/strategies/first-hour-breakout/first-hour-breakout.evaluator.ts';
import {
  createIntradayReversalState,
  runIntradayReversal,
} from '../src/app/core/strategy-engine/strategies/intraday-reversal/intraday-reversal.evaluator.ts';
import { DailyRegimeTracker } from '../src/app/core/strategy-engine/utils/market-regime.util.ts';
import { extractTradeDate } from '../src/app/core/utils/trade-date.util.ts';
import { extractHhMm } from '../src/app/core/strategy-engine/utils/market-session.util.ts';
import { bodySize, bodyStrengthPct, candleRange } from '../src/app/core/strategy-engine/utils/ohlc-candle.util.ts';
import { evaluateBreakoutCandleQuality } from '../src/app/core/strategy-engine/utils/breakout-candle-quality.util.ts';
import type { Candle } from '../src/app/core/models/candle.model.ts';
import type { StrategyContext } from '../src/app/core/strategy-engine/models/strategy-context.model.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

type Timeframe = '5minute' | '60minute' | '30minute' | '15minute';
type StrategyMode = 'first-hour' | 'reversal' | 'both';
type SlMode = 'candle' | 'first-hour-boundary' | 'wider-1.5x';

interface OptimizerConfig {
  name: string;
  strategy: StrategyMode;
  requireTrendingRegime: boolean;
  requireRangingRegime: boolean;
  /** First hour only */
  maxBreakoutDistancePts: number | null;
  maxBreakoutOppositeWickPct: number | null;
  minBreakoutBodyPct: number | null;
  maxEntryTime: string;
  minEntryTime: string;
  slMode: SlMode;
  oneTradePerDay: boolean;
  directionFilter: 'both' | 'BUY' | 'SELL';
}

interface ClosedTrade {
  date: string;
  time: string;
  strategy: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  exit: number;
  points: number;
  outcome: 'WIN' | 'LOSS';
  exitReason: string;
}

interface DayResult {
  date: string;
  points: number;
  trades: number;
}

interface OptimizerResult {
  config: OptimizerConfig;
  totalTrades: number;
  wins: number;
  losses: number;
  netPoints: number;
  tradingDays: number;
  daysWithTrades: number;
  profitableDays: number;
  losingDays: number;
  flatDays: number;
  dayWinRate: number;
  trades: ClosedTrade[];
  daily: DayResult[];
}

const FROM = process.env.FROM ?? '2026-03-25 09:15:00';
const TO = process.env.TO ?? '2026-07-03 15:30:00';
const INSTRUMENT_TOKEN = process.env.INSTRUMENT_TOKEN ?? '256265';
const LOOKBACK_DAYS = 45;
const GLOBAL_LAST_ENTRY = '14:15';

function parseTs(dateTime: string): number {
  return new Date(dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')).getTime();
}

function subtractDays(dateTime: string, days: number): string {
  const d = new Date(dateTime.replace(' ', 'T'));
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function fetchCandles(interval: Timeframe, from: string, to: string): Promise<Candle[]> {
  const auth = process.env.KITE_AUTH;
  if (!auth) throw new Error('Set KITE_AUTH');
  const params = new URLSearchParams({ from, to });
  const url = `https://api.kite.trade/instruments/historical/${INSTRUMENT_TOKEN}/${interval}?${params}`;
  const res = await fetch(url, {
    headers: { 'X-Kite-Version': '3', Authorization: auth.startsWith('token ') ? auth : `token ${auth}` },
  });
  const body = (await res.json()) as { status?: string; message?: string; data?: { candles?: (string | number)[][] } };
  if (body.status !== 'success' || !body.data?.candles?.length) {
    throw new Error(body.message ?? 'Kite fetch failed');
  }
  return body.data.candles.map((row) => ({
    date: String(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

function activeCandle(candles: Candle[], timestamp: string): Candle {
  const ts = parseTs(timestamp);
  let active = candles[0]!;
  for (const c of candles) {
    if (parseTs(c.date) <= ts) active = c;
    else break;
  }
  return active;
}

function previousCandles(candles: Candle[], timestamp: string): Candle[] {
  const ts = parseTs(timestamp);
  return candles.filter((c) => parseTs(c.date) < ts);
}

function buildContext(
  store: Record<Timeframe, Candle[]>,
  index5m: number,
  step: number,
  replayFrom: string,
  replayTo: string,
  regime?: string,
): StrategyContext {
  const candles5m = store['5minute'];
  const current5m = candles5m[index5m]!;
  const timestamp = current5m.date;
  return {
    candle60m: activeCandle(store['60minute'], timestamp),
    candle30m: activeCandle(store['30minute'], timestamp),
    candle15m: activeCandle(store['15minute'], timestamp),
    candle5m: current5m,
    previous60m: previousCandles(store['60minute'], timestamp),
    previous30m: previousCandles(store['30minute'], timestamp),
    previous15m: previousCandles(store['15minute'], timestamp),
    previous5m: candles5m.slice(0, index5m),
    candleIndex5m: index5m,
    replayStepIndex: step,
    replayFrom,
    replayTo,
    marketRegime: regime as StrategyContext['marketRegime'],
  };
}

function oppositeWickPct(candle: Candle, direction: 'BUY' | 'SELL'): number {
  const body = bodySize(candle);
  if (body <= 0) return 100;
  const upper = candle.high - Math.max(candle.open, candle.close);
  const lower = Math.min(candle.open, candle.close) - candle.low;
  const wick = direction === 'BUY' ? lower : upper;
  return (wick / body) * 100;
}

function breakoutDistance(candle: Candle, direction: 'BUY' | 'SELL', fhHigh: number, fhLow: number): number {
  return direction === 'BUY' ? candle.close - fhHigh : fhLow - candle.close;
}

function applySlMode(
  mode: SlMode,
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  candleSl: number,
  fhHigh: number,
  fhLow: number,
): number {
  if (mode === 'candle') return candleSl;
  if (mode === 'first-hour-boundary') {
    return direction === 'BUY' ? fhLow : fhHigh;
  }
  const risk = Math.abs(entryPrice - candleSl);
  return direction === 'BUY' ? entryPrice - risk * 1.5 : entryPrice + risk * 1.5;
}

function passesFhExtraFilters(
  cfg: OptimizerConfig,
  ctx: StrategyContext,
  direction: 'BUY' | 'SELL',
  entryIndex: number,
  candles5m: Candle[],
): boolean {
  const time = extractHhMm(ctx.candle5m.date);
  if (time < cfg.minEntryTime || time > cfg.maxEntryTime) return false;
  if (cfg.directionFilter !== 'both' && cfg.directionFilter !== direction) return false;

  const fh = resolveFirstHourRange(ctx);
  if (!fh) return false;

  const breakoutIndex = entryIndex - 1;
  const breakout = breakoutIndex >= 0 ? candles5m[breakoutIndex] : null;
  if (!breakout) return false;

  const quality = evaluateBreakoutCandleQuality(
    breakout,
    candles5m[breakoutIndex - 1] ?? null,
    direction,
    fh.high,
    fh.low,
  );

  if (cfg.minBreakoutBodyPct !== null && bodyStrengthPct(breakout) < cfg.minBreakoutBodyPct) {
    return false;
  }
  if (cfg.maxBreakoutOppositeWickPct !== null && oppositeWickPct(breakout, direction) > cfg.maxBreakoutOppositeWickPct) {
    return false;
  }
  if (cfg.maxBreakoutDistancePts !== null) {
    const dist = breakoutDistance(breakout, direction, fh.high, fh.low);
    if (dist > cfg.maxBreakoutDistancePts) return false;
  }

  return quality.passed || cfg.minBreakoutBodyPct === null;
}

function checkExit(candle: Candle, trade: { direction: 'BUY' | 'SELL'; entryPrice: number; stopLoss: number }): {
  shouldExit: boolean;
  exitPrice: number;
  exitReason: string;
  outcome: 'WIN' | 'LOSS';
} {
  if (trade.direction === 'BUY' && candle.low <= trade.stopLoss) {
    return { shouldExit: true, exitPrice: trade.stopLoss, exitReason: 'SL', outcome: 'LOSS' };
  }
  if (trade.direction === 'SELL' && candle.high >= trade.stopLoss) {
    return { shouldExit: true, exitPrice: trade.stopLoss, exitReason: 'SL', outcome: 'LOSS' };
  }
  if (extractHhMm(candle.date) === '15:15') {
    const pts = trade.direction === 'BUY' ? candle.close - trade.entryPrice : trade.entryPrice - candle.close;
    return { shouldExit: true, exitPrice: candle.close, exitReason: '15:15', outcome: pts > 0 ? 'WIN' : 'LOSS' };
  }
  return { shouldExit: false, exitPrice: candle.close, exitReason: '', outcome: 'LOSS' };
}

function runConfig(
  store: Record<Timeframe, Candle[]>,
  replayIndices: number[],
  cfg: OptimizerConfig,
  allTradingDays: string[],
): OptimizerResult {
  const candles5m = store['5minute'];
  const regimeTracker = new DailyRegimeTracker();
  const fhState = createFirstHourBreakoutState();
  const revState = createIntradayReversalState();

  let open: {
    strategy: string;
    direction: 'BUY' | 'SELL';
    entryTime: string;
    entryPrice: number;
    stopLoss: number;
    entryIndex: number;
  } | null = null;

  const closed: ClosedTrade[] = [];
  let globalActive = false;
  const tradedToday = new Set<string>();

  for (let step = 0; step < replayIndices.length; step += 1) {
    const idx = replayIndices[step]!;
    const candle = candles5m[idx]!;
    const tradingDate = extractTradeDate(candle.date);
    const time = extractHhMm(candle.date);
    const all5m = candles5m.slice(0, idx + 1);
    const regime = regimeTracker.resolve(tradingDate, all5m, time);
    const ctx = buildContext(store, idx, step, FROM, TO, regime.regime);

    if (open) {
      const exit = checkExit(candle, open);
      if (exit.shouldExit) {
        const points =
          open.direction === 'BUY' ? exit.exitPrice - open.entryPrice : open.entryPrice - exit.exitPrice;
        closed.push({
          date: tradingDate,
          time: extractHhMm(open.entryTime),
          strategy: open.strategy,
          direction: open.direction,
          entry: open.entryPrice,
          exit: exit.exitPrice,
          points,
          outcome: exit.outcome,
          exitReason: exit.exitReason,
        });
        open = null;
        globalActive = false;
      }
    }

    if (open || globalActive) continue;
    if (time > GLOBAL_LAST_ENTRY) continue;
    if (cfg.oneTradePerDay && tradedToday.has(tradingDate)) continue;

    const tryEntry = (strategy: 'first-hour' | 'reversal', result: ReturnType<typeof runFirstHourBreakout>) => {
      if (result.action !== 'BUY' && result.action !== 'SELL') return false;
      const direction = result.action;

      if (strategy === 'first-hour') {
        if (cfg.requireTrendingRegime && regime.regime !== 'TRENDING') return false;
        if (!passesFhExtraFilters(cfg, ctx, direction, idx, candles5m)) return false;

        const fh = resolveFirstHourRange(ctx)!;
        const sl = applySlMode(cfg.slMode, direction, result.entryPrice, result.stopLoss, fh.high, fh.low);
        open = {
          strategy: 'First Hour Breakout',
          direction,
          entryTime: candle.date,
          entryPrice: result.entryPrice,
          stopLoss: sl,
          entryIndex: idx,
        };
      } else {
        if (cfg.requireRangingRegime && regime.regime !== 'RANGING') return false;
        if (cfg.directionFilter !== 'both' && cfg.directionFilter !== direction) return false;
        if (time < cfg.minEntryTime || time > cfg.maxEntryTime) return false;
        open = {
          strategy: 'Intraday Reversal',
          direction,
          entryTime: candle.date,
          entryPrice: result.entryPrice,
          stopLoss: result.stopLoss,
          entryIndex: idx,
        };
      }

      globalActive = true;
      if (cfg.oneTradePerDay) tradedToday.add(tradingDate);
      return true;
    };

    if (cfg.strategy === 'first-hour' || cfg.strategy === 'both') {
      const fhResult = runFirstHourBreakout(ctx, fhState, regime.regime);
      if (tryEntry('first-hour', fhResult)) continue;
    }

    if (cfg.strategy === 'reversal' || cfg.strategy === 'both') {
      const revResult = runIntradayReversal(ctx, revState, regime.regime);
      if (tryEntry('reversal', revResult)) continue;
    }
  }

  if (open) {
    const last = candles5m[replayIndices[replayIndices.length - 1]!]!;
    const points =
      open.direction === 'BUY' ? last.close - open.entryPrice : open.entryPrice - last.close;
    closed.push({
      date: extractTradeDate(open.entryTime),
      time: extractHhMm(open.entryTime),
      strategy: open.strategy,
      direction: open.direction,
      entry: open.entryPrice,
      exit: last.close,
      points,
      outcome: points > 0 ? 'WIN' : 'LOSS',
      exitReason: 'EOD',
    });
  }

  const dailyMap = new Map<string, number>();
  for (const d of allTradingDays) dailyMap.set(d, 0);
  for (const t of closed) {
    dailyMap.set(t.date, (dailyMap.get(t.date) ?? 0) + t.points);
  }

  const daily: DayResult[] = allTradingDays.map((date) => ({
    date,
    points: dailyMap.get(date) ?? 0,
    trades: closed.filter((t) => t.date === date).length,
  }));

  const daysWithTrades = daily.filter((d) => d.trades > 0);
  const profitableDays = daysWithTrades.filter((d) => d.points > 0).length;
  const losingDays = daysWithTrades.filter((d) => d.points < 0).length;

  return {
    config: cfg,
    totalTrades: closed.length,
    wins: closed.filter((t) => t.outcome === 'WIN').length,
    losses: closed.filter((t) => t.outcome === 'LOSS').length,
    netPoints: closed.reduce((s, t) => s + t.points, 0),
    tradingDays: allTradingDays.length,
    daysWithTrades: daysWithTrades.length,
    profitableDays,
    losingDays,
    flatDays: allTradingDays.length - daysWithTrades.length,
    dayWinRate: daysWithTrades.length ? (profitableDays / daysWithTrades.length) * 100 : 0,
    trades: closed,
    daily,
  };
}

function buildConfigs(): OptimizerConfig[] {
  const configs: OptimizerConfig[] = [];

  const base = (name: string, overrides: Partial<OptimizerConfig>): OptimizerConfig => ({
    name,
    strategy: 'first-hour',
    requireTrendingRegime: true,
    requireRangingRegime: true,
    maxBreakoutDistancePts: null,
    maxBreakoutOppositeWickPct: null,
    minBreakoutBodyPct: null,
    maxEntryTime: '14:15',
    minEntryTime: '10:15',
    slMode: 'candle',
    oneTradePerDay: true,
    directionFilter: 'both',
    ...overrides,
  });

  configs.push(base('Current engine (baseline)', {}));

  for (const maxDist of [12, 15, 18, 20, 25, 30, 35]) {
    for (const maxWick of [5, 8, 10, 12, 15]) {
      configs.push(
        base(`FH dist≤${maxDist} wick≤${maxWick}%`, {
          maxBreakoutDistancePts: maxDist,
          maxBreakoutOppositeWickPct: maxWick,
        }),
      );
    }
  }

  for (const maxDist of [15, 20, 25]) {
    for (const sl of ['candle', 'first-hour-boundary', 'wider-1.5x'] as SlMode[]) {
      configs.push(
        base(`FH dist≤${maxDist} SL=${sl}`, {
          maxBreakoutDistancePts: maxDist,
          maxBreakoutOppositeWickPct: 12,
          slMode: sl,
        }),
      );
    }
  }

  configs.push(base('FH SELL only dist≤20 wick≤12', { directionFilter: 'SELL', maxBreakoutDistancePts: 20, maxBreakoutOppositeWickPct: 12 }));
  configs.push(base('FH BUY only dist≤20 wick≤12', { directionFilter: 'BUY', maxBreakoutDistancePts: 20, maxBreakoutOppositeWickPct: 12 }));
  configs.push(base('FH 10:15-11:30 dist≤20 wick≤12', { maxEntryTime: '11:30', maxBreakoutDistancePts: 20, maxBreakoutOppositeWickPct: 12 }));
  configs.push(base('FH no regime dist≤20 wick≤12', { requireTrendingRegime: false, maxBreakoutDistancePts: 20, maxBreakoutOppositeWickPct: 12 }));
  configs.push(base('Reversal only ranging', { strategy: 'reversal', requireTrendingRegime: false }));
  configs.push(base('Both strategies default', { strategy: 'both' }));
  configs.push(base('Both dist≤20 wick≤12', { strategy: 'both', maxBreakoutDistancePts: 20, maxBreakoutOppositeWickPct: 12 }));

  return configs;
}

function listTradingDays(candles5m: Candle[], replayIndices: number[]): string[] {
  const days = new Set<string>();
  for (const idx of replayIndices) {
    days.add(extractTradeDate(candles5m[idx]!.date));
  }
  return [...days].sort();
}

function printTop(results: OptimizerResult[], sortKey: keyof OptimizerResult, limit = 15) {
  const sorted = [...results].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
  console.log(`\n── Top by ${String(sortKey)} ──\n`);
  console.log(
    pad('Config', 42) +
      pad('Net', 10) +
      pad('Trades', 8) +
      pad('Win%', 8) +
      pad('ProfDays', 10) +
      pad('LossDays', 10),
  );
  console.log('-'.repeat(88));
  for (const r of sorted.slice(0, limit)) {
    const winPct = r.totalTrades ? ((r.wins / r.totalTrades) * 100).toFixed(0) : '0';
    console.log(
      pad(r.config.name, 42) +
        pad(r.netPoints.toFixed(1), 10) +
        pad(String(r.totalTrades), 8) +
        pad(`${winPct}%`, 8) +
        pad(`${r.profitableDays}/${r.daysWithTrades}`, 10) +
        pad(String(r.losingDays), 10),
    );
  }
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s.padEnd(w);
}

async function main() {
  const fetchFrom = subtractDays(FROM, LOOKBACK_DAYS);
  const store = {} as Record<Timeframe, Candle[]>;
  for (const tf of ['5minute', '60minute', '30minute', '15minute'] as Timeframe[]) {
    process.stdout.write(`Fetching ${tf}… `);
    store[tf] = await fetchCandles(tf, tf === '5minute' ? FROM : fetchFrom, TO);
    console.log(store[tf].length);
    if (tf !== '15minute') await new Promise((r) => setTimeout(r, 350));
  }

  const candles5m = store['5minute'];
  const replayIndices = candles5m
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => parseTs(c.date) >= parseTs(FROM) && parseTs(c.date) <= parseTs(TO))
    .map(({ i }) => i);

  const allTradingDays = listTradingDays(candles5m, replayIndices);
  const configs = buildConfigs();

  console.log(`\nOptimizing ${configs.length} configs over ${allTradingDays.length} trading days…`);

  const results: OptimizerResult[] = configs.map((cfg) =>
    runConfig(store, replayIndices, cfg, allTradingDays),
  );

  const bestProfit = [...results].sort((a, b) => b.netPoints - a.netPoints)[0]!;
  const bestDayWin = [...results]
    .filter((r) => r.daysWithTrades >= 3)
    .sort((a, b) => b.profitableDays - a.profitableDays || b.netPoints - a.netPoints)[0]!;
  const allProfitable = results.filter((r) => r.losingDays === 0 && r.daysWithTrades > 0);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║           PROFIT OPTIMIZER — NIFTY 256265         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Range: ${FROM} → ${TO}`);
  console.log(`Trading days in sample: ${allTradingDays.length}`);

  printTop(results, 'netPoints');
  printTop(results.filter((r) => r.totalTrades >= 3), 'dayWinRate');

  console.log('\n── Best net profit config ──');
  printConfigSummary(bestProfit);

  console.log('\n── Best profitable-days config (≥3 trades) ──');
  if (bestDayWin) printConfigSummary(bestDayWin);

  console.log('\n── Configs with ZERO losing days (traded days) ──');
  if (!allProfitable.length) {
    console.log('  None found — no config produced profit on every traded day.');
  } else {
    for (const r of allProfitable.sort((a, b) => b.netPoints - a.netPoints).slice(0, 10)) {
      console.log(`  ${r.config.name}: ${r.netPoints.toFixed(1)} pts, ${r.daysWithTrades} trade days, ${r.totalTrades} trades`);
    }
  }

  const outPath = join(root, 'reports', 'profit-optimizer-results.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        range: { from: FROM, to: TO },
        tradingDays: allTradingDays.length,
        bestNetProfit: summarize(bestProfit),
        bestDayWinRate: bestDayWin ? summarize(bestDayWin) : null,
        zeroLosingDayConfigs: allProfitable.map(summarize),
        allResults: results.map(summarize),
      },
      null,
      2,
    ),
  );
  console.log(`\nFull results: ${outPath}`);
}

function summarize(r: OptimizerResult) {
  return {
    name: r.config.name,
    config: r.config,
    netPoints: r.netPoints,
    totalTrades: r.totalTrades,
    wins: r.wins,
    losses: r.losses,
    daysWithTrades: r.daysWithTrades,
    profitableDays: r.profitableDays,
    losingDays: r.losingDays,
    dayWinRate: r.dayWinRate,
    daily: r.daily.filter((d) => d.trades > 0),
    trades: r.trades,
  };
}

function printConfigSummary(r: OptimizerResult) {
  console.log(`  Name: ${r.config.name}`);
  console.log(`  Net: ${r.netPoints.toFixed(2)} pts | Trades: ${r.totalTrades} (${r.wins}W/${r.losses}L)`);
  console.log(
    `  Trade days: ${r.daysWithTrades} | Profitable days: ${r.profitableDays} | Losing days: ${r.losingDays} | Flat days: ${r.flatDays}`,
  );
  console.log(`  Config: ${JSON.stringify(r.config, null, 2)}`);
  if (r.trades.length) {
    console.log('  Trades:');
    for (const t of r.trades) {
      console.log(
        `    ${t.date} ${t.time} ${t.strategy} ${t.direction} ${t.points > 0 ? '+' : ''}${t.points.toFixed(2)} (${t.exitReason})`,
      );
    }
  }
}

main().catch((e) => {
  console.error('Optimizer failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

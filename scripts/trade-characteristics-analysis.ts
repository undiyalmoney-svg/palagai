/**
 * Trade characteristics analysis — compares winning vs losing historical trades.
 *
 * Usage:
 *   KITE_AUTH='token api_key:access_token' npx tsx scripts/trade-characteristics-analysis.ts
 *   npx tsx scripts/trade-characteristics-analysis.ts --synthetic
 *
 * Env:
 *   FROM / TO — backtest range (default 2026-06-24 09:15 → 2026-07-03 15:30)
 *   SYNTH_DAYS — synthetic trading days when --synthetic (default 40)
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
import {
  attachTradeOutcome,
  buildTradeCharacteristicsReport,
  detectRetestBetweenBreakoutAndEntry,
  measureCandle,
  measureMomentum,
  TradeCharacteristicsRecord,
} from '../src/app/core/reporting/utils/trade-characteristics-analyzer.util.ts';
import type { HistoricalTrade } from '../src/app/core/models/historical-test.model.ts';
import type { Candle } from '../src/app/core/models/candle.model.ts';
import type { StrategyContext } from '../src/app/core/strategy-engine/models/strategy-context.model.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

type Timeframe = '5minute' | '60minute' | '30minute' | '15minute';

const INSTRUMENT_TOKEN = process.env.INSTRUMENT_TOKEN ?? '256265';
const LOOKBACK_DAYS = 45;
const FROM = process.env.FROM ?? '2026-06-24 09:15:00';
const TO = process.env.TO ?? '2026-07-03 15:30:00';
const SYNTH_DAYS = Number(process.env.SYNTH_DAYS ?? 40);
const useSynthetic = process.argv.includes('--synthetic');

type CandleStore = Record<Timeframe, Candle[]>;

interface OpenTrade {
  id: string;
  strategyId: string;
  strategyName: string;
  direction: 'BUY' | 'SELL';
  entryTime: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  entryIndex: number;
  marketRegime?: string;
  entryContext: Partial<TradeCharacteristicsRecord>;
}

interface GlobalState {
  activeStrategyId: string | null;
  lastClosedDirection: 'BUY' | 'SELL' | null;
  lastClosedStrategyId: string | null;
  lastClosedTradingDate: string | null;
  currentTradingDate: string | null;
}

const GLOBAL_LAST_ENTRY_TIME = '14:15';

const STRATEGIES = {
  FH: { id: 'first-hour-breakout', name: 'First Hour Breakout' },
  REV: { id: 'intraday-reversal', name: 'Intraday Reversal' },
} as const;

function subtractDays(dateTime: string, days: number): string {
  const d = new Date(dateTime.replace(' ', 'T'));
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseTs(dateTime: string): number {
  return new Date(dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')).getTime();
}

async function fetchCandles(interval: Timeframe, from: string, to: string): Promise<Candle[]> {
  const auth = process.env.KITE_AUTH;
  if (!auth) {
    throw new Error('KITE_AUTH not set');
  }
  const params = new URLSearchParams({ from, to });
  const url = `https://api.kite.trade/instruments/historical/${INSTRUMENT_TOKEN}/${interval}?${params}`;
  const res = await fetch(url, {
    headers: { 'X-Kite-Version': '3', Authorization: auth.startsWith('token ') ? auth : `token ${auth}` },
  });
  const body = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { candles?: (string | number)[][] };
  };
  if (body.status !== 'success' || !body.data?.candles?.length) {
    throw new Error(body.message ?? `Kite API failed (${res.status})`);
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

function buildReplayIndices(candles5m: Candle[], replayFrom: string, replayTo: string): number[] {
  const fromTs = parseTs(replayFrom);
  const toTs = parseTs(replayTo);
  return candles5m
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => {
      const ts = parseTs(c.date);
      return ts >= fromTs && ts <= toTs;
    })
    .map(({ index }) => index);
}

function activeCandle(candles: Candle[], timestamp: string): Candle {
  const ts = parseTs(timestamp);
  let active = candles[0]!;
  for (const c of candles) {
    if (parseTs(c.date) <= ts) {
      active = c;
    } else {
      break;
    }
  }
  return active;
}

function previousCandles(candles: Candle[], timestamp: string): Candle[] {
  const ts = parseTs(timestamp);
  return candles.filter((c) => parseTs(c.date) < ts);
}

function buildContext(
  store: CandleStore,
  index5m: number,
  replayStepIndex: number,
  replayFrom: string,
  replayTo: string,
  marketRegime?: string,
  marketRegimeReason?: string,
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
    replayStepIndex,
    replayFrom,
    replayTo,
    marketRegime: marketRegime as StrategyContext['marketRegime'],
    marketRegimeReason,
  };
}

function checkExit(candle: Candle, trade: OpenTrade): {
  shouldExit: boolean;
  exitPrice: number;
  exitReason: string;
  outcome: 'WIN' | 'LOSS';
} {
  if (trade.direction === 'BUY') {
    if (candle.low <= trade.stopLoss) {
      return { shouldExit: true, exitPrice: trade.stopLoss, exitReason: 'Stop loss hit', outcome: 'LOSS' };
    }
  } else if (candle.high >= trade.stopLoss) {
    return { shouldExit: true, exitPrice: trade.stopLoss, exitReason: 'Stop loss hit', outcome: 'LOSS' };
  }
  if (extractHhMm(candle.date) === '15:15') {
    const points =
      trade.direction === 'BUY' ? candle.close - trade.entryPrice : trade.entryPrice - candle.close;
    return {
      shouldExit: true,
      exitPrice: candle.close,
      exitReason: 'Market close (15:15 candle)',
      outcome: points > 0 ? 'WIN' : 'LOSS',
    };
  }
  return { shouldExit: false, exitPrice: candle.close, exitReason: '', outcome: 'LOSS' };
}

function buildEntryContext(params: {
  strategyId: string;
  strategyName: string;
  direction: 'BUY' | 'SELL';
  entryIndex: number;
  candles5m: Candle[];
  ctx: StrategyContext;
  analysis: Record<string, unknown>;
  marketRegime?: string;
}): Partial<TradeCharacteristicsRecord> {
  const { direction, entryIndex, candles5m, ctx, analysis, marketRegime } = params;
  const entryCandle = candles5m[entryIndex]!;
  const entryMetrics = measureCandle(entryCandle, direction);
  const entryMomentum = measureMomentum(candles5m, entryIndex);

  const base: Partial<TradeCharacteristicsRecord> = {
    tradeId: '',
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    direction,
    entryTime: entryCandle.date,
    entryTimeHhMm: extractHhMm(entryCandle.date),
    marketRegime,
    entryCandle: entryMetrics,
    entryMomentum,
    entryQualityTotal: (analysis['entryQuality'] as { total?: number } | undefined)?.total,
    riskRewardRatio: typeof analysis['riskRewardRatio'] === 'number' ? analysis['riskRewardRatio'] : undefined,
  };

  if (params.strategyId === STRATEGIES.FH.id) {
    const firstHour = resolveFirstHourRange(ctx);
    const breakoutIndex = entryIndex - 1;
    const breakoutCandle = breakoutIndex >= 0 ? candles5m[breakoutIndex] : undefined;
    if (breakoutCandle && firstHour) {
      const breakoutMetrics = measureCandle(breakoutCandle, direction);
      const distancePts =
        direction === 'BUY'
          ? breakoutCandle.close - firstHour.high
          : firstHour.low - breakoutCandle.close;
      const ref = direction === 'BUY' ? firstHour.high : firstHour.low;
      base.breakoutCandle = breakoutMetrics;
      base.breakoutDistancePts = distancePts;
      base.breakoutDistancePct = ref > 0 ? (distancePts / ref) * 100 : 0;
      base.firstHourRangeWidth = firstHour.high - firstHour.low;
      base.hadRetestBeforeEntry = detectRetestBetweenBreakoutAndEntry(
        candles5m,
        breakoutIndex,
        entryIndex,
        direction,
        firstHour.high,
        firstHour.low,
      );
    }
  }

  if (params.strategyId === STRATEGIES.REV.id) {
    const stages = analysis['stages'] as { retest?: boolean } | undefined;
    base.retestOccurred = stages?.retest ?? analysis['retest'] === true;
    base.confidenceScore =
      typeof analysis['confidenceScore'] === 'number' ? analysis['confidenceScore'] : undefined;
  }

  return base;
}

function canOpenTrade(
  global: GlobalState,
  signal: { action: string; allMet: boolean },
  candle: Candle,
  strategyId: string,
  direction: 'BUY' | 'SELL',
): boolean {
  if (!signal.allMet || (signal.action !== 'BUY' && signal.action !== 'SELL')) {
    return false;
  }
  if (global.activeStrategyId !== null) {
    return false;
  }
  if (extractHhMm(candle.date) > GLOBAL_LAST_ENTRY_TIME) {
    return false;
  }
  const tradingDate = extractTradeDate(candle.date);
  if (
    global.lastClosedDirection === direction &&
    global.lastClosedStrategyId === strategyId &&
    global.lastClosedTradingDate === tradingDate
  ) {
    return false;
  }
  return true;
}

function runBacktestWithCharacteristics(store: CandleStore, replayFrom: string, replayTo: string) {
  const candles5m = store['5minute'];
  const replayIndices = buildReplayIndices(candles5m, replayFrom, replayTo);
  const regimeTracker = new DailyRegimeTracker();
  const fhState = createFirstHourBreakoutState();
  const revState = createIntradayReversalState();

  const global: GlobalState = {
    activeStrategyId: null,
    lastClosedDirection: null,
    lastClosedStrategyId: null,
    lastClosedTradingDate: null,
    currentTradingDate: null,
  };

  const openByStrategy = new Map<string, OpenTrade>();
  const closedTrades: HistoricalTrade[] = [];
  const characteristicRecords: TradeCharacteristicsRecord[] = [];
  let tradeCounter = 0;

  for (let step = 0; step < replayIndices.length; step += 1) {
    const index5m = replayIndices[step]!;
    const tradingDate = extractTradeDate(candles5m[index5m]!.date);
    const time = extractHhMm(candles5m[index5m]!.date);

    if (global.currentTradingDate !== tradingDate) {
      global.currentTradingDate = tradingDate;
      global.lastClosedDirection = null;
      global.lastClosedStrategyId = null;
      global.lastClosedTradingDate = null;
    }

    const all5mToNow = candles5m.slice(0, index5m + 1);
    const regimeResult = regimeTracker.resolve(tradingDate, all5mToNow, time);
    const ctx = buildContext(
      store,
      index5m,
      step,
      replayFrom,
      replayTo,
      regimeResult.regime,
      regimeResult.reason,
    );
    const candle = ctx.candle5m;

    for (const [strategyId, open] of [...openByStrategy.entries()]) {
      const exit = checkExit(candle, open);
      if (exit.shouldExit) {
        const points =
          open.direction === 'BUY' ? exit.exitPrice - open.entryPrice : open.entryPrice - exit.exitPrice;
        const holdingMinutes = Math.max(
          0,
          Math.round((parseTs(candle.date) - parseTs(open.entryTime)) / 60000),
        );
        const historical: HistoricalTrade = {
          id: open.id,
          testId: 'analysis',
          strategyId: open.strategyId,
          strategyName: open.strategyName,
          entryTime: open.entryTime,
          exitTime: candle.date,
          entryPrice: open.entryPrice,
          exitPrice: exit.exitPrice,
          stopLoss: open.stopLoss,
          targetPrice: open.targetPrice,
          direction: open.direction,
          points,
          profitLoss: points,
          confidence: 0,
          entryReason: '',
          exitReason: exit.exitReason,
          holdingMinutes,
          status: exit.exitReason === 'Stop loss hit' ? 'stopped' : 'closed',
          outcome: exit.outcome,
          marketRegime: open.marketRegime,
        };
        closedTrades.push(historical);
        characteristicRecords.push(
          attachTradeOutcome(open.entryContext as Omit<TradeCharacteristicsRecord, 'outcome' | 'points' | 'exitTime' | 'holdingMinutes'>, historical),
        );
        openByStrategy.delete(strategyId);
        global.activeStrategyId = null;
        global.lastClosedDirection = open.direction;
        global.lastClosedStrategyId = strategyId;
        global.lastClosedTradingDate = tradingDate;
      }
    }

    if (global.activeStrategyId !== null) {
      continue;
    }

    const fhResult = runFirstHourBreakout(ctx, fhState, regimeResult.regime);
    const revResult = runIntradayReversal(ctx, revState, regimeResult.regime);

    const candidates = [
      {
        strategyId: STRATEGIES.FH.id,
        strategyName: STRATEGIES.FH.name,
        result: fhResult,
      },
      {
        strategyId: STRATEGIES.REV.id,
        strategyName: STRATEGIES.REV.name,
        result: revResult,
      },
    ];

    for (const candidate of candidates) {
      const { result } = candidate;
      const tradeable = result.action === 'BUY' || result.action === 'SELL';
      if (
        !canOpenTrade(
          global,
          { action: result.action, allMet: tradeable },
          candle,
          candidate.strategyId,
          result.action as 'BUY' | 'SELL',
        )
      ) {
        continue;
      }

      tradeCounter += 1;
      const direction = result.action as 'BUY' | 'SELL';
      const entryContext = buildEntryContext({
        strategyId: candidate.strategyId,
        strategyName: candidate.strategyName,
        direction,
        entryIndex: index5m,
        candles5m,
        ctx,
        analysis: result.analysis,
        marketRegime: regimeResult.regime,
      });

      const open: OpenTrade = {
        id: `trade-${tradeCounter}`,
        strategyId: candidate.strategyId,
        strategyName: candidate.strategyName,
        direction,
        entryTime: candle.date,
        entryPrice: result.entryPrice,
        stopLoss: result.stopLoss,
        targetPrice: result.target,
        entryIndex: index5m,
        marketRegime: regimeResult.regime,
        entryContext: { ...entryContext, tradeId: `trade-${tradeCounter}` },
      };

      openByStrategy.set(candidate.strategyId, open);
      global.activeStrategyId = candidate.strategyId;
      break;
    }
  }

  for (const open of openByStrategy.values()) {
    const lastIdx = replayIndices[replayIndices.length - 1]!;
    const lastCandle = candles5m[lastIdx]!;
    const points =
      open.direction === 'BUY'
        ? lastCandle.close - open.entryPrice
        : open.entryPrice - lastCandle.close;
    const historical: HistoricalTrade = {
      id: open.id,
      testId: 'analysis',
      strategyId: open.strategyId,
      strategyName: open.strategyName,
      entryTime: open.entryTime,
      exitTime: lastCandle.date,
      entryPrice: open.entryPrice,
      exitPrice: lastCandle.close,
      stopLoss: open.stopLoss,
      targetPrice: open.targetPrice,
      direction: open.direction,
      points,
      profitLoss: points,
      confidence: 0,
      entryReason: '',
      exitReason: 'End of backtest range',
      holdingMinutes: Math.max(
        0,
        Math.round((parseTs(lastCandle.date) - parseTs(open.entryTime)) / 60000),
      ),
      status: 'closed',
      outcome: points > 0 ? 'WIN' : 'LOSS',
      marketRegime: open.marketRegime,
    };
    closedTrades.push(historical);
    characteristicRecords.push(
      attachTradeOutcome(open.entryContext as Omit<TradeCharacteristicsRecord, 'outcome' | 'points' | 'exitTime' | 'holdingMinutes'>, historical),
    );
  }

  return { closedTrades, characteristicRecords, replayCandles: replayIndices.length };
}

function generateSyntheticStore(dayCount: number): { store: CandleStore; from: string; to: string } {
  const patterns = [
    'trending_up',
    'trending_down',
    'ranging',
    'trending_up',
    'ranging',
    'trending_down',
    'ranging',
    'volatile',
  ];
  const all5m: Candle[] = [];
  const all60: Candle[] = [];
  const all30: Candle[] = [];
  const all15: Candle[] = [];

  const startDate = new Date('2026-03-01T09:15:00+0530');
  let price = 24000;
  let tradingDayIndex = 0;

  for (let d = 0; d < dayCount * 2 && tradingDayIndex < dayCount; d += 1) {
    const day = new Date(startDate);
    day.setDate(day.getDate() + d);
    if (day.getDay() === 0 || day.getDay() === 6) {
      continue;
    }

    tradingDayIndex += 1;
    const pattern = patterns[tradingDayIndex % patterns.length]!;
    const dateStr = day.toISOString().slice(0, 10);
    let dayOpen = price;
    let dayHigh = price;
    let dayLow = price;

    const firstHourHighTarget = pattern === 'trending_up' ? price + 25 : price + 8;
    const firstHourLowTarget = pattern === 'trending_down' ? price - 25 : price - 8;

    for (let h = 9; h <= 15; h += 1) {
      for (let m = h === 9 ? 15 : 0; m < 60; m += 5) {
        if (h === 15 && m > 25) {
          break;
        }
        const hhMm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const ts = `${dateStr}T${hhMm}:00+0530`;

        let drift = 0;
        const noise = (Math.random() - 0.5) * 4;

        if (hhMm >= '09:15' && hhMm < '10:15') {
          if (pattern === 'trending_up') {
            drift = 1.5 + noise * 0.3;
          } else if (pattern === 'trending_down') {
            drift = -1.5 + noise * 0.3;
          } else if (pattern === 'ranging') {
            drift = Math.sin(tradingDayIndex + m) * 3 + noise * 0.5;
          } else {
            drift = noise;
          }
        } else if (hhMm >= '10:15' && hhMm < '11:00') {
          if (pattern === 'trending_up') {
            drift = 12 + Math.random() * 8;
          } else if (pattern === 'trending_down') {
            drift = -12 - Math.random() * 8;
          } else if (pattern === 'ranging') {
            drift = (Math.random() > 0.5 ? 1 : -1) * (6 + Math.random() * 8);
          } else {
            drift = (Math.random() - 0.5) * 20;
          }
        } else if (hhMm >= '11:00' && hhMm <= '14:00' && pattern === 'ranging') {
          drift = Math.sin(m / 3) * 10 + noise;
        } else {
          drift = pattern.includes('trending') ? noise * 0.8 : noise * 1.2;
        }

        const open = price;
        let close = price + drift;

        if (hhMm === '10:15' && pattern === 'trending_up') {
          close = Math.max(close, firstHourHighTarget + 5);
        }
        if (hhMm === '10:15' && pattern === 'trending_down') {
          close = Math.min(close, firstHourLowTarget - 5);
        }

        const body = Math.abs(close - open);
        const wickMul = pattern.includes('trending') ? 0.15 : 0.35;
        const high = Math.max(open, close) + body * wickMul + Math.random() * 2;
        const low = Math.min(open, close) - body * wickMul * (pattern === 'trending_up' ? 0.4 : 1);
        price = close;
        dayHigh = Math.max(dayHigh, high);
        dayLow = Math.min(dayLow, low);

        all5m.push({
          date: ts,
          open,
          high,
          low,
          close,
          volume: Math.round(8000 + Math.random() * 12000),
        });
      }
    }

    const hourTs = `${dateStr}T09:15:00+0530`;
    all60.push({ date: hourTs, open: dayOpen, high: dayHigh, low: dayLow, close: price, volume: 50000 });
    all30.push({ date: hourTs, open: dayOpen, high: dayHigh, low: dayLow, close: price, volume: 30000 });
    all15.push({ date: hourTs, open: dayOpen, high: dayHigh, low: dayLow, close: price, volume: 20000 });
  }

  const from = all5m[0]!.date.replace('T', ' ').replace('+0530', '');
  const last = all5m[all5m.length - 1]!;
  const to = last.date.replace('T', ' ').replace('+0530', '');

  return {
    store: { '5minute': all5m, '60minute': all60, '30minute': all30, '15minute': all15 },
    from,
    to,
  };
}

function printReport(
  report: ReturnType<typeof buildTradeCharacteristicsReport>,
  dataSource: string,
  range: string,
) {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         TRADE CHARACTERISTICS ANALYSIS REPORT                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Data source: ${dataSource}`);
  console.log(`Range: ${range}`);
  console.log(`Trades: ${report.totalTrades} | Wins: ${report.wins} | Losses: ${report.losses} | Win rate: ${report.winRate.toFixed(1)}%\n`);

  console.log('── Overall: Winners vs Losers (averages) ──\n');
  console.log(
    pad('Metric', 42) +
      pad('Winners', 12) +
      pad('Losers', 12) +
      pad('Delta', 10) +
      pad('Sep.', 8) +
      'Strength',
  );
  console.log('-'.repeat(95));

  for (const c of report.overallComparisons) {
    console.log(
      pad(c.metric, 42) +
        pad(c.winnersAvg.toFixed(2), 12) +
        pad(c.losersAvg.toFixed(2), 12) +
        pad(c.delta.toFixed(2), 10) +
        pad(c.separationScore.toFixed(2), 8) +
        c.recommendationStrength,
    );
  }

  for (const [strategyId, data] of Object.entries(report.byStrategy)) {
    console.log(`\n── ${strategyId} (${data.wins}W / ${data.losses}L) ──\n`);
    for (const c of data.comparisons) {
      if (c.recommendationStrength === 'none' && Math.abs(c.delta) < 0.01) {
        continue;
      }
      console.log(
        `  ${c.metric}: winners ${c.winnersAvg.toFixed(2)} vs losers ${c.losersAvg.toFixed(2)} (Δ ${c.delta.toFixed(2)}, ${c.recommendationStrength})`,
      );
      if (c.suggestedThreshold !== null) {
        console.log(`    → threshold: ${c.filterDirection} ${c.suggestedThreshold.toFixed(2)} — ${c.note}`);
      }
    }
  }

  console.log('\n── Evidence-Based Filter Recommendations ──\n');
  for (const rec of report.filterRecommendations) {
    console.log(`  • ${rec}`);
  }

  console.log('\n── Individual Trades ──\n');
  for (const r of report.records) {
    console.log(
      `  ${extractTradeDate(r.entryTime)} ${r.entryTimeHhMm} | ${r.strategyName} ${r.direction} | ${r.outcome} ${r.points > 0 ? '+' : ''}${r.points.toFixed(2)} pts | hold ${r.holdingMinutes}m | entry body ${r.entryCandle.bodyPct.toFixed(0)}%${r.breakoutCandle ? ` | breakout body ${r.breakoutCandle.bodyPct.toFixed(0)}%` : ''}${r.breakoutDistancePts !== undefined ? ` | dist ${r.breakoutDistancePts.toFixed(1)}pts` : ''}${r.hadRetestBeforeEntry !== undefined ? ` | retest ${r.hadRetestBeforeEntry ? 'Y' : 'N'}` : ''}`,
    );
  }
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

async function main() {
  let store: CandleStore;
  let from = FROM;
  let to = TO;
  let dataSource: string;

  if (useSynthetic || !process.env.KITE_AUTH) {
    const synth = generateSyntheticStore(SYNTH_DAYS);
    store = synth.store;
    from = synth.from;
    to = synth.to;
    dataSource = `Synthetic OHLC (${SYNTH_DAYS} calendar days, seeded patterns)`;
    if (!useSynthetic) {
      console.log('KITE_AUTH not set — using synthetic data. Pass KITE_AUTH for live NIFTY analysis.\n');
    }
  } else {
    dataSource = `Kite NIFTY (${INSTRUMENT_TOKEN})`;
    const fetchFrom = subtractDays(FROM, LOOKBACK_DAYS);
    store = {} as CandleStore;
    for (const tf of ['5minute', '60minute', '30minute', '15minute'] as Timeframe[]) {
      process.stdout.write(`Fetching ${tf}… `);
      store[tf] = await fetchCandles(tf, tf === '5minute' ? FROM : fetchFrom, TO);
      console.log(`${store[tf].length} bars`);
      if (tf !== '15minute') {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  const { characteristicRecords, closedTrades, replayCandles } = runBacktestWithCharacteristics(
    store,
    from,
    to,
  );

  const report = buildTradeCharacteristicsReport(characteristicRecords);
  printReport(report, dataSource, `${from} → ${to}`);
  console.log(`\nReplay candles processed: ${replayCandles}`);

  const outPath = join(root, 'reports', 'trade-characteristics-analysis.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dataSource,
        range: { from, to },
        summary: {
          totalTrades: report.totalTrades,
          wins: report.wins,
          losses: report.losses,
          winRate: report.winRate,
        },
        overallComparisons: report.overallComparisons,
        byStrategy: report.byStrategy,
        filterRecommendations: report.filterRecommendations,
        trades: report.records,
        closedTrades,
      },
      null,
      2,
    ),
  );
  console.log(`\nFull JSON report: ${outPath}`);
}

main().catch((err) => {
  console.error('Analysis failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * Live Kite backtest — fetches real OHLC and runs First Hour Breakout + Intraday Reversal.
 * Usage: KITE_AUTH='token api_key:access_token' npx tsx scripts/kite-live-backtest.ts
 */
import {
  createFirstHourBreakoutState,
  markFirstHourTradeTaken,
  runFirstHourBreakout,
} from '../src/app/core/strategy-engine/strategies/first-hour-breakout/first-hour-breakout.evaluator.ts';
import {
  createIntradayReversalState,
  runIntradayReversal,
} from '../src/app/core/strategy-engine/strategies/intraday-reversal/intraday-reversal.evaluator.ts';
import { extractTradeDate } from '../src/app/core/utils/trade-date.util.ts';
import { extractHhMm } from '../src/app/core/strategy-engine/utils/market-session.util.ts';

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Timeframe = '5minute' | '60minute' | '30minute' | '15minute';

const INSTRUMENT_TOKEN = '256265';
const LOOKBACK_DAYS = 45;
const FROM = process.env.FROM ?? '2026-06-24 09:15:00';
const TO = process.env.TO ?? '2026-07-03 15:30:00';

const auth = process.env.KITE_AUTH;
if (!auth) {
  console.error('Set KITE_AUTH=token api_key:access_token');
  process.exit(1);
}

function subtractDays(dateTime: string, days: number): string {
  const d = new Date(dateTime.replace(' ', 'T'));
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function fetchCandles(interval: Timeframe, from: string, to: string): Promise<Candle[]> {
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
    throw new Error(body.message ?? `Kite API failed for ${interval} (${res.status})`);
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

function parseTs(dateTime: string): number {
  return new Date(dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')).getTime();
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
  replayStepIndex: number,
  replayFrom: string,
  replayTo: string,
) {
  const candles5m = store['5minute'];
  const current5m = candles5m[index5m]!;
  const timestamp = current5m.date;
  const index5mActual = index5m;
  return {
    candle60m: activeCandle(store['60minute'], timestamp),
    candle30m: activeCandle(store['30minute'], timestamp),
    candle15m: activeCandle(store['15minute'], timestamp),
    candle5m: current5m,
    previous60m: previousCandles(store['60minute'], timestamp),
    previous30m: previousCandles(store['30minute'], timestamp),
    previous15m: previousCandles(store['15minute'], timestamp),
    previous5m: candles5m.slice(0, index5mActual),
    candleIndex5m: index5mActual,
    replayStepIndex,
    replayFrom,
    replayTo,
  };
}

interface OpenTrade {
  direction: 'BUY' | 'SELL';
  entryTime: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
}

interface ClosedTrade extends OpenTrade {
  exitTime: string;
  exitPrice: number;
  points: number;
  outcome: 'WIN' | 'LOSS';
  exitReason: string;
}

function checkExit(candle: Candle, trade: OpenTrade): { shouldExit: boolean; exitPrice: number; exitReason: string; outcome: 'WIN' | 'LOSS' } {
  if (trade.direction === 'BUY') {
    if (candle.low <= trade.stopLoss) {
      return { shouldExit: true, exitPrice: trade.stopLoss, exitReason: 'Stop loss hit', outcome: 'LOSS' };
    }
  } else if (candle.high >= trade.stopLoss) {
    return { shouldExit: true, exitPrice: trade.stopLoss, exitReason: 'Stop loss hit', outcome: 'LOSS' };
  }
  if (extractHhMm(candle.date) === '15:15') {
    const points = trade.direction === 'BUY' ? candle.close - trade.entryPrice : trade.entryPrice - candle.close;
    return {
      shouldExit: true,
      exitPrice: candle.close,
      exitReason: 'Market close (15:15 candle)',
      outcome: points > 0 ? 'WIN' : 'LOSS',
    };
  }
  return { shouldExit: false, exitPrice: candle.close, exitReason: '', outcome: 'LOSS' };
}

function runStrategyBacktest(
  name: string,
  evaluate: (ctx: ReturnType<typeof buildContext>) => {
    action: 'BUY' | 'SELL' | 'NO_TRADE';
    entryPrice: number;
    stopLoss: number;
    target: number;
    onSignal?: () => void;
  },
  store: Record<Timeframe, Candle[]>,
  replayIndices: number[],
  replayFrom: string,
  replayTo: string,
): ClosedTrade[] {
  const trades: ClosedTrade[] = [];
  let open: OpenTrade | null = null;

  for (let step = 0; step < replayIndices.length; step++) {
    const idx = replayIndices[step]!;
    const ctx = buildContext(store, idx, step, replayFrom, replayTo);
    const candle = ctx.candle5m;

    if (open) {
      const exit = checkExit(candle, open);
      if (exit.shouldExit) {
        const points =
          open.direction === 'BUY' ? exit.exitPrice - open.entryPrice : open.entryPrice - exit.exitPrice;
        trades.push({
          ...open,
          exitTime: candle.date,
          exitPrice: exit.exitPrice,
          points,
          outcome: exit.outcome,
          exitReason: exit.exitReason,
        });
        open = null;
      }
    }

    if (!open) {
      const signal = evaluate(ctx);
      if (signal.action === 'BUY' || signal.action === 'SELL') {
        signal.onSignal?.();
        open = {
          direction: signal.action,
          entryTime: candle.date,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          targetPrice: signal.target,
        };
      }
    }
  }

  if (open) {
    const lastIdx = replayIndices[replayIndices.length - 1]!;
    const lastCandle = store['5minute'][lastIdx]!;
    const points =
      open.direction === 'BUY' ? lastCandle.close - open.entryPrice : open.entryPrice - lastCandle.close;
    trades.push({
      ...open,
      exitTime: lastCandle.date,
      exitPrice: lastCandle.close,
      points,
      outcome: points > 0 ? 'WIN' : 'LOSS',
      exitReason: 'End of backtest range',
    });
  }

  return trades;
}

function summarize(name: string, trades: ClosedTrade[]) {
  const wins = trades.filter((t) => t.outcome === 'WIN');
  const net = trades.reduce((s, t) => s + t.points, 0);
  console.log(`\n=== ${name} ===`);
  console.log(`Trades: ${trades.length} | Wins: ${wins.length} | Losses: ${trades.length - wins.length}`);
  console.log(`Net points: ${net > 0 ? '+' : ''}${net.toFixed(2)}`);
  trades.forEach((t, i) => {
    console.log(
      `  ${i + 1}. ${extractTradeDate(t.entryTime)} ${t.direction} entry ${extractHhMm(t.entryTime)} @ ${t.entryPrice.toFixed(2)} → exit ${extractHhMm(t.exitTime)} @ ${t.exitPrice.toFixed(2)} | ${t.points > 0 ? '+' : ''}${t.points.toFixed(2)} pts (${t.exitReason})`,
    );
  });
}

async function main() {
  const fetchFrom = subtractDays(FROM, LOOKBACK_DAYS);
  console.log(`Fetching NIFTY (${INSTRUMENT_TOKEN}) candles`);
  console.log(`Backtest range: ${FROM} → ${TO}`);
  console.log(`Lookback from: ${fetchFrom}\n`);

  const store = {} as Record<Timeframe, Candle[]>;
  for (const tf of ['5minute', '60minute', '30minute', '15minute'] as Timeframe[]) {
    const from = tf === '5minute' ? FROM : fetchFrom;
    process.stdout.write(`  ${tf}… `);
    store[tf] = await fetchCandles(tf, from, TO);
    console.log(`${store[tf].length} bars`);
    if (tf !== '15minute') await new Promise((r) => setTimeout(r, 500));
  }

  const replayIndices = buildReplayIndices(store['5minute'], FROM, TO);
  console.log(`\nReplay candles: ${replayIndices.length}`);

  const fhState = createFirstHourBreakoutState();
  const fhTrades = runStrategyBacktest(
    'First Hour Breakout',
    (ctx) => {
      const result = runFirstHourBreakout(ctx, fhState);
      const tradeable = result.action === 'BUY' || result.action === 'SELL';
      if (tradeable) {
        markFirstHourTradeTaken(fhState, extractTradeDate(ctx.candle5m.date));
      }
      return {
        action: result.action,
        entryPrice: result.entryPrice,
        stopLoss: result.stopLoss,
        target: result.target,
      };
    },
    store,
    replayIndices,
    FROM,
    TO,
  );

  const revState = createIntradayReversalState();
  const revTrades = runStrategyBacktest(
    'Intraday Reversal',
    (ctx) => {
      const result = runIntradayReversal(ctx, revState);
      return {
        action: result.action,
        entryPrice: result.entryPrice,
        stopLoss: result.stopLoss,
        target: result.target,
      };
    },
    store,
    replayIndices,
    FROM,
    TO,
  );

  summarize('First Hour Breakout', fhTrades);
  summarize('Intraday Reversal', revTrades);

  console.log('\n--- Comparison ---');
  console.log(`First Hour Breakout: ${fhTrades.length} trades`);
  console.log(`Intraday Reversal:   ${revTrades.length} trades`);
}

main().catch((err) => {
  console.error('Backtest failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

import { Candle } from '../../../models/candle.model';
import { StrategyContext } from '../../models/strategy-context.model';
import { InstrumentSessionConfig, NSE_SESSION } from '../../../config/session.config';
import { extractTradeDate } from '../../../utils/trade-date.util';
import {
  createPdhlOrState,
  runPdhlOpeningRange,
  PdhlOrResult,
} from './pdhl-opening-range.evaluator';

export type ManualTradeStatus = 'TRADE' | 'NO_TRADE' | 'WAITING' | 'INCOMPLETE';

export interface ManualTradePlan {
  status: ManualTradeStatus;
  action: 'BUY' | 'SELL' | null;
  entryPrice: number | null;
  stopLoss: number | null;
  target: number | null;
  riskPts: number | null;
  riskRewardRatio: number | null;
  signalTime: string | null;
  tradingDate: string;
  reason: string;
  bias: string | null;
  orHigh: number | null;
  orLow: number | null;
  pdh: number | null;
  pdl: number | null;
  atr: number | null;
  candlesScanned: number;
}

function stubCandle(from: Candle): Candle {
  return { ...from };
}

function buildContext(
  candles: Candle[],
  index: number,
  session: InstrumentSessionConfig,
  instrumentId: string,
): StrategyContext {
  const candle5m = candles[index]!;
  const previous5m = candles.slice(0, index);
  return {
    candle60m: stubCandle(candle5m),
    candle30m: stubCandle(candle5m),
    candle15m: stubCandle(candle5m),
    candle5m,
    previous60m: [],
    previous30m: [],
    previous15m: [],
    previous5m,
    candleIndex5m: index,
    replayStepIndex: index,
    replayFrom: candles[0]?.date ?? candle5m.date,
    replayTo: candles.at(-1)?.date ?? candle5m.date,
    session,
    instrumentId,
    series5m: candles,
  };
}

/**
 * Walks 5m candles for one trading day and returns the first OR swing-breakout plan.
 */
export function calculatePdhlManualPlan(params: {
  candles5m: Candle[];
  tradingDate: string;
  instrumentId: string;
  session?: InstrumentSessionConfig;
}): ManualTradePlan {
  const session = params.session ?? NSE_SESSION;
  const { tradingDate, instrumentId, candles5m } = params;
  const state = createPdhlOrState();

  const dayBars = candles5m.filter((c) => extractTradeDate(c.date) === tradingDate);
  if (!dayBars.length) {
    return emptyPlan(tradingDate, 'INCOMPLETE', 'No 5m candles for this date');
  }

  let lastResult: PdhlOrResult | null = null;

  for (let i = 0; i < candles5m.length; i += 1) {
    const c = candles5m[i]!;
    if (extractTradeDate(c.date) !== tradingDate) {
      continue;
    }

    const ctx = buildContext(candles5m, i, session, instrumentId);
    const result = runPdhlOpeningRange(ctx, state);
    lastResult = result;

    if (result.action === 'BUY' || result.action === 'SELL') {
      const risk = Math.abs(result.entryPrice - result.stopLoss);
      return {
        status: 'TRADE',
        action: result.action,
        entryPrice: result.entryPrice,
        stopLoss: result.stopLoss,
        target: result.target,
        riskPts: risk,
        riskRewardRatio: result.riskRewardRatio,
        signalTime: c.date,
        tradingDate,
        reason: result.reason,
        bias: String(result.analysis['bias'] ?? null),
        orHigh: numOrNull(result.analysis['orHigh']),
        orLow: numOrNull(result.analysis['orLow']),
        pdh: numOrNull(result.analysis['swingHigh']),
        pdl: numOrNull(result.analysis['swingLow']),
        atr: numOrNull(result.analysis['atr']),
        candlesScanned: dayBars.length,
      };
    }
  }

  const analysis = lastResult?.analysis ?? {};
  const stillWaiting =
    lastResult?.action === 'WAITING' ||
    (lastResult?.action !== 'NO_TRADE' && lastResult?.action !== 'BUY' && lastResult?.action !== 'SELL');

  return {
    status: stillWaiting && dayStillOpen(dayBars, session) ? 'WAITING' : 'NO_TRADE',
    action: null,
    entryPrice: null,
    stopLoss: null,
    target: null,
    riskPts: null,
    riskRewardRatio: null,
    signalTime: null,
    tradingDate,
    reason: lastResult?.reason ?? 'No OR swing breakout signal for the day',
    bias: analysis['bias'] != null ? String(analysis['bias']) : null,
    orHigh: numOrNull(analysis['orHigh']),
    orLow: numOrNull(analysis['orLow']),
    pdh: numOrNull(analysis['swingHigh']),
    pdl: numOrNull(analysis['swingLow']),
    atr: numOrNull(analysis['atr']),
    candlesScanned: dayBars.length,
  };
}

function dayStillOpen(dayBars: Candle[], session: InstrumentSessionConfig): boolean {
  const last = dayBars.at(-1);
  if (!last) {
    return true;
  }
  const time = last.date.slice(11, 16);
  return time < session.sessionCloseCandle;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function emptyPlan(
  tradingDate: string,
  status: ManualTradeStatus,
  reason: string,
): ManualTradePlan {
  return {
    status,
    action: null,
    entryPrice: null,
    stopLoss: null,
    target: null,
    riskPts: null,
    riskRewardRatio: null,
    signalTime: null,
    tradingDate,
    reason,
    bias: null,
    orHigh: null,
    orLow: null,
    pdh: null,
    pdl: null,
    atr: null,
    candlesScanned: 0,
  };
}

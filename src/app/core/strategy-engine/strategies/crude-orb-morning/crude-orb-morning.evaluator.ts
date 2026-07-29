/**
 * CRUDEOILM morning ORB (all-day-green hunt Mar–Jul 2026):
 * Opening range 09:00–10:00 · entries 10:00–12:00 · SL 80 · TP 250 · ≤1/day
 * Skip if OR width > 120 pts. Pair with evening PDHL 18:30–20:30.
 * Hold until TP / SL / 23:10 — entry window end is not a force-flat.
 */
import { Candle } from '../../../models/candle.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { extractHhMm } from '../../utils/market-session.util';
import {
  CRUDE_DAY_LOSS_STOP_PTS,
  CRUDE_MAX_TRADES_MONTH,
  CRUDE_MORNING_TARGET_PTS,
  CRUDE_STOP_PTS,
  CrudePdhlSignal,
  CrudePdhlState,
} from '../crude-pdhl-evening/crude-pdhl-evening.evaluator';

export const CRUDE_MORNING_ENTRY_START = '10:00';
export const CRUDE_MORNING_ENTRY_END = '12:00';
export const CRUDE_MORNING_OR_START = '09:00';
export const CRUDE_MORNING_OR_END = '10:00';
export const CRUDE_MORNING_MAX_TRADES_DAY = 1;
/** Skip wide opening ranges (noisy days). */
export const CRUDE_MORNING_MAX_OR_WIDTH = 120;

function orbRange(
  candles: Candle[],
  tradingDate: string,
  orStart: string,
  orEnd: string,
): { high: number; low: number } | null {
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (extractTradeDate(c.date) !== tradingDate) {
      continue;
    }
    const t = extractHhMm(c.date);
    if (t < orStart || t > orEnd) {
      continue;
    }
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return null;
  }
  return { high, low };
}

function wait(candle: Candle, reason: string): CrudePdhlSignal {
  return {
    action: 'WAITING',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    reason,
  };
}

export function runCrudeMorningOrb(params: {
  candle: Candle;
  series: Candle[];
  state: CrudePdhlState;
  dayLossStopPts?: number;
  /** Day profit lock (pts). 0 = off. */
  dayProfitLockPts?: number;
  /** Override stop distance (pts). Default champion 80. */
  stopPts?: number;
  /** Override morning target (pts). Default champion 250. */
  targetPts?: number;
}): CrudePdhlSignal {
  const { candle, series, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
  const dayProfitLockPts = params.dayProfitLockPts ?? 0;
  const stopPts = params.stopPts ?? CRUDE_STOP_PTS;
  const targetPts = params.targetPts ?? CRUDE_MORNING_TARGET_PTS;
  const tradingDate = extractTradeDate(candle.date);
  const month = tradingDate.slice(0, 7);
  const time = extractHhMm(candle.date);

  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.morningTradesToday = 0;
    state.eveningTradesToday = 0;
    state.dayStoppedReason = null;
    state.pendingConfirm = null;
    state.wonToday = false;
  }
  if (state.tradingMonth !== month) {
    state.tradingMonth = month;
    state.tradesThisMonth = 0;
  }

  if (state.dayStoppedReason) {
    return wait(candle, state.dayStoppedReason);
  }
  if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
    return wait(candle, state.dayStoppedReason);
  }
  if (state.dayNetPts <= -dayLossStopPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return wait(candle, state.dayStoppedReason);
  }
  if (state.morningTradesToday >= CRUDE_MORNING_MAX_TRADES_DAY) {
    return wait(candle, `Max ${CRUDE_MORNING_MAX_TRADES_DAY} morning trade/day`);
  }
  if (state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {
    return wait(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }
  if (time < CRUDE_MORNING_ENTRY_START || time > CRUDE_MORNING_ENTRY_END) {
    return wait(
      candle,
      `Outside morning window (${CRUDE_MORNING_ENTRY_START}–${CRUDE_MORNING_ENTRY_END})`,
    );
  }

  const orb = orbRange(series, tradingDate, CRUDE_MORNING_OR_START, CRUDE_MORNING_OR_END);
  if (!orb) {
    return wait(candle, 'Opening range not ready');
  }
  const orWidth = orb.high - orb.low;
  if (orWidth > CRUDE_MORNING_MAX_OR_WIDTH) {
    return wait(
      candle,
      `OR too wide (${orWidth.toFixed(0)} > ${CRUDE_MORNING_MAX_OR_WIDTH})`,
    );
  }

  let action: 'BUY' | 'SELL' | null = null;
  if (candle.close > orb.high && candle.close > candle.open) {
    action = 'BUY';
  } else if (candle.close < orb.low && candle.close < candle.open) {
    action = 'SELL';
  }
  if (!action) {
    return wait(candle, `Waiting ORB break (${orb.low.toFixed(1)}–${orb.high.toFixed(1)})`);
  }

  const entry = candle.close;
  const stopLoss = action === 'BUY' ? entry - stopPts : entry + stopPts;
  const target = action === 'BUY' ? entry + targetPts : entry - targetPts;

  if (state.dayNetPts - stopPts < -dayLossStopPts) {
    return {
      action: 'NO_TRADE',
      entryPrice: entry,
      stopLoss: entry,
      target: entry,
      reason: 'Next SL would breach day max loss',
    };
  }

  return {
    action,
    entryPrice: entry,
    stopLoss,
    target,
    reason: `${action} morning ORB · SL ${stopPts} / TP ${targetPts} · day ${state.dayNetPts.toFixed(1)}`,
  };
}

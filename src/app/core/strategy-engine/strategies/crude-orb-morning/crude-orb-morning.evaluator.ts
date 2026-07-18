/**
 * CRUDEOILM all-months-green ORB (Mar–Jul 2026 hunt):
 * Opening range 09:00–10:00 · entries 10:30–12:00 · SL 80 · TP 200 · ≤1/day
 * Sample: +₹14,220 · every month green · worst month +₹2,030 (1 lot × ₹10).
 * Hold until TP / SL / 23:10 — entry window end is not a force-flat.
 */
import { Candle } from '../../../models/candle.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { extractHhMm } from '../../utils/market-session.util';
import {
  CRUDE_DAY_LOSS_STOP_PTS,
  CRUDE_MAX_TRADES_MONTH,
  CRUDE_STOP_PTS,
  CRUDE_TARGET_PTS,
  CrudePdhlSignal,
  CrudePdhlState,
} from '../crude-pdhl-evening/crude-pdhl-evening.evaluator';

export const CRUDE_MORNING_ENTRY_START = '10:30';
export const CRUDE_MORNING_ENTRY_END = '12:00';
export const CRUDE_MORNING_OR_START = '09:00';
export const CRUDE_MORNING_OR_END = '10:00';
export const CRUDE_MORNING_MAX_TRADES_DAY = 1;

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
}): CrudePdhlSignal {
  const { candle, series, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
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
  }
  if (state.tradingMonth !== month) {
    state.tradingMonth = month;
    state.tradesThisMonth = 0;
  }

  if (state.dayStoppedReason) {
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
  const stopLoss = action === 'BUY' ? entry - CRUDE_STOP_PTS : entry + CRUDE_STOP_PTS;
  const target = action === 'BUY' ? entry + CRUDE_TARGET_PTS : entry - CRUDE_TARGET_PTS;

  if (state.dayNetPts - CRUDE_STOP_PTS < -dayLossStopPts) {
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
    reason: `${action} morning ORB · SL ${CRUDE_STOP_PTS} / TP ${CRUDE_TARGET_PTS} · day ${state.dayNetPts.toFixed(1)}`,
  };
}

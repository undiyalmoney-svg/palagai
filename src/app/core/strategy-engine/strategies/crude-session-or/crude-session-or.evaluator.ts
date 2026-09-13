/**
 * Crude All-Green Session OR (full MCX session):
 * OR 09:00–09:30 · entries after OR through 23:00 · next-bar confirm
 * Per-trade SL/trail from profile · unlimited · no day lock · no OR-width skip
 * Start anytime after OR is built — not gated to 15:15.
 */
import { Candle } from '../../../models/candle.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { extractHhMm } from '../../utils/market-session.util';
import {
  CRUDE_DAY_LOSS_STOP_PTS,
  CRUDE_MAX_TRADES_MONTH,
  crudeDayLossActive,
  crudeTradeCapActive,
  CrudePdhlSignal,
  CrudePdhlState,
} from '../crude-pdhl-evening/crude-pdhl-evening.evaluator';

/** Full MCX crude desk window (entries after OR completes). */
export const CRUDE_SOR_ENTRY_START = '09:00';
export const CRUDE_SOR_ENTRY_END = '23:00';
export const CRUDE_SOR_OR_START = '09:00';
export const CRUDE_SOR_OR_END = '09:30';
/** 0 = off — trade even when opening range is very wide. */
export const CRUDE_SOR_MAX_OR_WIDTH = 0;
/** 0 = unlimited. */
export const CRUDE_SOR_MAX_TRADES_DAY = 0;

function sessionOr(
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

function priorDayHighLow(
  candles: Candle[],
  tradingDate: string,
): { high: number; low: number } | null {
  const days: string[] = [];
  for (const c of candles) {
    const d = extractTradeDate(c.date);
    if (d >= tradingDate) {
      break;
    }
    if (days[days.length - 1] !== d) {
      days.push(d);
    }
  }
  const prev = days[days.length - 1];
  if (!prev) {
    return null;
  }
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (extractTradeDate(c.date) !== prev) {
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

function isFadePriorDay(
  action: 'BUY' | 'SELL',
  price: number,
  pd: { high: number; low: number } | null,
  bufferPts: number,
): boolean {
  if (!pd || !Number.isFinite(price)) {
    return false;
  }
  const buf = Math.max(0, Number(bufferPts) || 0);
  if (action === 'SELL' && price > pd.high - buf) {
    return true;
  }
  if (action === 'BUY' && price < pd.low + buf) {
    return true;
  }
  return false;
}

function fadeSkipReason(action: 'BUY' | 'SELL'): string {
  return action === 'SELL'
    ? 'Skip fade — SELL into/above prior-day high'
    : 'Skip fade — BUY into/below prior-day low';
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

export function runCrudeSessionOr(params: {
  candle: Candle;
  series: Candle[];
  state: CrudePdhlState;
  dayLossStopPts?: number;
  dayProfitLockPts?: number;
  stopPts?: number;
  targetPts?: number;
  requireConfirm?: boolean;
  firstWinLock?: boolean;
  entryStart?: string;
  entryEnd?: string;
  orStart?: string;
  orEnd?: string;
  maxOrWidth?: number;
  minOrWidth?: number;
  maxTradesDay?: number;
  allowBuy?: boolean;
  allowSell?: boolean;
  skipFadePriorDay?: boolean;
  fadeBufferPts?: number;
}): CrudePdhlSignal {
  const { candle, series, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
  const dayProfitLockPts = params.dayProfitLockPts ?? 0;
  const stopPts = params.stopPts ?? 15;
  const targetPts = params.targetPts ?? 100;
  const requireConfirm = params.requireConfirm !== false;
  const firstWinLock = params.firstWinLock === true;
  const entryStart = params.entryStart ?? CRUDE_SOR_ENTRY_START;
  const entryEnd = params.entryEnd ?? CRUDE_SOR_ENTRY_END;
  const orStart = params.orStart ?? CRUDE_SOR_OR_START;
  const orEnd = params.orEnd ?? CRUDE_SOR_OR_END;
  const maxOrWidth = params.maxOrWidth ?? CRUDE_SOR_MAX_OR_WIDTH;
  const minOrWidth = params.minOrWidth ?? 0;
  const maxTradesDay = params.maxTradesDay ?? CRUDE_SOR_MAX_TRADES_DAY;
  const allowBuy = params.allowBuy !== false;
  const allowSell = params.allowSell !== false;
  const skipFadePriorDay = params.skipFadePriorDay === true;
  const fadeBufferPts = params.fadeBufferPts ?? 0;

  const tradingDate = extractTradeDate(candle.date);
  const priorDay = skipFadePriorDay ? priorDayHighLow(series, tradingDate) : null;
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
  if (firstWinLock && state.wonToday) {
    state.dayStoppedReason = 'First win lock — day done';
    return wait(candle, state.dayStoppedReason);
  }
  if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
    return wait(candle, state.dayStoppedReason);
  }
  if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts <= -dayLossStopPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return wait(candle, state.dayStoppedReason);
  }
  if (crudeTradeCapActive(maxTradesDay) && state.tradesToday >= maxTradesDay) {
    return wait(candle, `Max ${maxTradesDay} afternoon trades/day`);
  }
  if (
    crudeTradeCapActive(CRUDE_MAX_TRADES_MONTH) &&
    state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH
  ) {
    return wait(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }

  // Next-bar confirm → fill at this open
  if (state.pendingConfirm) {
    const p = state.pendingConfirm;
    state.pendingConfirm = null;
    if (time < entryStart || time > entryEnd) {
      return wait(candle, 'Confirm outside entry window');
    }
    const bullOk = p.dir === 1 && allowBuy && candle.close > candle.open && candle.close > p.signalClose;
    const bearOk = p.dir === -1 && allowSell && candle.close < candle.open && candle.close < p.signalClose;
    if (!bullOk && !bearOk) {
      return wait(candle, 'Session OR confirm failed');
    }
    const action: 'BUY' | 'SELL' = p.dir === 1 ? 'BUY' : 'SELL';
    const entry = candle.open;
    if (skipFadePriorDay && isFadePriorDay(action, entry, priorDay, fadeBufferPts)) {
      return wait(candle, fadeSkipReason(action));
    }
    const stopLoss = action === 'BUY' ? entry - stopPts : entry + stopPts;
    const target = action === 'BUY' ? entry + targetPts : entry - targetPts;
    if (
      crudeDayLossActive(dayLossStopPts) &&
      state.dayNetPts - stopPts < -dayLossStopPts
    ) {
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
      reason: `${action} Session OR confirm · SL ${stopPts} / TP ${targetPts}`,
    };
  }

  if (time < entryStart || time > entryEnd) {
    return wait(candle, `Outside entry window (${entryStart}–${entryEnd})`);
  }
  // Need OR complete (after orEnd)
  if (time <= orEnd) {
    return wait(candle, `Building session OR (${orStart}–${orEnd})`);
  }

  const orb = sessionOr(series, tradingDate, orStart, orEnd);
  if (!orb) {
    return wait(candle, 'Session OR not ready');
  }
  const width = orb.high - orb.low;
  if (minOrWidth > 0 && width < minOrWidth) {
    return wait(candle, `OR too narrow (${width.toFixed(1)}<${minOrWidth})`);
  }
  if (maxOrWidth > 0 && width > maxOrWidth) {
    return wait(candle, `OR too wide (${width.toFixed(1)}>${maxOrWidth})`);
  }

  let action: 'BUY' | 'SELL' | null = null;
  if (candle.close > orb.high && candle.close > candle.open) {
    action = 'BUY';
  } else if (candle.close < orb.low && candle.close < candle.open) {
    action = 'SELL';
  }
  if (!action) {
    return wait(candle, `Waiting OR break (${orb.low.toFixed(1)}–${orb.high.toFixed(1)})`);
  }
  if (action === 'BUY' && !allowBuy) {
    return wait(candle, 'Longs off — PE only');
  }
  if (action === 'SELL' && !allowSell) {
    return wait(candle, 'Shorts off — CE only');
  }
  if (skipFadePriorDay && isFadePriorDay(action, candle.close, priorDay, fadeBufferPts)) {
    return wait(candle, fadeSkipReason(action));
  }

  if (requireConfirm) {
    state.pendingConfirm = {
      dir: action === 'BUY' ? 1 : -1,
      signalClose: candle.close,
    };
    return wait(candle, `Session OR armed · waiting confirm (${action})`);
  }

  const entry = candle.close;
  const stopLoss = action === 'BUY' ? entry - stopPts : entry + stopPts;
  const target = action === 'BUY' ? entry + targetPts : entry - targetPts;
  return {
    action,
    entryPrice: entry,
    stopLoss,
    target,
    reason: `${action} Session OR · SL ${stopPts} / TP ${targetPts}`,
  };
}

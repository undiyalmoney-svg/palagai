/**
 * Crude afternoon Session OR (all-green aim hunt Mar–Jul 2026):
 * OR 15:15–15:45 · entries 15:15–23:00 · next-bar confirm · SL12 / TP24
 * first-win lock · day lock +20 · day stop −15 · ≤2/day · max OR width 120
 * MCX sample ≈ 90% green traded days · ~₹154/day · PF ~3.5 (1 lot × ₹10).
 * Not 100% green — flat days (no setup) and ~10% red traded days remain.
 */
import { Candle } from '../../../models/candle.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { extractHhMm } from '../../utils/market-session.util';
import {
  CRUDE_DAY_LOSS_STOP_PTS,
  CRUDE_MAX_TRADES_MONTH,
  CrudePdhlSignal,
  CrudePdhlState,
} from '../crude-pdhl-evening/crude-pdhl-evening.evaluator';

export const CRUDE_SOR_ENTRY_START = '15:15';
export const CRUDE_SOR_ENTRY_END = '23:00';
export const CRUDE_SOR_OR_START = '15:15';
export const CRUDE_SOR_OR_END = '15:45';
export const CRUDE_SOR_MAX_OR_WIDTH = 120;
export const CRUDE_SOR_MAX_TRADES_DAY = 2;

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
  maxTradesDay?: number;
}): CrudePdhlSignal {
  const { candle, series, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
  const dayProfitLockPts = params.dayProfitLockPts ?? 0;
  const stopPts = params.stopPts ?? 12;
  const targetPts = params.targetPts ?? 24;
  const requireConfirm = params.requireConfirm !== false;
  const firstWinLock = params.firstWinLock === true;
  const entryStart = params.entryStart ?? CRUDE_SOR_ENTRY_START;
  const entryEnd = params.entryEnd ?? CRUDE_SOR_ENTRY_END;
  const orStart = params.orStart ?? CRUDE_SOR_OR_START;
  const orEnd = params.orEnd ?? CRUDE_SOR_OR_END;
  const maxOrWidth = params.maxOrWidth ?? CRUDE_SOR_MAX_OR_WIDTH;
  const maxTradesDay = params.maxTradesDay ?? CRUDE_SOR_MAX_TRADES_DAY;

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
  if (firstWinLock && state.wonToday) {
    state.dayStoppedReason = 'First win lock — day done';
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
  if (state.tradesToday >= maxTradesDay) {
    return wait(candle, `Max ${maxTradesDay} afternoon trades/day`);
  }
  if (state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {
    return wait(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }

  // Next-bar confirm → fill at this open
  if (state.pendingConfirm) {
    const p = state.pendingConfirm;
    state.pendingConfirm = null;
    if (time < entryStart || time > entryEnd) {
      return wait(candle, 'Confirm outside entry window');
    }
    const bullOk = p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bearOk = p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!bullOk && !bearOk) {
      return wait(candle, 'Session OR confirm failed');
    }
    const action: 'BUY' | 'SELL' = p.dir === 1 ? 'BUY' : 'SELL';
    const entry = candle.open;
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
  if (width > maxOrWidth) {
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

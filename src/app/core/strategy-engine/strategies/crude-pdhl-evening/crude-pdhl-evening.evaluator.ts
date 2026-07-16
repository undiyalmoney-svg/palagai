/**
 * CRUDEOILM champion (hunt May–Jul 2026):
 * PDHL break · entries 19:00–21:00 · SL 80 · TP 200 · ≤2/day · ≤8/month
 * Exit: target / stop / 23:10 session.
 * Does not change Nifty / Bank Nifty DNA.
 */
import { Candle } from '../../../models/candle.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { extractHhMm } from '../../utils/market-session.util';

export const CRUDE_RUPEES_PER_POINT = 10;
export const CRUDE_STOP_PTS = 80;
export const CRUDE_TARGET_PTS = 200;
export const CRUDE_ENTRY_START = '19:00';
export const CRUDE_ENTRY_END = '21:00';
export const CRUDE_EXIT_BY = '23:10';
export const CRUDE_MAX_TRADES_DAY = 2;
export const CRUDE_MAX_TRADES_MONTH = 8;
export const CRUDE_DAY_LOSS_STOP_PTS = 240;

export interface CrudePdhlState {
  tradingDate: string | null;
  tradingMonth: string | null;
  dayNetPts: number;
  tradesToday: number;
  tradesThisMonth: number;
  dayStoppedReason: string | null;
}

export function createCrudePdhlState(): CrudePdhlState {
  return {
    tradingDate: null,
    tradingMonth: null,
    dayNetPts: 0,
    tradesToday: 0,
    tradesThisMonth: 0,
    dayStoppedReason: null,
  };
}

export function recordCrudeTradeClosed(state: CrudePdhlState, points: number): void {
  state.dayNetPts += points;
  state.tradesToday += 1;
  state.tradesThisMonth += 1;
  if (state.dayNetPts <= -CRUDE_DAY_LOSS_STOP_PTS) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
  }
}

function prevDayHl(
  candles: Candle[],
  beforeIndex: number,
  tradingDate: string,
): { pdh: number; pdl: number } | null {
  let prevDate: string | null = null;
  for (let i = beforeIndex - 1; i >= 0; i -= 1) {
    const d = extractTradeDate(candles[i]!.date);
    if (d < tradingDate) {
      prevDate = d;
      break;
    }
  }
  if (!prevDate) {
    return null;
  }
  let pdh = -Infinity;
  let pdl = Infinity;
  for (let i = 0; i < beforeIndex; i += 1) {
    const c = candles[i]!;
    if (extractTradeDate(c.date) !== prevDate) {
      continue;
    }
    pdh = Math.max(pdh, c.high);
    pdl = Math.min(pdl, c.low);
  }
  if (!Number.isFinite(pdh) || !Number.isFinite(pdl)) {
    return null;
  }
  return { pdh, pdl };
}

export type CrudeSignalAction = 'BUY' | 'SELL' | 'WAITING' | 'NO_TRADE';

export interface CrudePdhlSignal {
  action: CrudeSignalAction;
  entryPrice: number;
  stopLoss: number;
  target: number;
  reason: string;
}

export function runCrudePdhlEvening(params: {
  candle: Candle;
  series: Candle[];
  index: number;
  state: CrudePdhlState;
}): CrudePdhlSignal {
  const { candle, series, index, state } = params;
  const tradingDate = extractTradeDate(candle.date);
  const month = tradingDate.slice(0, 7);
  const time = extractHhMm(candle.date);

  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.dayStoppedReason = null;
  }
  if (state.tradingMonth !== month) {
    state.tradingMonth = month;
    state.tradesThisMonth = 0;
  }

  if (state.dayStoppedReason) {
    return wait(candle, state.dayStoppedReason);
  }
  if (state.dayNetPts <= -CRUDE_DAY_LOSS_STOP_PTS) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return wait(candle, state.dayStoppedReason);
  }
  if (state.tradesToday >= CRUDE_MAX_TRADES_DAY) {
    return wait(candle, `Max ${CRUDE_MAX_TRADES_DAY} trades/day`);
  }
  if (state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {
    return wait(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }
  if (time < CRUDE_ENTRY_START || time > CRUDE_ENTRY_END) {
    return wait(
      candle,
      `Outside entry window (${CRUDE_ENTRY_START}–${CRUDE_ENTRY_END})`,
    );
  }

  const levels = prevDayHl(series, index, tradingDate);
  if (!levels) {
    return wait(candle, 'Previous day H/L not ready');
  }

  let action: 'BUY' | 'SELL' | null = null;
  if (candle.close > levels.pdh && candle.close > candle.open) {
    action = 'BUY';
  } else if (candle.close < levels.pdl && candle.close < candle.open) {
    action = 'SELL';
  }
  if (!action) {
    return wait(candle, `Waiting PDHL break (${levels.pdl.toFixed(1)}–${levels.pdh.toFixed(1)})`);
  }

  const entry = candle.close;
  const stopLoss = action === 'BUY' ? entry - CRUDE_STOP_PTS : entry + CRUDE_STOP_PTS;
  const target = action === 'BUY' ? entry + CRUDE_TARGET_PTS : entry - CRUDE_TARGET_PTS;

  if (state.dayNetPts - CRUDE_STOP_PTS < -CRUDE_DAY_LOSS_STOP_PTS) {
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
    reason: `${action} PDHL · SL ${CRUDE_STOP_PTS} / TP ${CRUDE_TARGET_PTS} · day ${state.dayNetPts.toFixed(1)}`,
  };
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

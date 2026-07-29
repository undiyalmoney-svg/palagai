/**
 * CRUDEOILM champion (all-day-green hunt Mar–Jul 2026, ~100 strategies):
 * Evening PDHL · entries 18:30–20:30 · SL 80 · TP 150 · ≤1/day · ≤12/month
 * Pair with morning ORB 10:00–12:00 SL80/TP250 (max OR width 120).
 * Sample pair ≈ +₹27,480 · 5/5 months green · ~63% green days (1 lot × ₹10).
 * Exit: target / stop / 23:10. Does not change Nifty / Bank Nifty DNA.
 */
import { Candle } from '../../../models/candle.model';
import { extractTradeDate } from '../../../utils/trade-date.util';
import { extractHhMm } from '../../utils/market-session.util';

export const CRUDE_RUPEES_PER_POINT = 10;
export const CRUDE_STOP_PTS = 80;
/** @deprecated Prefer CRUDE_EVENING_TARGET_PTS / CRUDE_MORNING_TARGET_PTS */
export const CRUDE_TARGET_PTS = 150;
export const CRUDE_EVENING_TARGET_PTS = 150;
export const CRUDE_MORNING_TARGET_PTS = 250;
export const CRUDE_ENTRY_START = '18:30';
export const CRUDE_ENTRY_END = '20:30';
export const CRUDE_EXIT_BY = '23:10';
/** 0 = unlimited — trade every valid Crude opportunity. */
export const CRUDE_MAX_TRADES_DAY = 0;
/** 0 = unlimited. */
export const CRUDE_MAX_TRADES_MONTH = 0;
/**
 * Day max loss (pts). **0 = off** — policy: no day loss stops on Crude.
 * Per-trade SL still cuts each trade (small loss / larger TP).
 */
export const CRUDE_DAY_LOSS_STOP_PTS = 0;
/** Desk strict checkbox — also off (0). */
export const CRUDE_STRICT_DAY_LOSS_RS = 0;
export const CRUDE_STRICT_DAY_LOSS_PTS = 0;

export function resolveCrudeDayLossStopPts(strictDayStop?: boolean): number {
  return strictDayStop ? CRUDE_STRICT_DAY_LOSS_PTS : CRUDE_DAY_LOSS_STOP_PTS;
}

/** Day loss / pre-trade day-risk gate active only when pts &gt; 0. */
export function crudeDayLossActive(dayLossStopPts: number): boolean {
  return dayLossStopPts > 0;
}

/** Trade-count cap active only when max &gt; 0 (0 = unlimited). */
export function crudeTradeCapActive(maxTrades: number): boolean {
  return maxTrades > 0;
}

export type CrudeSessionBook = 'morning' | 'evening';

export interface CrudePendingConfirm {
  dir: 1 | -1;
  signalClose: number;
}

export interface CrudePdhlState {
  tradingDate: string | null;
  tradingMonth: string | null;
  dayNetPts: number;
  tradesToday: number;
  morningTradesToday: number;
  eveningTradesToday: number;
  tradesThisMonth: number;
  dayStoppedReason: string | null;
  /** Next-bar confirm for Daily Profit / Trap-style ORB·PDHL. */
  pendingConfirm: CrudePendingConfirm | null;
  /** First-win lock (All-Green afternoon profile). */
  wonToday: boolean;
}

export function createCrudePdhlState(): CrudePdhlState {
  return {
    tradingDate: null,
    tradingMonth: null,
    dayNetPts: 0,
    tradesToday: 0,
    morningTradesToday: 0,
    eveningTradesToday: 0,
    tradesThisMonth: 0,
    dayStoppedReason: null,
    pendingConfirm: null,
    wonToday: false,
  };
}

export function recordCrudeTradeClosed(
  state: CrudePdhlState,
  points: number,
  dayLossStopPts: number = CRUDE_DAY_LOSS_STOP_PTS,
  book: CrudeSessionBook = 'evening',
  dayProfitLockPts: number = 0,
  firstWinLock: boolean = false,
): void {
  state.dayNetPts += points;
  state.tradesToday += 1;
  state.tradesThisMonth += 1;
  if (book === 'morning') {
    state.morningTradesToday += 1;
  } else {
    state.eveningTradesToday += 1;
  }
  if (points > 0) {
    state.wonToday = true;
  }
  if (firstWinLock && state.wonToday) {
    state.dayStoppedReason = 'First win lock — day done';
  } else if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
  } else if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts <= -dayLossStopPts) {
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
  /** Override champion day loss stop (pts). Default −150. */
  dayLossStopPts?: number;
  /** Day profit lock (pts). 0 = off. */
  dayProfitLockPts?: number;
  /** Override stop distance (pts). Default champion 80. */
  stopPts?: number;
  /** Override evening target (pts). Default champion 150. */
  targetPts?: number;
  /** Next-bar confirm (Daily Profit / Trap-style). */
  requireConfirm?: boolean;
  /** Entry window start HH:MM (default 18:30). */
  entryStart?: string;
  /** Entry window end HH:MM (default 20:30; Daily Profit uses 21:00). */
  entryEnd?: string;
  /** Max evening fills/day (default 1; Daily Profit allows 2). */
  maxTradesDay?: number;
}): CrudePdhlSignal {
  const { candle, series, index, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
  const dayProfitLockPts = params.dayProfitLockPts ?? 0;
  const stopPts = params.stopPts ?? CRUDE_STOP_PTS;
  const targetPts = params.targetPts ?? CRUDE_EVENING_TARGET_PTS;
  const requireConfirm = params.requireConfirm === true;
  const entryStart = params.entryStart ?? CRUDE_ENTRY_START;
  const entryEnd = params.entryEnd ?? CRUDE_ENTRY_END;
  const maxTradesDay = params.maxTradesDay ?? CRUDE_MAX_TRADES_DAY;
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
  if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts <= -dayLossStopPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return wait(candle, state.dayStoppedReason);
  }
  if (crudeTradeCapActive(maxTradesDay) && state.eveningTradesToday >= maxTradesDay) {
    return wait(candle, `Max ${maxTradesDay} evening trades/day`);
  }
  if (crudeTradeCapActive(CRUDE_MAX_TRADES_MONTH) && state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {
    return wait(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }

  // Next-bar confirm → fill at this open when candle continues the break.
  if (state.pendingConfirm) {
    const p = state.pendingConfirm;
    state.pendingConfirm = null;
    if (time < entryStart || time > entryEnd) {
      return wait(candle, 'Confirm outside entry window');
    }
    const bullOk = p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bearOk = p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!bullOk && !bearOk) {
      return wait(candle, 'PDHL confirm failed');
    }
    const action: 'BUY' | 'SELL' = p.dir === 1 ? 'BUY' : 'SELL';
    const entry = candle.open;
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
      reason: `${action} PDHL confirm · SL ${stopPts} / TP ${targetPts} · day ${state.dayNetPts.toFixed(1)}`,
    };
  }

  if (time < entryStart || time > entryEnd) {
    return wait(candle, `Outside entry window (${entryStart}–${entryEnd})`);
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

  if (requireConfirm) {
    state.pendingConfirm = {
      dir: action === 'BUY' ? 1 : -1,
      signalClose: candle.close,
    };
    return wait(candle, `PDHL signal armed · waiting confirm (${action})`);
  }

  const entry = candle.close;
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
    reason: `${action} PDHL · SL ${stopPts} / TP ${targetPts} · day ${state.dayNetPts.toFixed(1)}`,
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

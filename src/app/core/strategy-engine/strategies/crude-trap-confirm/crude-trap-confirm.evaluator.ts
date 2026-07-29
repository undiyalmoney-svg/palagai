/**
 * Crude Oil Mini — S/R Trap + Confirm (Trap DNA port).
 * Same idea as Nifty Trap: wick beyond swing S/R → close back inside → next-bar confirm.
 * Used by profile `trap-confirm` with peak-trail / soft cutoff / day ₹ caps.
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

export const CRUDE_TRAP_ENTRY_START = '10:00';
export const CRUDE_TRAP_ENTRY_END = '22:00';
export const CRUDE_TRAP_MAX_TRADES_DAY = 3;
export const CRUDE_TRAP_SWING_LB = 5;
export const CRUDE_TRAP_PIERCE = 8;
export const CRUDE_TRAP_SL_PAD = 2;
export const CRUDE_TRAP_MIN_RISK = 15;
export const CRUDE_TRAP_MAX_RISK = 120;
export const CRUDE_TRAP_RR = 3.5;

export interface CrudeTrapState extends CrudePdhlState {
  pending: {
    dir: 1 | -1;
    stop: number;
    signalClose: number;
  } | null;
}

export function createCrudeTrapState(): CrudeTrapState {
  return {
    tradingDate: null,
    tradingMonth: null,
    dayNetPts: 0,
    tradesToday: 0,
    morningTradesToday: 0,
    eveningTradesToday: 0,
    tradesThisMonth: 0,
    dayStoppedReason: null,
    pending: null,
  };
}

function ema50(closes: number[]): number | null {
  if (closes.length < 50) {
    return null;
  }
  const k = 2 / 51;
  let ema = closes.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
  for (let i = 50; i < closes.length; i += 1) {
    ema = closes[i]! * k + ema * (1 - k);
  }
  return ema;
}

function swingHL(dayBars: Candle[], i: number, lb: number): { sh: number; sl: number } {
  const start = Math.max(0, i - lb);
  const window = dayBars.slice(start, i);
  if (!window.length) {
    return { sh: dayBars[i]!.high, sl: dayBars[i]!.low };
  }
  return {
    sh: Math.max(...window.map((b) => b.high)),
    sl: Math.min(...window.map((b) => b.low)),
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

export function runCrudeTrapConfirm(params: {
  candle: Candle;
  series: Candle[];
  state: CrudeTrapState;
  dayLossStopPts?: number;
  dayProfitLockPts?: number;
  targetRMultiple?: number;
  entryStart?: string;
  entryEnd?: string;
  maxTradesDay?: number;
}): CrudePdhlSignal {
  const { candle, series, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
  const dayProfitLockPts = params.dayProfitLockPts ?? 0;
  const rr = params.targetRMultiple ?? CRUDE_TRAP_RR;
  const entryStart = params.entryStart ?? CRUDE_TRAP_ENTRY_START;
  const entryEnd = params.entryEnd ?? CRUDE_TRAP_ENTRY_END;
  const maxDay = params.maxTradesDay ?? CRUDE_TRAP_MAX_TRADES_DAY;

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
    state.pending = null;
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
  if (state.tradesToday >= maxDay) {
    return wait(candle, `Max ${maxDay} trap trades/day`);
  }
  if (state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {
    return wait(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }

  const dayBars = series.filter((c) => extractTradeDate(c.date) === tradingDate);
  const i = dayBars.findIndex((b) => b.date === candle.date);
  if (i < 0) {
    return wait(candle, 'Bar not in day series');
  }

  // Next-bar confirm → enter at this open
  if (state.pending) {
    const p = state.pending;
    state.pending = null;
    if (time < entryStart || time > entryEnd) {
      return wait(candle, 'Confirm outside entry window');
    }
    const bullOk = p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bearOk = p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!(bullOk || bearOk)) {
      return wait(candle, 'Crude trap confirm failed');
    }
    const fill = candle.open;
    const stop = p.dir === 1 ? Math.min(p.stop, fill - 1) : Math.max(p.stop, fill + 1);
    const risk = Math.abs(fill - stop);
    if (risk < CRUDE_TRAP_MIN_RISK || risk > CRUDE_TRAP_MAX_RISK) {
      return wait(candle, `Risk ${risk.toFixed(1)} outside ${CRUDE_TRAP_MIN_RISK}–${CRUDE_TRAP_MAX_RISK}`);
    }
    if (state.dayNetPts - risk < -dayLossStopPts) {
      return {
        action: 'NO_TRADE',
        entryPrice: fill,
        stopLoss: fill,
        target: fill,
        reason: 'Next SL would breach day max loss',
      };
    }
    const target = p.dir === 1 ? fill + risk * rr : fill - risk * rr;
    return {
      action: p.dir === 1 ? 'BUY' : 'SELL',
      entryPrice: fill,
      stopLoss: stop,
      target,
      reason: `Crude trap confirm ${p.dir === 1 ? 'BUY' : 'SELL'} · ${rr}R · day ${state.dayNetPts.toFixed(1)}`,
    };
  }

  if (time < entryStart || time > entryEnd) {
    return wait(candle, `Outside trap window (${entryStart}–${entryEnd})`);
  }
  if (i < CRUDE_TRAP_SWING_LB) {
    return wait(candle, 'Warming crude swing lookback');
  }

  const closes = series.map((c) => c.close);
  const ema = ema50(closes);
  if (ema == null) {
    return wait(candle, 'EMA50 warming');
  }

  const { sh, sl } = swingHL(dayBars, i, CRUDE_TRAP_SWING_LB);
  const cc = candle.close;
  const oo = candle.open;
  const hh = candle.high;
  const ll = candle.low;
  const pierce = CRUDE_TRAP_PIERCE;
  const pad = CRUDE_TRAP_SL_PAD;
  const rng = Math.max(hh - ll, 1e-9);

  const trapBuy = ll < sl - pierce && cc > sl && cc > oo;
  const trapSell = hh > sh + pierce && cc < sh && cc < oo;
  const bounceBuy =
    ll <= sl + pierce &&
    ll >= sl - pierce * 2 &&
    cc > oo &&
    cc >= sl &&
    (hh - cc) / rng < 0.35;
  const bounceSell =
    hh >= sh - pierce &&
    hh <= sh + pierce * 2 &&
    cc < oo &&
    cc <= sh &&
    (cc - ll) / rng < 0.35;

  let dir: 1 | -1 | 0 = 0;
  let stop = 0;
  if ((trapBuy || bounceBuy) && cc > ema) {
    dir = 1;
    stop = ll - pad;
  } else if ((trapSell || bounceSell) && cc < ema) {
    dir = -1;
    stop = hh + pad;
  }
  if (!dir) {
    return wait(candle, 'No crude S/R trap / bounce');
  }

  const risk = Math.abs(cc - stop);
  if (risk < CRUDE_TRAP_MIN_RISK || risk > CRUDE_TRAP_MAX_RISK) {
    return wait(candle, `Arm risk ${risk.toFixed(1)} outside band`);
  }

  state.pending = { dir, stop, signalClose: cc };
  return wait(
    candle,
    dir === 1 ? 'Crude trap BUY armed — wait confirm' : 'Crude trap SELL armed — wait confirm',
  );
}

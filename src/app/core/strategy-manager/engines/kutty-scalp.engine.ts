/**
 * Kutty — background scalp (NOT in Strat dropdown).
 * DNA (Kite OOS 2024+ hunt): S/R trap + next-bar confirm · TP ₹350 · SL ₹200
 * ~67% WR · never blocks Trap · margin-gated.
 */
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
import { extractTradeDate } from '../../utils/trade-date.util';
import { barsOnDay, emaLast, seriesAt } from '../indicators/desk-indicators';
import { ManagedExitDecision, ManagedStrategySignal } from '../models/strategy-module.interface';
import { IndexOptionKind } from '../../utils/option-chain.util';
import {
  PDHL_BANK_RUPEES_PER_POINT,
  PDHL_RUPEES_PER_POINT,
} from '../../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';

export const KUTTY_ID = 'kutty';
export const KUTTY_NAME = 'Kutty';
export const KUTTY_TARGET_RS = 350;
export const KUTTY_STOP_RS = 200;
export const KUTTY_CAPITAL_RS = 60_000;
export const KUTTY_TRAP_RESERVE_RS = 30_000;
export const KUTTY_MARGIN_PER_TRADE_RS = 8_000;
export const KUTTY_MAX_TRADES_PER_DAY = 2;
export const KUTTY_ENTRY_START = '10:00';
export const KUTTY_ENTRY_END = '14:30';
const SWING_LB = 5;
const PIERCE = 3;
const SL_PAD = 2;

export interface KuttyDayState {
  tradingDate: string | null;
  tradesToday: number;
  pending: { dir: 1 | -1; signalClose: number } | null;
}

export function createKuttyDayState(): KuttyDayState {
  return { tradingDate: null, tradesToday: 0, pending: null };
}

export function rsPerPoint(kind: IndexOptionKind): number {
  return kind === 'banknifty' ? PDHL_BANK_RUPEES_PER_POINT : PDHL_RUPEES_PER_POINT;
}

export function kuttyTargetPts(kind: IndexOptionKind): number {
  return KUTTY_TARGET_RS / rsPerPoint(kind);
}

export function kuttyStopPts(kind: IndexOptionKind): number {
  return KUTTY_STOP_RS / rsPerPoint(kind);
}

export function canOpenKutty(params: {
  usedMarginRs: number;
  trapOpenAnywhere: boolean;
  capitalRs?: number;
  trapReserveRs?: number;
  kuttyMarginRs?: number;
}): boolean {
  const capital = params.capitalRs ?? KUTTY_CAPITAL_RS;
  const reserve = params.trapOpenAnywhere ? 0 : (params.trapReserveRs ?? KUTTY_TRAP_RESERVE_RS);
  const need = params.kuttyMarginRs ?? KUTTY_MARGIN_PER_TRADE_RS;
  return capital - params.usedMarginRs - reserve >= need;
}

function wait(candle: Candle, reason: string): ManagedStrategySignal {
  return {
    action: 'WAITING',
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: KUTTY_ID },
  };
}

export function trapOwnsBar(trapReason: string): boolean {
  const r = trapReason.toLowerCase();
  return r.includes('armed') || r.includes('wait confirm');
}

function swingHL(dayBars: Candle[], i: number): { sh: number; sl: number } {
  const start = Math.max(0, i - SWING_LB);
  const window = dayBars.slice(start, i);
  if (!window.length) {
    return { sh: dayBars[i]!.high, sl: dayBars[i]!.low };
  }
  return {
    sh: Math.max(...window.map((b) => b.high)),
    sl: Math.min(...window.map((b) => b.low)),
  };
}

/** Trap wick sweep + next-bar confirm · fixed ₹ TP/SL. */
export function runKuttyScalp(
  ctx: StrategyContext,
  state: KuttyDayState,
  kind: IndexOptionKind,
): ManagedStrategySignal {
  const candle = ctx.candle5m;
  const day = extractTradeDate(candle.date);
  const time = extractHhMm(candle.date);
  if (state.tradingDate !== day) {
    state.tradingDate = day;
    state.tradesToday = 0;
    state.pending = null;
  }
  if (state.tradesToday >= KUTTY_MAX_TRADES_PER_DAY) {
    return wait(candle, 'Kutty max trades');
  }

  const tp = kuttyTargetPts(kind);
  const sl = kuttyStopPts(kind);
  const series = seriesAt(ctx);
  const dayBars = barsOnDay(series, day);
  const i = dayBars.findIndex((b) => b.date === candle.date);

  // --- Confirm pending trap ---
  if (state.pending) {
    const p = state.pending;
    state.pending = null;
    if (time < KUTTY_ENTRY_START || time > KUTTY_ENTRY_END) {
      return wait(candle, 'Kutty confirm outside window');
    }
    const fill = candle.open;
    const bull = p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bear = p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!(bull || bear)) {
      return wait(candle, 'Kutty confirm failed');
    }
    return {
      action: p.dir === 1 ? 'BUY' : 'SELL',
      entryPrice: fill,
      stopLoss: p.dir === 1 ? fill - sl : fill + sl,
      target: p.dir === 1 ? fill + tp : fill - tp,
      riskRewardRatio: tp / sl,
      reason: `Kutty trap confirm ${p.dir === 1 ? 'BUY' : 'SELL'} · ₹${KUTTY_TARGET_RS}/₹${KUTTY_STOP_RS}`,
      analysis: { strategy: KUTTY_ID, setup: 'kutty_trap_confirm' },
    };
  }

  if (time < KUTTY_ENTRY_START || time > KUTTY_ENTRY_END) {
    return wait(candle, 'Kutty outside window');
  }
  if (i < SWING_LB || series.length < 55) {
    return wait(candle, 'Kutty warming');
  }
  const closes = series.map((c) => c.close);
  const ema = emaLast(closes, 50);
  if (ema == null) {
    return wait(candle, 'Kutty EMA');
  }

  const { sh, sl: swingLow } = swingHL(dayBars, i);
  const cc = candle.close;
  const oo = candle.open;
  const hh = candle.high;
  const ll = candle.low;
  const trapBuy = ll < swingLow - PIERCE && cc > swingLow && cc > oo;
  const trapSell = hh > sh + PIERCE && cc < sh && cc < oo;
  const rng = Math.max(hh - ll, 1e-9);
  const bounceBuy =
    ll <= swingLow + PIERCE &&
    ll >= swingLow - PIERCE * 2 &&
    cc > oo &&
    cc >= swingLow &&
    (hh - cc) / rng < 0.35;
  const bounceSell =
    hh >= sh - PIERCE &&
    hh <= sh + PIERCE * 2 &&
    cc < oo &&
    cc <= sh &&
    (cc - ll) / rng < 0.35;

  let dir: 1 | -1 | 0 = 0;
  if ((trapBuy || bounceBuy) && cc > ema) {
    dir = 1;
  } else if ((trapSell || bounceSell) && cc < ema) {
    dir = -1;
  }
  if (!dir) {
    return wait(candle, 'Kutty no trap');
  }

  state.pending = { dir, signalClose: cc };
  return wait(candle, dir === 1 ? 'Kutty BUY armed' : 'Kutty SELL armed');
}

export function kuttyExitLogic(
  candle: Candle,
  open: { direction: 'BUY' | 'SELL'; entry: number; stop: number; target: number },
): ManagedExitDecision | null {
  const time = extractHhMm(candle.date);
  if (open.direction === 'BUY') {
    if (candle.low <= open.stop) {
      return { exitPrice: open.stop, reason: 'Kutty stop' };
    }
    if (candle.high >= open.target) {
      return { exitPrice: open.target, reason: 'Kutty target' };
    }
  } else {
    if (candle.high >= open.stop) {
      return { exitPrice: open.stop, reason: 'Kutty stop' };
    }
    if (candle.low <= open.target) {
      return { exitPrice: open.target, reason: 'Kutty target' };
    }
  }
  if (time >= '15:15') {
    return { exitPrice: candle.close, reason: 'Kutty EOD' };
  }
  return null;
}

export function recordKuttyClosed(state: KuttyDayState): void {
  state.tradesToday += 1;
  state.pending = null;
}

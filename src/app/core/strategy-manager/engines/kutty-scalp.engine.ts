/**
 * Kutty — background scalp engine (NOT a Strat module / not in dropdown).
 * TP ₹350 · SL ₹200 · clear direction only · never blocks Trap.
 */
import { Candle } from '../../models/candle.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm } from '../../strategy-engine/utils/market-session.util';
import { extractTradeDate } from '../../utils/trade-date.util';
import { emaLast, atrAt, seriesAt } from '../indicators/desk-indicators';
import { ManagedExitDecision, ManagedStrategySignal } from '../models/strategy-module.interface';
import { IndexOptionKind } from '../../utils/option-chain.util';
import { PDHL_BANK_RUPEES_PER_POINT, PDHL_RUPEES_PER_POINT } from '../../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';

export const KUTTY_ID = 'kutty';
export const KUTTY_NAME = 'Kutty';
export const KUTTY_TARGET_RS = 350;
export const KUTTY_STOP_RS = 200;
export const KUTTY_CAPITAL_RS = 60_000;
/** Keep free for Trap (1 Nifty + 1 Bank slot estimate). */
export const KUTTY_TRAP_RESERVE_RS = 30_000;
export const KUTTY_MARGIN_PER_TRADE_RS = 8_000;

export interface KuttyDayState {
  tradingDate: string | null;
  tradesToday: number;
}

export function createKuttyDayState(): KuttyDayState {
  return { tradingDate: null, tradesToday: 0 };
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

/** Trap always wins — Kutty only if remaining ≥ margin after Trap reserve. */
export function canOpenKutty(params: {
  usedMarginRs: number;
  trapOpenAnywhere: boolean;
  capitalRs?: number;
  trapReserveRs?: number;
  kuttyMarginRs?: number;
}): boolean {
  const capital = params.capitalRs ?? KUTTY_CAPITAL_RS;
  const reserve = params.trapOpenAnywhere
    ? 0
    : (params.trapReserveRs ?? KUTTY_TRAP_RESERVE_RS);
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

/** True when Trap is mid-setup — Kutty must stand down. */
export function trapOwnsBar(trapReason: string): boolean {
  const r = trapReason.toLowerCase();
  return (
    r.includes('armed') ||
    r.includes('wait confirm') ||
    r.includes('buy @') ||
    r.includes('sell @')
  );
}

/**
 * Clear-direction micro entry: EMA50 slope + close on side + not sideways.
 * Enter at next logic: caller fills at this bar close (desk uses signal price).
 */
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
  }
  if (state.tradesToday >= 1) {
    return wait(candle, 'Kutty max 1/day');
  }
  if (time < '10:00' || time > '14:30') {
    return wait(candle, 'Kutty outside 10:00–14:30');
  }

  const series = seriesAt(ctx);
  if (series.length < 55) {
    return wait(candle, 'Kutty warming');
  }
  const closes = series.map((c) => c.close);
  const ema = emaLast(closes, 50);
  const emaPrev = emaLast(closes.slice(0, -12), 50);
  const atr = atrAt(series, 14);
  if (ema == null || emaPrev == null || atr == null) {
    return wait(candle, 'Kutty indicators');
  }

  // Sideways: ATR weak vs recent mean range proxy
  const recent = series.slice(-20);
  const atrSma =
    recent.reduce((s, b) => s + (b.high - b.low), 0) / Math.max(recent.length, 1);
  if (atr < atrSma * 0.7 && Math.abs(ema - emaPrev) < (kind === 'banknifty' ? 40 : 12)) {
    return wait(candle, 'Kutty sideways');
  }

  const drift = ema - emaPrev;
  const minDrift = kind === 'banknifty' ? 40 : 12;
  let dir: 1 | -1 | 0 = 0;
  if (drift >= minDrift && candle.close > ema && candle.close > candle.open && candle.low <= ema) {
    dir = 1;
  } else if (
    drift <= -minDrift &&
    candle.close < ema &&
    candle.close < candle.open &&
    candle.high >= ema
  ) {
    dir = -1;
  }
  if (!dir) {
    return wait(candle, 'Kutty no clear direction');
  }

  const fill = candle.close;
  const tp = kuttyTargetPts(kind);
  const sl = kuttyStopPts(kind);
  return {
    action: dir === 1 ? 'BUY' : 'SELL',
    entryPrice: fill,
    stopLoss: dir === 1 ? fill - sl : fill + sl,
    target: dir === 1 ? fill + tp : fill - tp,
    riskRewardRatio: tp / sl,
    reason: `Kutty ${dir === 1 ? 'BUY' : 'SELL'} · ₹${KUTTY_TARGET_RS}/₹${KUTTY_STOP_RS}`,
    analysis: { strategy: KUTTY_ID, setup: 'kutty_scalp' },
  };
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
}

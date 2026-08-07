import { Candle } from '../models/candle.model';
import { PaperTrade } from './paper-desk.models';

/**
 * Re-price replay trades at fills the desk can actually get.
 *
 * The replay exits at the exact stop, target or trail level — prices touched
 * *inside* a bar. Live cannot do that. It only sees a 5m bar once the bar has
 * closed, so the earliest it can act is the next bar's open. Resting SL/TP
 * orders do sit at the exchange and still fire intrabar.
 *
 * Measured over 180 trading days, 1 lot, current Trap DNA:
 *   Nifty  modelled ₹367,728 → real gross ₹22,963 (92% of trades last one bar)
 *   Bank   modelled ₹132,114 → real gross  ₹6,454
 * Almost all of the modelled edge is an intrabar fill nobody can get. Testing
 * has to show the real number or it is not a test.
 */

/** Stops and targets rest at the exchange, so they still fill intrabar. */
export function isRestingExit(exitReason: string): boolean {
  const r = (exitReason ?? '').toLowerCase();
  return r.includes('stop loss') || r.includes('target');
}

export interface ExecutableFill {
  /** Index points actually obtainable, or null when the trade was unreachable. */
  indexPoints: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
}

/**
 * Fill one trade against its own series.
 * Returns nulls when the move was over before the desk could act.
 */
export function executableFill(
  trade: Pick<
    PaperTrade,
    'direction' | 'entryTime' | 'exitTime' | 'exitReason' | 'indexExit' | 'indexPoints'
  >,
  indexByTime: ReadonlyMap<string, number>,
  candles: readonly Candle[],
): ExecutableFill {
  const none: ExecutableFill = { indexPoints: null, entryPrice: null, exitPrice: null };
  const ei = indexByTime.get(trade.entryTime);
  const xi = indexByTime.get(trade.exitTime);
  if (ei == null || xi == null) {
    return none;
  }
  const entryBar = candles[ei + 1];
  if (!entryBar) {
    return none;
  }
  const entryPrice = entryBar.open;

  let exitPrice: number;
  if (isRestingExit(trade.exitReason)) {
    // The order is only live once we are in, so it cannot fill before our entry bar.
    if (xi < ei + 1) {
      return none;
    }
    exitPrice = trade.indexExit;
  } else {
    const exitBar = candles[xi + 1];
    if (!exitBar || xi + 1 <= ei + 1) {
      return none;
    }
    exitPrice = exitBar.open;
  }

  const indexPoints =
    trade.direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return { indexPoints, entryPrice, exitPrice };
}

export function buildBarIndex(candles: readonly Candle[]): Map<string, number> {
  const map = new Map<string, number>();
  candles.forEach((c, i) => map.set(c.date, i));
  return map;
}

/**
 * Reprice a set of trades. Trades whose move finished before the desk could
 * act are dropped — reporting them as fills would repeat the exact mistake
 * that made Testing disagree with the account.
 */
export function repriceTradesToExecutableFills(
  trades: readonly PaperTrade[],
  candlesByInstrument: ReadonlyMap<string, readonly Candle[]>,
): PaperTrade[] {
  const indexes = new Map<string, Map<string, number>>();
  const out: PaperTrade[] = [];

  for (const t of trades) {
    const candles = candlesByInstrument.get(t.instrumentId);
    if (!candles?.length) {
      out.push(t);
      continue;
    }
    let idx = indexes.get(t.instrumentId);
    if (!idx) {
      idx = buildBarIndex(candles);
      indexes.set(t.instrumentId, idx);
    }
    const fill = executableFill(t, idx, candles);
    if (fill.indexPoints == null) {
      continue;
    }
    const scale = t.indexPoints !== 0 ? fill.indexPoints / t.indexPoints : 0;
    out.push({
      ...t,
      modelledIndexPoints: t.indexPoints,
      indexPoints: fill.indexPoints,
      indexEntry: fill.entryPrice ?? t.indexEntry,
      indexExit: fill.exitPrice ?? t.indexExit,
      // Option money moves with the index move it came from.
      optionPnlRs: t.optionPnlRs == null ? null : t.optionPnlRs * scale,
      netOptionPnlRs: t.netOptionPnlRs == null ? null : t.netOptionPnlRs * scale,
      outcome: fill.indexPoints > 0 ? 'WIN' : fill.indexPoints < 0 ? 'LOSS' : 'FLAT',
      moneyOutcome: undefined,
    });
  }
  return out;
}

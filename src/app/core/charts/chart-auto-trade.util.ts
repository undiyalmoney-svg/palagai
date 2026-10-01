/**
 * Charts auto buy/sell — same order path on Nifty 50, Bank Nifty and Crude,
 * armed independently on each book.
 *
 * A confirmed SMC BUY buys the ATM call. A confirmed SMC SELL buys the ATM
 * put (long the hedge, never a naked short of the option). After the market
 * fill a 25% premium (or rupee-cap) stop rests at Kite. The target is watched
 * here and flattened — Kite rejects a second SELL while that stop holds qty.
 */
import { AtmOptionSide } from '../orders/atm-order.util';
import { ChartBookId } from './live-chart-data.service';
import { ChartPnlCap, ChartPnlCaps, ChartPnlHit } from './chart-pnl-cap';
import { SmcAlertType } from './smc/smc.types';

export function optionSideForAlert(type: SmcAlertType): AtmOptionSide | null {
  if (type === 'BUY') return 'CE';
  if (type === 'SELL') return 'PE';
  return null;
}

export function chartProtectiveLevels(
  fill: number,
  tick = 0.05,
  caps?: {
    maxProfitRs?: number | null;
    maxLossRs?: number | null;
    rupeePerPoint?: number | null;
  },
): { stop: number; target: number } | null {
  if (!(fill > 0) || !Number.isFinite(fill)) return null;
  const step = tick > 0 ? tick : 0.05;
  const risk = fill * 0.25;
  const systemStop = roundToTick(fill - risk, step);
  const systemTarget = roundToTick(fill + 0.5 * risk, step);
  const stop = rupeeLevel(fill, caps?.maxLossRs, caps?.rupeePerPoint, step, -1) ?? systemStop;
  const target = rupeeLevel(fill, caps?.maxProfitRs, caps?.rupeePerPoint, step, 1) ?? systemTarget;
  if (!(stop > 0) || !(target > fill)) return null;
  return { stop, target };
}

/** Premium that realises `rupees` on the fill. Null when that side is unset. */
function rupeeLevel(
  fill: number,
  rupees: number | null | undefined,
  rupeePerPoint: number | null | undefined,
  tick: number,
  sign: 1 | -1,
): number | null {
  if (!(rupees != null && rupees > 0) || !(rupeePerPoint != null && rupeePerPoint > 0)) {
    return null;
  }
  const level = roundToTick(fill + (sign * rupees) / rupeePerPoint, tick);
  if (sign < 0) {
    return level > 0 && level < fill ? level : null;
  }
  return level > fill ? level : null;
}

export function shouldAutoTrade(opts: {
  autoTrade: boolean;
  liveDay: boolean;
  marketOpen: boolean;
  busy: boolean;
  type: SmcAlertType;
}): boolean {
  return (
    opts.autoTrade === true &&
    opts.liveDay === true &&
    opts.marketOpen === true &&
    opts.busy !== true &&
    optionSideForAlert(opts.type) != null
  );
}

/**
 * Rupees one point of premium moves an open Charts fill.
 * Index quantity is the multiplier; Crude Mini qty 1 is ₹10 per point.
 */
export function chartRupeePerPoint(book: ChartBookId | null | undefined, qty: number): number {
  if (!(qty > 0)) return 0;
  if (book === 'crude') return qty * 10;
  return qty;
}

export function sameProtectivePrice(
  actual: number | null | undefined,
  wanted: number,
  tick = 0.05,
): boolean {
  if (actual == null || !Number.isFinite(actual)) return false;
  const step = tick > 0 ? tick : 0.05;
  return Math.abs(actual - wanted) < step / 2 + 1e-9;
}

export function desiredProtectiveLevels(
  trade: {
    status: string;
    entry: number | null;
    qty: number;
    book: ChartBookId | null;
  },
  cap: ChartPnlCap | null | undefined,
  tick = 0.05,
): { stop: number; target: number } | null {
  if (trade.status !== 'OPEN' || !(trade.entry != null && trade.entry > 0)) return null;
  const rupeePerPoint = chartRupeePerPoint(trade.book, trade.qty);
  return chartProtectiveLevels(trade.entry, tick, {
    maxProfitRs: cap?.maxProfitRs,
    maxLossRs: cap?.maxLossRs,
    rupeePerPoint: rupeePerPoint > 0 ? rupeePerPoint : null,
  });
}

/**
 * Open fills whose resting broker SL does not match the stop now in settings.
 * Target is watched in software — Kite rejects a LIMIT SELL while the SL still
 * holds the quantity, so TP is never rested beside the stop.
 */
export function fillsNeedingProtectiveSync(
  trades: Array<{
    id: string;
    status: string;
    book: ChartBookId | null;
    entry: number | null;
    qty: number;
    sl: number | null;
    tp: number | null;
  }>,
  caps: ChartPnlCaps,
  inFlight: Iterable<string> = [],
  tick = 0.05,
): Array<{ id: string; stop: number; target: number }> {
  const busy = new Set(inFlight);
  const hits: Array<{ id: string; stop: number; target: number }> = [];
  for (const trade of trades) {
    if (trade.status !== 'OPEN' || !trade.book || busy.has(trade.id)) continue;
    if (trade.id.startsWith('local:')) continue;
    const levels = desiredProtectiveLevels(trade, caps[trade.book], tick);
    if (!levels) continue;
    if (sameProtectivePrice(trade.sl, levels.stop, tick)) continue;
    hits.push({ id: trade.id, stop: levels.stop, target: levels.target });
  }
  return hits;
}

/**
 * Open fills whose last premium has reached the planned stop or target.
 * Used so a 0.5R / rupee target can still flatten when it is not rested at
 * Kite (a second SELL would be rejected while the SL is live).
 */
export function fillsHittingPlannedLevels(
  trades: Array<{
    id: string;
    status: string;
    book: ChartBookId | null;
    last: number | null;
    entry: number | null;
    qty: number;
  }>,
  caps: ChartPnlCaps,
  inFlight: Iterable<string> = [],
): Array<{ id: string; reason: ChartPnlHit }> {
  const busy = new Set(inFlight);
  const hits: Array<{ id: string; reason: ChartPnlHit }> = [];
  for (const trade of trades) {
    if (trade.status !== 'OPEN' || !trade.book || busy.has(trade.id)) continue;
    if (trade.last == null || !Number.isFinite(trade.last)) continue;
    const levels = desiredProtectiveLevels(trade, caps[trade.book]);
    if (!levels) continue;
    let reason: ChartPnlHit | null = null;
    if (trade.last <= levels.stop) reason = 'LOSS';
    else if (trade.last >= levels.target) reason = 'PROFIT';
    if (!reason) continue;
    hits.push({ id: trade.id, reason });
    busy.add(trade.id);
  }
  return hits;
}

function roundToTick(value: number, tick: number): number {
  return Math.round(value / tick) * tick;
}

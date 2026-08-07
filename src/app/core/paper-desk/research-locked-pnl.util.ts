/**
 * Research "Locked" ₹ — the meter behind the all-day-green monthly table:
 *
 *   Jan ₹53,474 … Jul ₹65,041 … Aug(1–7) ₹14,545
 *
 * Formula (scripts/all-day-green-monster-hunt.py):
 *   trade ₹ = indexPts × (Nifty65|Bank30) − ₹40 round-trip proxy
 *   day ₹   = sum(trades that day)
 *   locked  = min(day ₹, ₹3000) when day > 0 (else day ₹)
 *
 * This is INDEX PROXY with a reporting cap — not option premium and not the
 * Live in-strategy dayProfitLockPts that stops new entries.
 */
import { rupeesPerPointForInstrument } from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { extractTradeDate } from '../utils/trade-date.util';
import { PaperTrade } from './paper-desk.models';

/** Approx MIS round-trip proxy per index fill (hunt CHARGE_IDX). */
export const RESEARCH_INDEX_CHARGE_RS = 40;

/** Desk research day cap used in published Locked months. */
export const RESEARCH_DAY_LOCK_RS = 3000;

export function researchTradeIndexRs(
  trade: Pick<PaperTrade, 'instrumentId' | 'indexPoints'>,
  lots: number = 1,
): number {
  const mult = Math.max(1, Math.floor(lots) || 1);
  const rs = rupeesPerPointForInstrument(trade.instrumentId);
  return trade.indexPoints * rs * mult - RESEARCH_INDEX_CHARGE_RS * mult;
}

/** Per-day unlocked research ₹ (after per-trade charge, before day cap). */
export function researchDayNetsRs(
  trades: readonly Pick<PaperTrade, 'instrumentId' | 'indexPoints' | 'entryTime'>[],
  lotsForInstrument: (instrumentId: string) => number = () => 1,
): Map<string, number> {
  const day = new Map<string, number>();
  for (const t of trades) {
    const d = extractTradeDate(t.entryTime);
    const lots = lotsForInstrument(t.instrumentId);
    day.set(d, (day.get(d) ?? 0) + researchTradeIndexRs(t, lots));
  }
  return day;
}

/** Apply the ₹3k reporting lock used in the published monthly table. */
export function applyResearchDayLock(
  dayNets: ReadonlyMap<string, number>,
  lockRs: number = RESEARCH_DAY_LOCK_RS,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [d, v] of dayNets) {
    out.set(d, v > 0 && lockRs > 0 ? Math.min(v, lockRs) : v);
  }
  return out;
}

/** Sum of Locked day ₹ over trades (research monthly meter). */
export function researchLockedNetRs(
  trades: readonly Pick<PaperTrade, 'instrumentId' | 'indexPoints' | 'entryTime'>[],
  options?: {
    lotsForInstrument?: (instrumentId: string) => number;
    lockRs?: number;
  },
): number {
  const days = researchDayNetsRs(trades, options?.lotsForInstrument);
  const locked = applyResearchDayLock(days, options?.lockRs ?? RESEARCH_DAY_LOCK_RS);
  let sum = 0;
  for (const v of locked.values()) {
    sum += v;
  }
  return Math.round(sum * 100) / 100;
}

/** Month → Locked ₹ (YYYY-MM). */
export function researchLockedByMonth(
  trades: readonly Pick<PaperTrade, 'instrumentId' | 'indexPoints' | 'entryTime'>[],
  options?: {
    lotsForInstrument?: (instrumentId: string) => number;
    lockRs?: number;
    /** Inclusive end date YYYY-MM-DD (e.g. Aug partial month). */
    toDate?: string;
  },
): Record<string, number> {
  const days = researchDayNetsRs(trades, options?.lotsForInstrument);
  const locked = applyResearchDayLock(days, options?.lockRs ?? RESEARCH_DAY_LOCK_RS);
  const by: Record<string, number> = {};
  for (const [d, v] of locked) {
    if (options?.toDate && d > options.toDate) {
      continue;
    }
    const m = d.slice(0, 7);
    by[m] = (by[m] ?? 0) + v;
  }
  for (const k of Object.keys(by)) {
    by[k] = Math.round(by[k]!);
  }
  return by;
}

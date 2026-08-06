import { PaperTrade } from './paper-desk.models';

/** Minimal order-book row needed to rebuild Kite Positions P&L. */
export interface KiteFillOrderRow {
  instrumentId: string;
  tradingSymbol: string;
  quantity: number;
  leg: string;
  status: string;
  averagePrice: number | null;
  at: string;
}

/**
 * Kite closed-position money (long option MIS):
 *   (exitAvg − entryAvg) × quantity
 *
 * Overlays that onto paper trades using Live money order-book fills.
 * Does not change entry/exit timing or order placement — calculation only.
 *
 * Matching rules (v1.3.68):
 *  - Prefer same tradingSymbol as the paper leg
 *  - Prefer fill entry time closest to paper entryTime
 *  - Never fall back to a different symbol on the same instrument
 *    (that mixed CE/PE or strike legs → fut pts from one trade + ₹ from another)
 */
export function applyKiteFillPnl(
  trades: PaperTrade[],
  orderSummary: KiteFillOrderRow[],
): PaperTrade[] {
  if (!trades.length || !orderSummary.length) {
    return trades;
  }

  const pairsByInstrument = buildFillPairs(orderSummary);
  if (pairsByInstrument.size === 0) {
    return trades;
  }

  const used = new Set<string>();
  return trades.map((trade) => {
    const pairs = pairsByInstrument.get(trade.instrumentId);
    if (!pairs?.length) {
      return trade;
    }

    const symbol = (trade.option?.tradingSymbol ?? '').toUpperCase();
    const tradeEntryMs = parseTs(trade.entryTime);
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < pairs.length; i += 1) {
      if (used.has(pairKey(trade.instrumentId, i))) {
        continue;
      }
      const p = pairs[i]!;
      const pairSym = (p.tradingSymbol ?? '').toUpperCase();
      // Same symbol required when paper knows the contract.
      if (symbol && pairSym && pairSym !== symbol) {
        continue;
      }
      const entryMs = parseTs(p.entryAt);
      const score =
        tradeEntryMs > 0 && entryMs > 0
          ? Math.abs(entryMs - tradeEntryMs)
          : i; // stable fallback: earlier unused pair
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) {
      return trade;
    }

    used.add(pairKey(trade.instrumentId, bestIdx));
    const pair = pairs[bestIdx]!;
    const qty = Math.max(1, pair.quantity);
    const optionPnlRs = roundPaise((pair.exitAvg - pair.entryAvg) * qty);

    return {
      ...trade,
      optionEntryPremium: pair.entryAvg,
      optionExitPremium: pair.exitAvg,
      optionPnlRs,
      premiumEstimated: false,
      onKite: true,
      option: trade.option
        ? {
            ...trade.option,
            // Prefer fill qty as lotSize when chain lot was missing/wrong (e.g. CSV lot=1).
            lotSize:
              trade.option.lotSize > 1
                ? trade.option.lotSize
                : qty,
          }
        : trade.option,
    };
  });
}

interface FillPair {
  tradingSymbol: string;
  quantity: number;
  entryAvg: number;
  exitAvg: number;
  entryAt: string;
  exitAt: string;
}

function buildFillPairs(orderSummary: KiteFillOrderRow[]): Map<string, FillPair[]> {
  const byInstrument = new Map<string, KiteFillOrderRow[]>();
  for (const row of orderSummary) {
    if (!row.instrumentId) {
      continue;
    }
    const list = byInstrument.get(row.instrumentId) ?? [];
    list.push(row);
    byInstrument.set(row.instrumentId, list);
  }

  const out = new Map<string, FillPair[]>();
  for (const [instrumentId, rows] of byInstrument) {
    // Pair ENTRY→EXIT within the same symbol first (avoid CE exit glued to PE entry).
    const bySymbol = new Map<string, KiteFillOrderRow[]>();
    for (const row of rows) {
      const sym = (row.tradingSymbol || '').toUpperCase() || '_';
      const list = bySymbol.get(sym) ?? [];
      list.push(row);
      bySymbol.set(sym, list);
    }

    const pairs: FillPair[] = [];
    for (const [, symRows] of bySymbol) {
      const entries = symRows
        .filter((r) => isComplete(r.status) && r.leg === 'ENTRY' && hasAvg(r))
        .sort((a, b) => a.at.localeCompare(b.at));
      const exits = symRows
        .filter(
          (r) =>
            isComplete(r.status) &&
            (r.leg === 'EXIT' || r.leg === 'SL-M') &&
            hasAvg(r),
        )
        .sort((a, b) => a.at.localeCompare(b.at));

      const n = Math.min(entries.length, exits.length);
      for (let i = 0; i < n; i += 1) {
        const entry = entries[i]!;
        const exit = exits[i]!;
        pairs.push({
          tradingSymbol: entry.tradingSymbol || exit.tradingSymbol,
          quantity: entry.quantity > 0 ? entry.quantity : exit.quantity,
          entryAvg: entry.averagePrice!,
          exitAvg: exit.averagePrice!,
          entryAt: entry.at,
          exitAt: exit.at,
        });
      }
    }
    if (pairs.length) {
      // Keep chronological for stable unused-index fallback.
      pairs.sort((a, b) => a.entryAt.localeCompare(b.entryAt));
      out.set(instrumentId, pairs);
    }
  }
  return out;
}

function isComplete(status: string): boolean {
  return (status ?? '').trim().toUpperCase() === 'COMPLETE';
}

function hasAvg(row: KiteFillOrderRow): boolean {
  return row.averagePrice != null && row.averagePrice > 0;
}

function pairKey(instrumentId: string, index: number): string {
  return `${instrumentId}#${index}`;
}

function roundPaise(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseTs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const ms = Date.parse(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * True when the Live money order book already has a COMPLETE ENTRY fill for this
 * desk leg's instrument (and symbol when known). Used so Event log SKIP does not
 * claim "never reached Kite" while ENTRY is on the book but EXIT not paired yet.
 */
export function deskLegHasKiteEntry(
  trade: Pick<PaperTrade, 'instrumentId' | 'option'>,
  orderSummary: KiteFillOrderRow[],
): boolean {
  const symbol = (trade.option?.tradingSymbol ?? '').toUpperCase();
  return orderSummary.some(
    (r) =>
      r.instrumentId === trade.instrumentId &&
      isComplete(r.status) &&
      r.leg === 'ENTRY' &&
      hasAvg(r) &&
      (!symbol || !(r.tradingSymbol || '').toUpperCase() || (r.tradingSymbol || '').toUpperCase() === symbol),
  );
}

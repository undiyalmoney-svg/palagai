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

    const symbol = trade.option?.tradingSymbol ?? '';
    const idx = pairs.findIndex(
      (p, i) =>
        !used.has(pairKey(trade.instrumentId, i)) &&
        (!symbol || !p.tradingSymbol || p.tradingSymbol === symbol),
    );
    const fallbackIdx =
      idx >= 0
        ? idx
        : pairs.findIndex((_, i) => !used.has(pairKey(trade.instrumentId, i)));
    if (fallbackIdx < 0) {
      return trade;
    }

    used.add(pairKey(trade.instrumentId, fallbackIdx));
    const pair = pairs[fallbackIdx]!;
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
            // Keep lotSize consistent with fill qty when 1 lot was traded.
            lotSize:
              trade.option.lotSize > 0
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
    const entries = rows
      .filter((r) => isComplete(r.status) && r.leg === 'ENTRY' && hasAvg(r))
      .sort((a, b) => a.at.localeCompare(b.at));
    const exits = rows
      .filter(
        (r) =>
          isComplete(r.status) &&
          (r.leg === 'EXIT' || r.leg === 'SL-M') &&
          hasAvg(r),
      )
      .sort((a, b) => a.at.localeCompare(b.at));

    const pairs: FillPair[] = [];
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
    if (pairs.length) {
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

/**
 * True when the Live money order book already has a COMPLETE ENTRY fill for this
 * desk leg's instrument (and symbol when known). Used so Event log SKIP does not
 * claim "never reached Kite" while ENTRY is on the book but EXIT not paired yet.
 */
export function deskLegHasKiteEntry(
  trade: Pick<PaperTrade, 'instrumentId' | 'option'>,
  orderSummary: KiteFillOrderRow[],
): boolean {
  const symbol = trade.option?.tradingSymbol ?? '';
  return orderSummary.some(
    (r) =>
      r.instrumentId === trade.instrumentId &&
      isComplete(r.status) &&
      r.leg === 'ENTRY' &&
      hasAvg(r) &&
      (!symbol || !r.tradingSymbol || r.tradingSymbol === symbol),
  );
}

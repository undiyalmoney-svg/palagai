import { isMcxOptionContext } from '../live-desk/option-sl-premium.util';
import { crudeMiniLotSize } from '../utils/crude-option.util';
import { PaperOptionContract, PaperTrade } from './paper-desk.models';

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
 * Units for Positions-style ₹.
 * NFO: order qty is already units (65/30).
 * MCX Crude/NG: orders often show qty=1 (= 1 lot) while Positions ₹ uses × lotSize (10).
 * Today 2026-08-06: Crude CE fills qty=1 but Kite day PnL = premiumΔ × 10.
 */
export function fillUnitsForPnl(params: {
  tradingSymbol?: string | null;
  quantity: number;
  lotSize?: number | null;
  exchange?: string | null;
}): number {
  const q = Math.max(1, Math.floor(params.quantity) || 1);
  if (!isMcxOptionContext(params.exchange, params.tradingSymbol)) {
    return q;
  }
  const sym = (params.tradingSymbol ?? '').toUpperCase();
  const lot = sym.startsWith('CRUDEOIL')
    ? crudeMiniLotSize(params.lotSize)
    : Math.max(1, Math.floor(Number(params.lotSize) || 0) || q);
  return q < lot ? q * lot : q;
}

/**
 * Kite closed-position money (long option MIS):
 *   (exitAvg − entryAvg) × units
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
  return syncTradesToKiteFills(trades, orderSummary).filter((t) =>
    trades.some((p) => p.id === t.id),
  );
}

/**
 * Live money truth: paper legs matched to Kite fills **plus** any Kite
 * ENTRY→EXIT pairs the desk replay never invented (wrong CE/PE/strike).
 *
 * Today 2026-08-06: desk paper showed PE −₹500 Index SL cards while Kite
 * held winning CE fills (+₹628.50 Crude). Unmatched CE pairs must still
 * appear as Profit ₹.
 */
export function syncTradesToKiteFills(
  trades: PaperTrade[],
  orderSummary: KiteFillOrderRow[],
  instrumentNames?: ReadonlyMap<string, string>,
): PaperTrade[] {
  if (!orderSummary.length) {
    return trades;
  }

  const pairsByInstrument = buildFillPairs(orderSummary);
  if (pairsByInstrument.size === 0) {
    return trades;
  }

  const used = new Set<string>();
  const overlaid = trades.map((trade) => {
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
    return overlayPairOnTrade(trade, pairs[bestIdx]!);
  });

  const synthetics: PaperTrade[] = [];
  for (const [instrumentId, pairs] of pairsByInstrument) {
    for (let i = 0; i < pairs.length; i += 1) {
      if (used.has(pairKey(instrumentId, i))) {
        continue;
      }
      synthetics.push(
        tradeFromKitePair({
          instrumentId,
          instrumentName: instrumentNames?.get(instrumentId) ?? instrumentId,
          pair: pairs[i]!,
          seq: synthetics.length + 1,
        }),
      );
    }
  }

  return [...overlaid, ...synthetics];
}

interface FillPair {
  tradingSymbol: string;
  quantity: number;
  entryAvg: number;
  exitAvg: number;
  entryAt: string;
  exitAt: string;
}

function overlayPairOnTrade(trade: PaperTrade, pair: FillPair): PaperTrade {
  const mcx = isMcxOptionContext(trade.option?.exchange, pair.tradingSymbol);
  const units = fillUnitsForPnl({
    tradingSymbol: pair.tradingSymbol,
    quantity: pair.quantity,
    lotSize: trade.option?.lotSize,
    exchange: trade.option?.exchange,
  });
  const optionPnlRs = roundPaise((pair.exitAvg - pair.entryAvg) * units);
  const nextLotSize = mcx
    ? (pair.tradingSymbol || '').toUpperCase().startsWith('CRUDEOIL')
      ? crudeMiniLotSize(trade.option?.lotSize)
      : Math.max(1, trade.option?.lotSize || units)
    : trade.option && trade.option.lotSize > 1
      ? trade.option.lotSize
      : Math.max(1, pair.quantity);
  const outcome = moneyOutcome(optionPnlRs);

  return {
    ...trade,
    optionEntryPremium: pair.entryAvg,
    optionExitPremium: pair.exitAvg,
    optionPnlRs,
    premiumEstimated: false,
    onKite: true,
    outcome,
    moneyOutcome: outcome,
    option: trade.option
      ? {
          ...trade.option,
          lotSize: nextLotSize,
          tradingSymbol: pair.tradingSymbol || trade.option.tradingSymbol,
          optionType: optionTypeFromSymbol(pair.tradingSymbol) ?? trade.option.optionType,
        }
      : optionContractFromSymbol(pair.tradingSymbol, nextLotSize),
  };
}

function tradeFromKitePair(params: {
  instrumentId: string;
  instrumentName: string;
  pair: FillPair;
  seq: number;
}): PaperTrade {
  const { instrumentId, instrumentName, pair, seq } = params;
  const sym = (pair.tradingSymbol || '').toUpperCase();
  const mcx = isMcxOptionContext(null, sym);
  const lotSize = sym.startsWith('CRUDEOIL')
    ? crudeMiniLotSize(1)
    : Math.max(1, pair.quantity);
  const units = fillUnitsForPnl({
    tradingSymbol: sym,
    quantity: pair.quantity,
    lotSize,
    exchange: mcx ? 'MCX' : 'NFO',
  });
  const optionPnlRs = roundPaise((pair.exitAvg - pair.entryAvg) * units);
  const outcome = moneyOutcome(optionPnlRs);
  const ot = optionTypeFromSymbol(sym) ?? 'CE';
  const entryTime = toDeskTs(pair.entryAt);
  const exitTime = toDeskTs(pair.exitAt);

  return {
    id: `kite-${instrumentId}-${seq}-${sym}-${entryTime}`,
    instrumentId,
    instrumentName,
    direction: ot === 'PE' ? 'SELL' : 'BUY',
    indexEntry: 0,
    indexStop: 0,
    indexTarget: 0,
    indexExit: 0,
    indexPoints: 0,
    entryTime,
    exitTime,
    exitReason: 'Kite fill · Positions ₹',
    option: optionContractFromSymbol(sym, lotSize),
    optionEntryPremium: pair.entryAvg,
    optionExitPremium: pair.exitAvg,
    optionPnlRs,
    premiumEstimated: false,
    onKite: true,
    outcome,
    moneyOutcome: outcome,
  };
}

function optionContractFromSymbol(
  tradingSymbol: string,
  lotSize: number,
): PaperOptionContract {
  const sym = (tradingSymbol || '').toUpperCase();
  const ot = optionTypeFromSymbol(sym) ?? 'CE';
  const mcx = isMcxOptionContext(null, sym);
  return {
    tradingSymbol: sym || tradingSymbol,
    instrumentToken: 0,
    strike: strikeFromSymbol(sym) ?? 0,
    expiry: '',
    optionType: ot,
    lotSize,
    source: 'chain',
    exchange: mcx ? 'MCX' : 'NFO',
    product: 'MIS',
  };
}

function optionTypeFromSymbol(symbol: string): 'CE' | 'PE' | null {
  const s = (symbol || '').toUpperCase();
  if (s.endsWith('CE')) {
    return 'CE';
  }
  if (s.endsWith('PE')) {
    return 'PE';
  }
  return null;
}

/** Best-effort strike parse: …7250CE / …58000CE */
function strikeFromSymbol(symbol: string): number | null {
  const m = /(\d{4,6})(CE|PE)$/i.exec(symbol || '');
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function moneyOutcome(pnl: number): 'WIN' | 'LOSS' | 'FLAT' {
  if (pnl > 0) {
    return 'WIN';
  }
  if (pnl < 0) {
    return 'LOSS';
  }
  return 'FLAT';
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

function toDeskTs(value: string): string {
  if (!value) {
    return value;
  }
  // Keep ISO; desk formatters accept both.
  return value.includes('T') ? value : value.replace(' ', 'T');
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
      (!symbol ||
        !(r.tradingSymbol || '').toUpperCase() ||
        (r.tradingSymbol || '').toUpperCase() === symbol),
  );
}

/**
 * Turn "buy the ATM CE on this book" into an exact Kite order, or into a
 * reason it must not be sent.
 *
 * This is the only place the charts tab's manual buy buttons decide what goes
 * to the exchange, and it is pure so every rule below is unit tested rather
 * than trusted.
 *
 * Two rules here exist because getting them wrong costs real money:
 *
 * 1. ORDER QUANTITY IS NOT THE ₹ MULTIPLIER FOR CRUDE. Kite lists CRUDEOILM
 *    CE/PE with lot_size 10 (barrels), but one Mini lot is quantity 1. The
 *    live desk carries the same rule in crudeMiniOrderLotSize, added after
 *    sending lot_size directly turned 3 lots into 30 contracts. Index options
 *    are the opposite: quantity really is 65 or 30 per lot.
 *
 * 2. A SYNTHETIC CONTRACT IS NEVER TRADEABLE. Both ATM resolvers fall back to
 *    an invented label (token 0, a symbol like "NIFTY ATM 24500 CE") when the
 *    chain has no match, which is right for paper replay and unusable for an
 *    order. Those are refused here rather than rejected by Kite.
 */
import { Instrument } from '../models/instrument.model';
import { ChartBookId } from '../charts/live-chart-data.service';
import { CHART_EXIT_TAG } from '../charts/chart-live-trades';
import { IndexOptionKind, resolveAtmWeeklyOption } from '../utils/option-chain.util';
import { crudeMiniLotSize, resolveAtmCrudeMiniOption } from '../utils/crude-option.util';

export type AtmOptionSide = 'CE' | 'PE';

export type AtmProtectiveTicket = Pick<
  AtmOrderTicket,
  'exchange' | 'tradingSymbol' | 'quantity' | 'product'
>;

export interface AtmOrderTicket {
  book: ChartBookId;
  side: AtmOptionSide;
  tradingSymbol: string;
  instrumentToken: number;
  exchange: 'NFO' | 'MCX';
  /** Intraday, matching what the live desk uses for every book. */
  product: 'MIS';
  strike: number;
  expiry: string;
  /** Lots requested. */
  lots: number;
  /** `quantity` field sent to Kite. See rule 1 above. */
  quantity: number;
  /**
   * Underlying units one lot controls, for the rupee estimate. Equals
   * `quantity` for index options and deliberately does not for crude.
   */
  unitsPerLot: number;
  /** Underlying price the strike was picked from. */
  spot: number;
}

export type AtmOrderPlan =
  | { ok: true; ticket: AtmOrderTicket }
  | { ok: false; reason: string };

/** Books that have an option chain the buttons can trade. */
const INDEX_KIND: Partial<Record<ChartBookId, IndexOptionKind>> = {
  nifty: 'nifty',
  bank: 'banknifty',
};

export function buildAtmOrderPlan(params: {
  book: ChartBookId;
  instruments: Instrument[];
  side: AtmOptionSide;
  spot: number;
  asOfDateTime: string;
  lots: number;
}): AtmOrderPlan {
  const { book, instruments, side, spot, asOfDateTime } = params;
  const lots = Math.floor(params.lots);
  if (!Number.isFinite(spot) || spot <= 0) {
    return { ok: false, reason: 'No live price for this book yet.' };
  }
  if (!Number.isFinite(lots) || lots < 1) {
    return { ok: false, reason: 'Lots must be at least 1.' };
  }
  if (!instruments.length) {
    return {
      ok: false,
      reason: 'Instrument list is empty. Refresh instruments in Settings.',
    };
  }

  // Both resolvers take a trade direction and read CE from BUY, PE from SELL.
  // The buttons name the contract instead, and always BUY it.
  const direction = side === 'CE' ? 'BUY' : 'SELL';
  const kind = INDEX_KIND[book];
  const resolved = kind
    ? resolveAtmWeeklyOption({ instruments, kind, direction, spot, asOfDateTime })
    : resolveAtmCrudeMiniOption({ instruments, direction, spot, asOfDateTime });

  if (resolved.source === 'synthetic') {
    return {
      ok: false,
      reason: kind
        ? 'No live ATM contract in the instrument list. Refresh instruments in Settings.'
        : 'No live CRUDEOILM ATM contract. Refresh instruments in Settings — the front month rolls monthly.',
    };
  }

  const option = resolved.instrument;
  if (!option.instrumentToken) {
    return { ok: false, reason: 'Resolved contract has no Kite token; refusing to order.' };
  }

  const crude = !kind;
  const unitsPerLot = crude ? crudeMiniLotSize(option.lotSize) : lotUnits(option);
  const quantity = (crude ? 1 : lotUnits(option)) * lots;

  return {
    ok: true,
    ticket: {
      book,
      side,
      tradingSymbol: option.tradingSymbol,
      instrumentToken: option.instrumentToken,
      exchange: crude ? 'MCX' : 'NFO',
      product: 'MIS',
      strike: option.strike,
      expiry: option.expiry,
      lots,
      quantity,
      unitsPerLot,
      spot,
    },
  };
}

/** Kite form fields for the ticket. MARKET buy, mirroring the live desk. */
export function atmOrderFields(ticket: AtmOrderTicket): Record<string, string> {
  return {
    exchange: ticket.exchange,
    tradingsymbol: ticket.tradingSymbol,
    transaction_type: 'BUY',
    order_type: 'MARKET',
    quantity: String(ticket.quantity),
    product: ticket.product,
    validity: 'DAY',
    market_protection: '-1',
    // Distinct from the desk's PALAGAI tag so manual buys are separable in the
    // order book, and so the desk's own fill seeding never counts them.
    tag: 'PALAGAI_CHART',
  };
}

/**
 * Protective SELL stop for a long option the Charts tab just bought.
 *
 * F&O no longer accepts SL-M, so this is a stop-loss LIMIT with the limit 10%
 * under the trigger — the same shape the order proxy uses for a long option
 * stop. Tagged PALAGAI_CHART_SL so it is never mistaken for a desk stop.
 */
export function atmStopFields(
  ticket: AtmProtectiveTicket,
  triggerPremium: number,
  tickSize = 0.05,
): Record<string, string> | null {
  const tick = tickSize > 0 ? tickSize : 0.05;
  const trig = roundToTick(Number(triggerPremium), tick);
  if (!(trig > 0) || trig >= 1e9) return null;
  const limit = roundToTick(Math.max(tick, trig * 0.9), tick);
  return {
    exchange: ticket.exchange,
    tradingsymbol: ticket.tradingSymbol,
    transaction_type: 'SELL',
    order_type: 'SL',
    quantity: String(ticket.quantity),
    product: ticket.product,
    validity: 'DAY',
    trigger_price: trig.toFixed(2),
    price: limit.toFixed(2),
    tag: 'PALAGAI_CHART_SL',
  };
}

/**
 * LIMIT SELL to book the Charts auto-bot 0.5R. Tagged PALAGAI_CHART_TP so it
 * is never mistaken for a desk target. Kite has no OCO on regular orders —
 * if this fills, the SL must be cancelled in the order book.
 */
export function atmTargetFields(
  ticket: AtmProtectiveTicket,
  targetPremium: number,
  tickSize = 0.05,
): Record<string, string> | null {
  const tick = tickSize > 0 ? tickSize : 0.05;
  const price = roundToTick(Number(targetPremium), tick);
  if (!(price > 0) || price >= 1e9) return null;
  return {
    exchange: ticket.exchange,
    tradingsymbol: ticket.tradingSymbol,
    transaction_type: 'SELL',
    order_type: 'LIMIT',
    quantity: String(ticket.quantity),
    product: ticket.product,
    validity: 'DAY',
    price: price.toFixed(2),
    tag: 'PALAGAI_CHART_TP',
  };
}

/** Rupees one point of premium moves this ticket. Crude is not order quantity. */
export function atmRupeePerPoint(ticket: Pick<AtmOrderTicket, 'unitsPerLot' | 'lots'>): number {
  return ticket.unitsPerLot * ticket.lots;
}

/** Enough of a ticket to rest or move a Charts SL / TP on an already-open fill. */
export function atmProtectiveTicketFromFill(trade: {
  instrument: string;
  exchange?: string;
  qty: number;
}): AtmProtectiveTicket | null {
  const qty = Math.floor(Number(trade.qty));
  const symbol = String(trade.instrument || '').trim();
  if (!(qty > 0) || !symbol) return null;
  const crude = /crude/i.test(symbol);
  return {
    exchange: trade.exchange === 'MCX' || crude ? 'MCX' : 'NFO',
    tradingSymbol: symbol,
    quantity: qty,
    product: 'MIS',
  };
}

/**
 * MARKET SELL to flatten a Charts ATM that hit a rupee cap. Tagged so the
 * live board can mark it EXITED and the desk never counts it.
 */
export function atmExitFields(trade: {
  instrument: string;
  exchange?: string;
  qty: number;
}): Record<string, string> | null {
  const qty = Math.floor(Number(trade.qty));
  const symbol = String(trade.instrument || '').trim();
  if (!(qty > 0) || !symbol) return null;
  const crude = /crude/i.test(symbol);
  return {
    exchange: trade.exchange || (crude ? 'MCX' : 'NFO'),
    tradingsymbol: symbol,
    transaction_type: 'SELL',
    order_type: 'MARKET',
    quantity: String(qty),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: CHART_EXIT_TAG,
  };
}

function roundToTick(value: number, tick: number): number {
  return Math.round(value / tick) * tick;
}

/** Rupee cost of the position at a given premium, for the confirmation step. */
export function atmOrderCost(ticket: AtmOrderTicket, premium: number): number | null {
  if (!Number.isFinite(premium) || premium <= 0) {
    return null;
  }
  return premium * ticket.unitsPerLot * ticket.lots;
}

/** `NFO:NIFTY25SEP24500CE` — the key Kite's quote endpoint expects. */
export function atmQuoteKey(ticket: AtmOrderTicket): string {
  return `${ticket.exchange}:${ticket.tradingSymbol}`;
}

function lotUnits(option: Instrument): number {
  return Math.max(1, Math.floor(Number(option.lotSize) || 0) || 1);
}

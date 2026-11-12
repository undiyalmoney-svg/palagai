/**
 * Paper-desk live Kite tickets. Off until Live Kite radio is on AND that
 * book's checkbox is ticked. Crude Mini order qty is 1, never CSV lot 10.
 */

export const PAPER_LIVE_BUY_TAG = 'PALAGAI_PAPER';
export const PAPER_LIVE_SL_TAG = 'PALAGAI_PAPER_SL';
export const PAPER_LIVE_EXIT_TAG = 'PALAGAI_PAPER_X';

export const PAPER_LIVE_UNDERS = ['nifty', 'bank', 'sensex', 'crude'] as const;
export type PaperLiveUnder = (typeof PAPER_LIVE_UNDERS)[number];

export type PaperLiveBooks = Record<PaperLiveUnder, boolean>;

export function emptyPaperLiveBooks(): PaperLiveBooks {
  return { nifty: false, bank: false, sensex: false, crude: false };
}

/** Desk-wide: Live radio on and at least one book ticked. */
export function paperLiveArmed(live: boolean, books: PaperLiveBooks): boolean {
  return !!live && PAPER_LIVE_UNDERS.some((u) => !!books[u]);
}

/** This book sends a Kite order only when Live is on and its checkbox is ticked. */
export function paperLiveArmedFor(live: boolean, books: PaperLiveBooks, under: string): boolean {
  return !!live && !!books[under as PaperLiveUnder];
}

export type PaperKiteOverlay = {
  kiteBuyOrderId?: string;
  kiteSlOrderId?: string;
  kiteNote?: string;
};

/**
 * Paper side/fills/closed ₹ stay. Live Kite may only stamp order ids and a note.
 * A Kite reject or throw must not drop the paper fill.
 */
export function keepPaperOnKite<T extends PaperKiteOverlay>(paper: T, kite: PaperKiteOverlay): T {
  return {
    ...paper,
    kiteBuyOrderId: kite.kiteBuyOrderId ?? paper.kiteBuyOrderId,
    kiteSlOrderId: kite.kiteSlOrderId ?? paper.kiteSlOrderId,
    kiteNote: kite.kiteNote ?? paper.kiteNote,
  };
}

/** Run Live Kite after paper. A throw stamps a note; paper fills stay. */
export async function overlayPaperWithKite<T extends PaperKiteOverlay>(
  paper: T,
  kiteFn: () => Promise<PaperKiteOverlay>,
  noteOf: (err: unknown) => string,
): Promise<T> {
  try {
    return keepPaperOnKite(paper, await kiteFn());
  } catch (err) {
    return keepPaperOnKite(paper, { kiteNote: noteOf(err) });
  }
}

export function paperLiveExchange(under: string): 'NFO' | 'BFO' | 'MCX' {
  if (under === 'crude') return 'MCX';
  if (under === 'sensex') return 'BFO';
  return 'NFO';
}

/** Kite `quantity`. Crude Mini options are 1 contract per lot; index options use the lot. */
export function paperLiveQuantity(under: string, lot: number): number {
  if (under === 'crude') return 1;
  const n = Math.floor(Number(lot) || 0);
  return n > 0 ? n : 1;
}

export type PaperLiveTicket = {
  under: string;
  optionSymbol: string;
  optionToken: number;
  lot: number;
};

export function paperLiveBuyFields(ticket: PaperLiveTicket): Record<string, string> | null {
  if (!(ticket.optionToken > 0) || !String(ticket.optionSymbol || '').trim()) return null;
  return {
    exchange: paperLiveExchange(ticket.under),
    tradingsymbol: ticket.optionSymbol,
    transaction_type: 'BUY',
    order_type: 'MARKET',
    quantity: String(paperLiveQuantity(ticket.under, ticket.lot)),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: PAPER_LIVE_BUY_TAG,
  };
}

/**
 * Resting SELL stop. F&O no longer accepts SL-M, so this is SL LIMIT 10% under
 * the trigger — same shape as the Charts protective stop.
 */
export function paperLiveStopFields(
  ticket: PaperLiveTicket,
  triggerPremium: number,
  tickSize = 0.05,
): Record<string, string> | null {
  if (!(ticket.optionToken > 0) || !String(ticket.optionSymbol || '').trim()) return null;
  const tick = tickSize > 0 ? tickSize : 0.05;
  const trig = roundToTick(Number(triggerPremium), tick);
  if (!(trig > 0) || trig >= 1e9) return null;
  const limit = roundToTick(Math.max(tick, trig * 0.9), tick);
  return {
    exchange: paperLiveExchange(ticket.under),
    tradingsymbol: ticket.optionSymbol,
    transaction_type: 'SELL',
    order_type: 'SL',
    quantity: String(paperLiveQuantity(ticket.under, ticket.lot)),
    product: 'MIS',
    validity: 'DAY',
    trigger_price: trig.toFixed(2),
    price: limit.toFixed(2),
    tag: PAPER_LIVE_SL_TAG,
  };
}

export function paperLiveExitFields(ticket: PaperLiveTicket): Record<string, string> | null {
  if (!(ticket.optionToken > 0) || !String(ticket.optionSymbol || '').trim()) return null;
  return {
    exchange: paperLiveExchange(ticket.under),
    tradingsymbol: ticket.optionSymbol,
    transaction_type: 'SELL',
    order_type: 'MARKET',
    quantity: String(paperLiveQuantity(ticket.under, ticket.lot)),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: PAPER_LIVE_EXIT_TAG,
  };
}

export function kiteOrderIdOf(res: unknown): string | null {
  const id = (res as { data?: { order_id?: string | number } } | null)?.data?.order_id;
  const s = id != null ? String(id).trim() : '';
  return s || null;
}

export function kiteOrderErrorOf(error: unknown): string {
  const body = (error as { error?: { message?: string }; message?: string } | null)?.error;
  if (body?.message) return body.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Order failed. Check the Kite order book before retrying.';
}

function roundToTick(value: number, tick: number): number {
  return Math.round(value / tick) * tick;
}

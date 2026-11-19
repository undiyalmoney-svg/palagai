/** Live Kite tickets for 5-Minute Sniper. Off until Live is confirmed. Paper fills stay on a reject. */

export const SNIPER_BUY_TAG = 'PALAGAI_SNIPER';
export const SNIPER_SL_TAG = 'PALAGAI_SNIPER_SL';
export const SNIPER_EXIT_TAG = 'PALAGAI_SNIPER_X';
export const SNIPER_SL_LIMIT_SLIP_RS = 20;

export function sniperExchange(under: string): 'NFO' | 'BFO' | 'MCX' {
  if (under === 'crude') return 'MCX';
  if (under === 'sensex') return 'BFO';
  return 'NFO';
}

function roundToTick(value: number, tick: number): number {
  const t = tick > 0 ? tick : 0.05;
  return Math.round(value / t) * t;
}

export function sniperQuantity(qty: number): number {
  const n = Math.floor(Number(qty) || 0);
  return n > 0 ? n : 0;
}

export type SniperTicket = {
  under: string;
  optionSymbol: string;
  optionToken: number;
  qty: number;
};

function ticketOk(t: SniperTicket): boolean {
  return !!(t && Number(t.optionToken) > 0 && String(t.optionSymbol || '').trim() && sniperQuantity(t.qty) > 0);
}

export function sniperBuyFields(t: SniperTicket): Record<string, string> | null {
  if (!ticketOk(t)) return null;
  return {
    exchange: sniperExchange(t.under),
    tradingsymbol: t.optionSymbol,
    transaction_type: 'BUY',
    order_type: 'MARKET',
    quantity: String(sniperQuantity(t.qty)),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: SNIPER_BUY_TAG,
  };
}

export function sniperSlLimitPx(trigger: number, qty: number, tick = 0.05): number {
  const t = tick > 0 ? tick : 0.05;
  const trig = roundToTick(Number(trigger), t);
  const n = Math.max(1, sniperQuantity(qty) || 1);
  return roundToTick(Math.max(t, trig - SNIPER_SL_LIMIT_SLIP_RS / n), t);
}

export function sniperStopFields(t: SniperTicket, trigger: number): Record<string, string> | null {
  if (!ticketOk(t)) return null;
  const trig = roundToTick(Number(trigger), 0.05);
  if (!(trig > 0)) return null;
  const exchange = sniperExchange(t.under);
  const qty = String(sniperQuantity(t.qty));
  if (exchange === 'MCX') {
    return {
      exchange,
      tradingsymbol: t.optionSymbol,
      transaction_type: 'SELL',
      order_type: 'SL',
      quantity: qty,
      product: 'MIS',
      validity: 'DAY',
      trigger_price: trig.toFixed(2),
      price: sniperSlLimitPx(trig, t.qty).toFixed(2),
      tag: SNIPER_SL_TAG,
    };
  }
  return {
    exchange,
    tradingsymbol: t.optionSymbol,
    transaction_type: 'SELL',
    order_type: 'SL',
    quantity: qty,
    product: 'MIS',
    validity: 'DAY',
    trigger_price: trig.toFixed(2),
    price: sniperSlLimitPx(trig, t.qty).toFixed(2),
    tag: SNIPER_SL_TAG,
  };
}

export function sniperExitFields(t: SniperTicket): Record<string, string> | null {
  if (!ticketOk(t)) return null;
  return {
    exchange: sniperExchange(t.under),
    tradingsymbol: t.optionSymbol,
    transaction_type: 'SELL',
    order_type: 'MARKET',
    quantity: String(sniperQuantity(t.qty)),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: SNIPER_EXIT_TAG,
  };
}

export function sniperBuyPlaced(book: { kiteBuyOrderId?: string }): boolean {
  return !!String(book.kiteBuyOrderId || '').trim();
}

const DEAD = new Set(['REJECTED', 'CANCELLED', 'EXPIRED']);

export function sniperOrderDead(status: string | undefined | null): boolean {
  return DEAD.has(String(status || '').trim().toUpperCase());
}

export function sniperOpenBuyId(
  orders: Array<{ order_id?: string | number; tradingsymbol?: string; transaction_type?: string; tag?: string; status?: string }>,
  symbol: string,
): string | null {
  const want = String(symbol || '').trim().toUpperCase();
  if (!want) return null;
  for (const o of orders) {
    if (String(o.tradingsymbol || '').trim().toUpperCase() !== want) continue;
    if (String(o.transaction_type || '').toUpperCase() !== 'BUY') continue;
    if (String(o.tag || '').toUpperCase() !== SNIPER_BUY_TAG) continue;
    if (sniperOrderDead(o.status)) continue;
    const id = o.order_id != null ? String(o.order_id).trim() : '';
    if (id) return id;
  }
  return null;
}

export function kiteOrderIdOf(res: unknown): string {
  const o = res as { data?: { order_id?: string | number }; order_id?: string | number };
  const id = o?.data?.order_id ?? o?.order_id;
  return id != null ? String(id).trim() : '';
}

export function kiteOrderErrorOf(err: unknown): string {
  const e = err as { error?: { message?: string }; message?: string };
  return String(e?.error?.message || e?.message || err || 'Kite error');
}

export function keepSniperOnKite<T extends { kiteBuyOrderId?: string; kiteSlOrderId?: string; kiteNote?: string; kiteHalt?: boolean }>(
  paper: T,
  kite: { kiteBuyOrderId?: string; kiteSlOrderId?: string; kiteNote?: string; kiteHalt?: boolean },
): T {
  return {
    ...paper,
    kiteBuyOrderId: kite.kiteBuyOrderId ?? paper.kiteBuyOrderId,
    kiteSlOrderId: kite.kiteSlOrderId ?? paper.kiteSlOrderId,
    kiteNote: kite.kiteNote ?? paper.kiteNote,
    kiteHalt: kite.kiteHalt ?? paper.kiteHalt,
  };
}

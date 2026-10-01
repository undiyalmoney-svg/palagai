/**
 * Live Charts ATM trades — instrument, stop and target.
 *
 * Built from the day's Kite order book using the PALAGAI_CHART tags the
 * Charts tab stamps on the market buy, the protective SL and the 0.5R target.
 */
import { CHART_BOOKS, ChartBookId } from './live-chart-data.service';

export const CHART_ENTRY_TAG = 'PALAGAI_CHART';
export const CHART_SL_TAG = 'PALAGAI_CHART_SL';
export const CHART_TP_TAG = 'PALAGAI_CHART_TP';
export const CHART_EXIT_TAG = 'PALAGAI_CHART_EXIT';

export type ChartLiveStatus = 'OPEN' | 'SL_HIT' | 'TP_HIT' | 'EXITED' | 'WORKING';

export const TRADE_STATUS_LABELS: Record<ChartLiveStatus, string> = {
  OPEN: 'Open',
  WORKING: 'Working',
  SL_HIT: 'Stop hit',
  TP_HIT: 'Target hit',
  EXITED: 'Exited',
};

export interface KiteOrderLike {
  order_id?: string | number;
  tradingsymbol?: string;
  exchange?: string;
  transaction_type?: string;
  status?: string;
  quantity?: number | string;
  filled_quantity?: number | string;
  price?: number | string;
  trigger_price?: number | string;
  average_price?: number | string;
  tag?: string;
  product?: string;
  order_type?: string;
  order_timestamp?: string;
}

export interface KitePositionLike {
  tradingsymbol?: string;
  exchange?: string;
  product?: string;
  quantity?: number | string;
  average_price?: number | string;
  last_price?: number | string;
  pnl?: number | string;
  /** Unrealized P&L of the open qty — this is the per-trade figure. */
  unrealised?: number | string;
  unrealized?: number | string;
  realised?: number | string;
  realized?: number | string;
}

export interface ChartLiveTrade {
  id: string;
  book: ChartBookId | null;
  bookLabel: string;
  instrument: string;
  exchange: string;
  side: 'CE' | 'PE' | null;
  qty: number;
  entry: number | null;
  last: number | null;
  sl: number | null;
  tp: number | null;
  slState: string;
  tpState: string;
  slOrderId: string | null;
  tpOrderId: string | null;
  /** Every resting Charts SL/TP on this fill — flatten cancels all of them. */
  protectiveOrderIds: string[];
  status: ChartLiveStatus;
  pnl: number | null;
}

export function isChartOrderTag(tag: string | undefined | null): boolean {
  const t = String(tag || '').toUpperCase();
  return (
    t === CHART_ENTRY_TAG || t === CHART_SL_TAG || t === CHART_TP_TAG || t === CHART_EXIT_TAG
  );
}

export function bookFromInstrument(symbol: string): ChartBookId | null {
  const s = symbol.toUpperCase();
  if (s.includes('BANKNIFTY') || s.includes('BANKEX')) return 'bank';
  if (s.includes('CRUDE')) return 'crude';
  if (s.startsWith('NIFTY')) return 'nifty';
  return null;
}

export function sideFromInstrument(symbol: string): 'CE' | 'PE' | null {
  const s = symbol.toUpperCase();
  if (s.endsWith('CE')) return 'CE';
  if (s.endsWith('PE')) return 'PE';
  return null;
}

export function buildChartLiveTrades(
  orders: KiteOrderLike[],
  positions: KitePositionLike[] = [],
): ChartLiveTrade[] {
  const grouped = new Map<string, KiteOrderLike[]>();
  for (const order of orders) {
    if (!isChartOrderTag(order.tag)) continue;
    const symbol = String(order.tradingsymbol || '').trim();
    if (!symbol) continue;
    const list = grouped.get(symbol) ?? [];
    list.push(order);
    grouped.set(symbol, list);
  }

  const posBySymbol = new Map<string, KitePositionLike>();
  for (const pos of positions) {
    const symbol = String(pos.tradingsymbol || '').trim();
    if (!symbol) continue;
    const product = String(pos.product || '').toUpperCase();
    if (product && product !== 'MIS') continue;
    const existing = posBySymbol.get(symbol);
    if (!existing || Math.abs(num(pos.quantity)) > Math.abs(num(existing.quantity))) {
      posBySymbol.set(symbol, pos);
    }
  }

  const trades: ChartLiveTrade[] = [];
  for (const [instrument, raw] of grouped) {
    const list = [...raw].sort(compareOrders);
    const entry = latest(list, (o) => tagOf(o) === CHART_ENTRY_TAG && sideOf(o) === 'BUY');
    const fill = ordersForFill(list, entry);
    const slOrder = latest(fill, (o) => tagOf(o) === CHART_SL_TAG);
    const tpOrder = latest(fill, (o) => tagOf(o) === CHART_TP_TAG);
    const exitOrder = latest(fill, (o) => tagOf(o) === CHART_EXIT_TAG && sideOf(o) === 'SELL');
    const pos = posBySymbol.get(instrument);
    const posQty = pos ? Math.abs(num(pos.quantity)) : 0;
    const slHit = isComplete(slOrder);
    const tpHit = isComplete(tpOrder);
    const protectiveResting = isOpenish(slOrder) || isOpenish(tpOrder);
    const qty = posQty > 0 ? posQty : filledQty(entry);
    const entryPx = avgPrice(entry) || (pos ? num(pos.average_price) : 0) || null;
    const last = pos ? num(pos.last_price) || null : null;
    const sl = triggerOrPrice(slOrder);
    const tp = limitOrPrice(tpOrder);
    let status: ChartLiveStatus = 'WORKING';
    if (posQty > 0) status = 'OPEN';
    else if (tpHit) status = 'TP_HIT';
    else if (slHit) status = 'SL_HIT';
    else if (isComplete(exitOrder)) status = 'EXITED';
    else if (isComplete(entry) && (protectiveResting || !pos)) status = 'OPEN';
    else if (isComplete(entry)) status = 'EXITED';
    const computed =
      status === 'OPEN' && last != null && entryPx != null ? (last - entryPx) * qty : NaN;
    const pnl = openFillPnl(pos, status, computed);
    const book = bookFromInstrument(instrument);
    trades.push({
      id: `${instrument}:${entry?.order_id ?? slOrder?.order_id ?? tpOrder?.order_id ?? instrument}`,
      book,
      bookLabel: CHART_BOOKS.find((b) => b.id === book)?.label ?? instrument,
      instrument,
      exchange: String(entry?.exchange || slOrder?.exchange || tpOrder?.exchange || ''),
      side: sideFromInstrument(instrument),
      qty,
      entry: entryPx,
      last,
      sl,
      tp,
      slState: orderState(slOrder),
      tpState: orderState(tpOrder),
      slOrderId: restingOrderId(slOrder),
      tpOrderId: restingOrderId(tpOrder),
      protectiveOrderIds: restingProtectiveIds(fill),
      status,
      pnl: Number.isFinite(pnl as number) ? (pnl as number) : null,
    });
  }

  return sortTrades(trades);
}

/** Optimistic row shown the moment Buy / Sell / Auto sends, before Kite catches up. */
export function localChartTrade(input: {
  book: ChartBookId;
  instrument: string;
  exchange: string;
  side: 'CE' | 'PE';
  qty: number;
  entry: number | null;
  sl: number | null;
  tp: number | null;
}): ChartLiveTrade {
  return {
    id: `local:${input.instrument}`,
    book: input.book,
    bookLabel: CHART_BOOKS.find((b) => b.id === input.book)?.label ?? input.book,
    instrument: input.instrument,
    exchange: input.exchange,
    side: input.side,
    qty: input.qty,
    entry: input.entry,
    last: input.entry,
    sl: input.sl,
    tp: input.tp,
    slState: input.sl != null ? 'RESTING' : '—',
    tpState: input.tp != null ? 'RESTING' : '—',
    slOrderId: null,
    tpOrderId: null,
    protectiveOrderIds: [],
    status: 'OPEN',
    pnl: null,
  };
}

/** Kite rows win on the same instrument; unconfirmed local rows stay until then. */
export function mergeChartLiveTrades(
  remote: ChartLiveTrade[],
  pending: ChartLiveTrade[],
): ChartLiveTrade[] {
  const seen = new Set(remote.map((t) => t.instrument));
  const extras = pending.filter((t) => !seen.has(t.instrument));
  return sortTrades([...remote, ...extras]);
}

function tagOf(order: KiteOrderLike): string {
  return String(order.tag || '').toUpperCase();
}

function sideOf(order: KiteOrderLike): string {
  return String(order.transaction_type || '').toUpperCase();
}

function latest(list: KiteOrderLike[], pred: (o: KiteOrderLike) => boolean): KiteOrderLike | undefined {
  const hits = list.filter(pred);
  if (!hits.length) return undefined;
  return hits.reduce((best, order) => (compareOrders(order, best) > 0 ? order : best));
}

/** SL / TP / EXIT that belong to this fill, not an earlier flattened one. */
function ordersForFill(list: KiteOrderLike[], entry: KiteOrderLike | undefined): KiteOrderLike[] {
  if (!entry) return list;
  return list.filter((order) => order === entry || compareOrders(order, entry) >= 0);
}

function compareOrders(a: KiteOrderLike, b: KiteOrderLike): number {
  const ta = orderMs(a);
  const tb = orderMs(b);
  if (ta !== tb) return ta - tb;
  return String(a.order_id ?? '').localeCompare(String(b.order_id ?? ''), undefined, {
    numeric: true,
  });
}

function orderMs(order: KiteOrderLike): number {
  const t = Date.parse(String(order.order_timestamp || ''));
  return Number.isFinite(t) ? t : 0;
}

function restingProtectiveIds(list: KiteOrderLike[]): string[] {
  const ids: string[] = [];
  for (const order of list) {
    const tag = tagOf(order);
    if (tag !== CHART_SL_TAG && tag !== CHART_TP_TAG) continue;
    const id = restingOrderId(order);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Resting SELL ids that lock this contract's quantity at Kite.
 * Flatten must cancel these before a MARKET exit; a second SELL while an SL
 * is live is rejected with the qty still held by the stop.
 */
export function restingSellOrderIds(
  orders: KiteOrderLike[],
  instrument: string,
  opts: { chartTaggedOnly?: boolean } = {},
): string[] {
  const symbol = String(instrument || '').trim().toUpperCase();
  if (!symbol) return [];
  const ids: string[] = [];
  for (const order of orders) {
    if (String(order.tradingsymbol || '').trim().toUpperCase() !== symbol) continue;
    if (sideOf(order) !== 'SELL') continue;
    if (!isOpenish(order)) continue;
    const product = String(order.product || 'MIS').toUpperCase();
    if (product && product !== 'MIS') continue;
    if (opts.chartTaggedOnly) {
      const tag = tagOf(order);
      if (tag !== CHART_SL_TAG && tag !== CHART_TP_TAG) continue;
    }
    const id = String(order.order_id ?? '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function isComplete(order: KiteOrderLike | undefined): boolean {
  return String(order?.status || '').toUpperCase() === 'COMPLETE';
}

function isOpenish(order: KiteOrderLike | undefined): boolean {
  const st = String(order?.status || '').toUpperCase();
  return st === 'OPEN' || st === 'TRIGGER PENDING' || st === 'VALIDATION PENDING';
}

function orderState(order: KiteOrderLike | undefined): string {
  if (!order) return '—';
  if (isComplete(order)) return 'HIT';
  if (isOpenish(order)) return 'RESTING';
  const st = String(order.status || '').toUpperCase();
  if (st === 'CANCELLED') return 'CANCELLED';
  if (st === 'REJECTED') return 'REJECTED';
  return st || '—';
}

function restingOrderId(order: KiteOrderLike | undefined): string | null {
  if (!order || !isOpenish(order)) return null;
  const id = String(order.order_id ?? '').trim();
  return id || null;
}

/**
 * P&L of the open fill only. Kite's `pnl` is the day's total for that
 * contract (realised + unrealised), which would turn a per-trade cap into a
 * day stop — so an open row uses `unrealised`, then (last − entry) × qty,
 * and never the day's net. Closed rows may still show Kite's day `pnl`.
 */
export function openFillPnl(
  pos: KitePositionLike | undefined,
  status: ChartLiveStatus,
  computed: number,
): number | null {
  if (status === 'OPEN') {
    const unreal = firstFinite(pos?.unrealised, pos?.unrealized);
    if (unreal != null) return unreal;
    return Number.isFinite(computed) ? computed : null;
  }
  const closed = firstFinite(pos?.pnl);
  return closed ?? (Number.isFinite(computed) ? computed : null);
}

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function filledQty(order: KiteOrderLike | undefined): number {
  if (!order) return 0;
  return Math.abs(num(order.filled_quantity) || num(order.quantity));
}

function avgPrice(order: KiteOrderLike | undefined): number {
  return order ? num(order.average_price) : 0;
}

function triggerOrPrice(order: KiteOrderLike | undefined): number | null {
  if (!order) return null;
  return num(order.trigger_price) || num(order.price) || null;
}

function limitOrPrice(order: KiteOrderLike | undefined): number | null {
  if (!order) return null;
  return num(order.price) || num(order.trigger_price) || null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rank(status: ChartLiveStatus): number {
  if (status === 'OPEN' || status === 'WORKING') return 0;
  return 1;
}

function sortTrades(trades: ChartLiveTrade[]): ChartLiveTrade[] {
  return trades.sort(
    (a, b) => rank(a.status) - rank(b.status) || a.bookLabel.localeCompare(b.bookLabel),
  );
}

export function extractKiteOrders(payload: unknown): KiteOrderLike[] {
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as KiteOrderLike[]) : [];
}

export function extractKitePositions(payload: unknown): KitePositionLike[] {
  const data = (payload as { data?: { net?: KitePositionLike[]; day?: KitePositionLike[] } } | null)?.data;
  if (!data) return [];
  const day = Array.isArray(data.day) ? data.day : [];
  const net = Array.isArray(data.net) ? data.net : [];
  return day.length ? day : net;
}

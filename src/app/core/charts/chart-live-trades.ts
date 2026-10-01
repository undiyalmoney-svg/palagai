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
  status: ChartLiveStatus;
  pnl: number | null;
}

export function isChartOrderTag(tag: string | undefined | null): boolean {
  const t = String(tag || '').toUpperCase();
  return t === CHART_ENTRY_TAG || t === CHART_SL_TAG || t === CHART_TP_TAG;
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
  for (const [instrument, list] of grouped) {
    const entry = latest(list, (o) => tagOf(o) === CHART_ENTRY_TAG && sideOf(o) === 'BUY');
    const slOrder = latest(list, (o) => tagOf(o) === CHART_SL_TAG);
    const tpOrder = latest(list, (o) => tagOf(o) === CHART_TP_TAG);
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
    else if (isComplete(entry) && (protectiveResting || !pos)) status = 'OPEN';
    else if (isComplete(entry)) status = 'EXITED';
    const pnl =
      status === 'OPEN' && last != null && entryPx != null
        ? (last - entryPx) * qty
        : num(pos?.pnl) || null;
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
  return hits.length ? hits[hits.length - 1] : undefined;
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

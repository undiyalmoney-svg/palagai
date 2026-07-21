/**
 * Stocks Desk live money:
 * 1) MARKET entry (BUY or SELL MIS)
 * 2) Protective opposite SL-M at DNA stop
 * 3) App monitors LTP → cancel SL + MARKET exit on target / soft SL / EOD
 * 4) On restart → reconcile open NSE MIS (+ place missing SL)
 */
import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { InstrumentStoreService } from '../services/instrument-store.service';
import { extractKiteApiError } from '../utils/kite-error.util';
import {
  stockLevelsFromEntry,
  StocksStrategyId,
} from '../strategy-engine/strategies/stocks-equity/stocks-equity.evaluator';

export const STOCKS_ENTRY_TAG = 'PALAGAI_EQ';
export const STOCKS_SL_TAG = 'PALAGAI_EQ_SL';
export const STOCKS_EXIT_TAG = 'PALAGAI_EQ_X';
/** Square off before broker MIS auto-close */
export const STOCKS_EOD_EXIT_HHMM = 15 * 60 + 15; // 15:15 IST

export interface StocksLiveLeg {
  symbol: string;
  direction: 'BUY' | 'SELL';
  qty: number;
  entry: number;
  stop: number;
  target: number | null;
  entryOrderId: string | null;
  slOrderId: string | null;
  exitOrderId: string | null;
  status: 'open' | 'flat' | 'error';
  lastError: string | null;
  exitReason: string | null;
  adopted: boolean;
  strategyId: StocksStrategyId;
}

export interface StocksLiveEvent {
  at: string;
  symbol: string;
  action: 'ENTRY' | 'SL' | 'CANCEL_SL' | 'EXIT' | 'ADOPT' | 'SKIP' | 'ERROR';
  detail: string;
  orderId?: string;
}

interface KiteOrderResponse {
  status?: string;
  message?: string;
  data?: { order_id?: string };
  error_type?: string;
}

interface KiteOrderRow {
  order_id?: string;
  status?: string;
  average_price?: number;
  trigger_price?: number;
  tradingsymbol?: string;
  exchange?: string;
  transaction_type?: string;
  order_type?: string;
  product?: string;
  quantity?: number;
  filled_quantity?: number;
  pending_quantity?: number;
  tag?: string;
}

interface KiteOrdersBook {
  status?: string;
  data?: KiteOrderRow[];
}

interface KitePositionRow {
  tradingsymbol?: string;
  exchange?: string;
  instrument_token?: number;
  product?: string;
  quantity?: number;
  average_price?: number;
  last_price?: number;
  overnight_quantity?: number;
  day_buy_quantity?: number;
  day_sell_quantity?: number;
}

interface KitePositionsBook {
  status?: string;
  data?: { net?: KitePositionRow[]; day?: KitePositionRow[] };
}

interface KiteQuoteBook {
  status?: string;
  data?: Record<string, { last_price?: number; instrument_token?: number }>;
}

@Injectable({ providedIn: 'root' })
export class StocksLiveExecutorService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly instruments = inject(InstrumentStoreService);

  private readonly legs = new Map<string, StocksLiveLeg>();
  private readonly events: StocksLiveEvent[] = [];

  reset(): void {
    this.legs.clear();
    this.events.length = 0;
  }

  getLegs(): StocksLiveLeg[] {
    return [...this.legs.values()];
  }

  getOpenLegs(): StocksLiveLeg[] {
    return this.getLegs().filter((l) => l.status === 'open');
  }

  getEvents(): StocksLiveEvent[] {
    return [...this.events];
  }

  /**
   * On Live start: find open NSE MIS equity, adopt Palagai (or watchlist) legs,
   * exit if already past SL/TP, else ensure protective SL-M exists.
   */
  async reconcileOnStart(params: {
    authorization: string;
    strategyId: StocksStrategyId;
    /** Symbols we care about even without PALAGAI tag (watchlist + signals). */
    interestSymbols: string[];
  }): Promise<string> {
    const interest = new Set(params.interestSymbols.map((s) => s.toUpperCase()));
    const book = (await firstValueFrom(
      this.kiteApi.getPositions(params.authorization),
    )) as KitePositionsBook;
    const rows = [...(book.data?.net ?? []), ...(book.data?.day ?? [])];
    const bySym = new Map<string, KitePositionRow>();
    for (const row of rows) {
      if ((row.exchange ?? '').toUpperCase() !== 'NSE') continue;
      if ((row.product ?? '').toUpperCase() !== 'MIS') continue;
      const qty = Number(row.quantity ?? 0);
      if (!qty) continue;
      const sym = (row.tradingsymbol ?? '').toUpperCase();
      if (!sym) continue;
      bySym.set(sym, row);
    }

    const orders = await this.fetchOrders(params.authorization);
    let adopted = 0;
    let slPlaced = 0;
    let exited = 0;

    for (const [symbol, row] of bySym) {
      const tagged = orders.some(
        (o) =>
          (o.tradingsymbol ?? '').toUpperCase() === symbol &&
          isPalagaiEqTag(o.tag) &&
          isFilledOrWorking(o.status),
      );
      if (!tagged && !interest.has(symbol)) {
        continue;
      }

      const qty = Math.abs(Number(row.quantity ?? 0));
      if (qty < 1) continue;
      const direction: 'BUY' | 'SELL' = Number(row.quantity) > 0 ? 'BUY' : 'SELL';
      const entry =
        Number(row.average_price ?? 0) > 0
          ? Number(row.average_price)
          : Number(row.last_price ?? 0);
      if (entry <= 0) continue;

      const levels = stockLevelsFromEntry(direction, entry, params.strategyId);
      const pendingSl = findPendingSl(orders, symbol, direction);

      const leg: StocksLiveLeg = {
        symbol,
        direction,
        qty,
        entry,
        stop: levels.stop,
        target: levels.target,
        entryOrderId: null,
        slOrderId: pendingSl?.order_id ?? null,
        exitOrderId: null,
        status: 'open',
        lastError: null,
        exitReason: null,
        adopted: true,
        strategyId: params.strategyId,
      };
      this.legs.set(symbol, leg);
      adopted += 1;
      this.pushEvent({
        at: nowIso(),
        symbol,
        action: 'ADOPT',
        detail: `Adopted open MIS ${direction} ${qty} @ ~${entry.toFixed(2)} · SL ${levels.stop.toFixed(2)}${
          levels.target != null ? ` · TP ${levels.target.toFixed(2)}` : ''
        }`,
        orderId: pendingSl?.order_id,
      });

      const ltp = await this.ltp(params.authorization, symbol, Number(row.last_price ?? 0));
      const hit = evaluateExit(leg, ltp, istMinutesNow());
      if (hit) {
        await this.placeExit(params.authorization, leg, hit.reason);
        exited += 1;
        continue;
      }

      if (!leg.slOrderId) {
        const ok = await this.placeProtectiveSl(params.authorization, leg);
        if (ok) slPlaced += 1;
      }
    }

    return `Reconcile · adopted ${adopted} · SL placed ${slPlaced} · exited ${exited}`;
  }

  /**
   * Enter missing signal legs; manage open legs (SL fill / TP / soft SL / EOD).
   * Does not flatten just because a name dropped out of the movers list.
   */
  async syncDesired(params: {
    authorization: string;
    strategyId: StocksStrategyId;
    desired: Array<{
      symbol: string;
      direction: 'BUY' | 'SELL';
      qty: number;
      entry: number;
      stop: number;
      target?: number | null;
    }>;
  }): Promise<void> {
    const auth = params.authorization;

    // Manage existing open legs first
    for (const leg of this.getOpenLegs()) {
      const slState = await this.refreshSlState(auth, leg);
      if (slState === 'filled') continue;

      const ltp = await this.ltp(auth, leg.symbol, 0);
      const hit = evaluateExit(leg, ltp, istMinutesNow());
      if (hit) {
        await this.placeExit(auth, leg, hit.reason);
        continue;
      }

      if (!leg.slOrderId) {
        await this.placeProtectiveSl(auth, leg);
      }
    }

    // New entries from today's signals
    for (const d of params.desired) {
      const symbol = d.symbol.toUpperCase();
      const existing = this.legs.get(symbol);
      if (existing?.status === 'open') continue;
      if (existing?.status === 'flat') continue; // already managed / exited this session

      const levels = stockLevelsFromEntry(d.direction, d.entry, params.strategyId);
      const stop = d.stop > 0 ? d.stop : levels.stop;
      const target = d.target !== undefined ? d.target : levels.target;

      await this.placeEntry(auth, {
        symbol,
        direction: d.direction,
        qty: d.qty,
        entryHint: d.entry,
        stop,
        target,
        strategyId: params.strategyId,
      });
    }
  }

  private async placeEntry(
    authorization: string,
    params: {
      symbol: string;
      direction: 'BUY' | 'SELL';
      qty: number;
      entryHint: number;
      stop: number;
      target: number | null;
      strategyId: StocksStrategyId;
    },
  ): Promise<void> {
    const { symbol, direction, qty } = params;
    if (qty < 1) return;

    try {
      const response = await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: 'NSE',
          tradingsymbol: symbol,
          transaction_type: direction,
          order_type: 'MARKET',
          quantity: String(qty),
          product: 'MIS',
          validity: 'DAY',
          market_protection: '-1',
          tag: STOCKS_ENTRY_TAG,
        }),
      );
      const entryOrderId = readOrderId(response);
      if (!entryOrderId) {
        throw new Error(readError(response) || 'No order_id on entry');
      }

      this.pushEvent({
        at: nowIso(),
        symbol,
        action: 'ENTRY',
        detail: `${direction} ${qty} ${symbol} MIS MARKET`,
        orderId: entryOrderId,
      });

      await delay(900);
      const fill = await this.resolveFill(authorization, entryOrderId, symbol, params.entryHint);
      const fromFill = stockLevelsFromEntry(direction, fill, params.strategyId);

      const leg: StocksLiveLeg = {
        symbol,
        direction,
        qty,
        entry: fill,
        stop: fromFill.stop,
        target: fromFill.target,
        entryOrderId,
        slOrderId: null,
        exitOrderId: null,
        status: 'open',
        lastError: null,
        exitReason: null,
        adopted: false,
        strategyId: params.strategyId,
      };
      this.legs.set(symbol, leg);

      const ltp = await this.ltp(authorization, symbol, fill);
      const hit = evaluateExit(leg, ltp, istMinutesNow());
      if (hit) {
        await this.placeExit(authorization, leg, hit.reason);
        return;
      }
      await this.placeProtectiveSl(authorization, leg);
    } catch (err) {
      const message = formatErr(err);
      this.legs.set(symbol, {
        symbol,
        direction,
        qty,
        entry: params.entryHint,
        stop: params.stop,
        target: params.target,
        entryOrderId: null,
        slOrderId: null,
        exitOrderId: null,
        status: 'error',
        lastError: message,
        exitReason: null,
        adopted: false,
        strategyId: params.strategyId,
      });
      this.pushEvent({
        at: nowIso(),
        symbol,
        action: 'ERROR',
        detail: `Entry failed: ${message}`,
      });
    }
  }

  private async placeProtectiveSl(authorization: string, leg: StocksLiveLeg): Promise<boolean> {
    const slSide: 'BUY' | 'SELL' = leg.direction === 'BUY' ? 'SELL' : 'BUY';
    const tick = tickFor(this.instruments, leg.symbol);
    const trigger = roundTick(leg.stop, tick);

    // SL-M must be on the correct side of LTP
    const ltp = await this.ltp(authorization, leg.symbol, leg.entry);
    if (leg.direction === 'BUY' && ltp > 0 && trigger >= ltp) {
      await this.placeExit(authorization, leg, 'Stop already breached — market exit');
      return false;
    }
    if (leg.direction === 'SELL' && ltp > 0 && trigger <= ltp) {
      await this.placeExit(authorization, leg, 'Stop already breached — market exit');
      return false;
    }

    try {
      const slRes = await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: 'NSE',
          tradingsymbol: leg.symbol,
          transaction_type: slSide,
          order_type: 'SL-M',
          quantity: String(leg.qty),
          product: 'MIS',
          validity: 'DAY',
          trigger_price: String(trigger),
          market_protection: '-1',
          tag: STOCKS_SL_TAG,
        }),
      );
      const slOrderId = readOrderId(slRes);
      if (!slOrderId) {
        throw new Error(readError(slRes) || 'No order_id on SL-M');
      }
      this.legs.set(leg.symbol, {
        ...leg,
        stop: trigger,
        slOrderId,
        lastError: null,
      });
      this.pushEvent({
        at: nowIso(),
        symbol: leg.symbol,
        action: 'SL',
        detail: `SL-M ${slSide} ${leg.qty} ${leg.symbol} trigger ${trigger}`,
        orderId: slOrderId,
      });
      return true;
    } catch (err) {
      const message = formatErr(err);
      this.legs.set(leg.symbol, { ...leg, lastError: `SL-M failed: ${message}` });
      this.pushEvent({
        at: nowIso(),
        symbol: leg.symbol,
        action: 'ERROR',
        detail: `SL-M failed: ${message} — will exit via MARKET on monitor`,
      });
      return false;
    }
  }

  private async placeExit(
    authorization: string,
    leg: StocksLiveLeg,
    reason: string,
  ): Promise<void> {
    const exitSide: 'BUY' | 'SELL' = leg.direction === 'BUY' ? 'SELL' : 'BUY';
    try {
      if (leg.slOrderId) {
        const slStatus = await this.getOrderStatus(authorization, leg.slOrderId);
        if (slStatus === 'COMPLETE') {
          this.legs.set(leg.symbol, {
            ...leg,
            status: 'flat',
            exitReason: 'Protective SL-M filled',
            lastError: null,
          });
          this.pushEvent({
            at: nowIso(),
            symbol: leg.symbol,
            action: 'EXIT',
            detail: 'Protective SL-M already filled — no MARKET exit',
            orderId: leg.slOrderId,
          });
          return;
        }
        if (slStatus && isCancellable(slStatus)) {
          await firstValueFrom(this.kiteApi.cancelRegularOrder(authorization, leg.slOrderId));
          this.pushEvent({
            at: nowIso(),
            symbol: leg.symbol,
            action: 'CANCEL_SL',
            detail: `Cancelled pending SL-M (${slStatus}) before exit`,
            orderId: leg.slOrderId,
          });
          await delay(300);
        }
      }

      const response = await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: 'NSE',
          tradingsymbol: leg.symbol,
          transaction_type: exitSide,
          order_type: 'MARKET',
          quantity: String(leg.qty),
          product: 'MIS',
          validity: 'DAY',
          market_protection: '-1',
          tag: STOCKS_EXIT_TAG,
        }),
      );
      const orderId = readOrderId(response);
      if (!orderId) {
        throw new Error(readError(response) || 'No order_id on exit');
      }
      this.legs.set(leg.symbol, {
        ...leg,
        slOrderId: null,
        exitOrderId: orderId,
        status: 'flat',
        exitReason: reason,
        lastError: null,
      });
      this.pushEvent({
        at: nowIso(),
        symbol: leg.symbol,
        action: 'EXIT',
        detail: `${exitSide} ${leg.qty} ${leg.symbol} MARKET · ${reason}`,
        orderId,
      });
    } catch (err) {
      const message = formatErr(err);
      this.legs.set(leg.symbol, {
        ...leg,
        status: 'error',
        lastError: message,
      });
      this.pushEvent({
        at: nowIso(),
        symbol: leg.symbol,
        action: 'ERROR',
        detail: `Exit failed: ${message}`,
      });
    }
  }

  private async refreshSlState(
    authorization: string,
    leg: StocksLiveLeg,
  ): Promise<'filled' | 'open' | 'unknown'> {
    if (!leg.slOrderId) return 'open';
    const status = await this.getOrderStatus(authorization, leg.slOrderId);
    if (status === 'COMPLETE') {
      this.legs.set(leg.symbol, {
        ...leg,
        status: 'flat',
        exitReason: 'Protective SL-M filled',
        lastError: null,
      });
      this.pushEvent({
        at: nowIso(),
        symbol: leg.symbol,
        action: 'EXIT',
        detail: 'Protective SL-M filled at exchange',
        orderId: leg.slOrderId,
      });
      return 'filled';
    }
    return status ? 'open' : 'unknown';
  }

  private async resolveFill(
    authorization: string,
    entryOrderId: string,
    symbol: string,
    fallback: number,
  ): Promise<number> {
    try {
      const book = await this.fetchOrders(authorization);
      const row = book.find((o) => o.order_id === entryOrderId);
      if (row?.average_price && row.average_price > 0) return row.average_price;
    } catch {
      /* fall through */
    }
    const ltp = await this.ltp(authorization, symbol, fallback);
    return ltp > 0 ? ltp : fallback;
  }

  private async ltp(authorization: string, symbol: string, fallback: number): Promise<number> {
    try {
      const key = `NSE:${symbol}`;
      const quote = (await firstValueFrom(
        this.kiteApi.getQuotes(authorization, [key]),
      )) as KiteQuoteBook;
      const px = Number(quote.data?.[key]?.last_price ?? 0);
      if (px > 0) return px;
    } catch {
      /* ignore */
    }
    return fallback;
  }

  private async fetchOrders(authorization: string): Promise<KiteOrderRow[]> {
    try {
      const book = (await firstValueFrom(this.kiteApi.getOrders(authorization))) as KiteOrdersBook;
      return book.data ?? [];
    } catch {
      return [];
    }
  }

  private async getOrderStatus(authorization: string, orderId: string): Promise<string | null> {
    const book = await this.fetchOrders(authorization);
    return book.find((o) => o.order_id === orderId)?.status ?? null;
  }

  private pushEvent(e: StocksLiveEvent): void {
    this.events.unshift(e);
    if (this.events.length > 200) this.events.length = 200;
  }
}

function evaluateExit(
  leg: StocksLiveLeg,
  ltp: number,
  istMinutes: number,
): { reason: string } | null {
  if (istMinutes >= STOCKS_EOD_EXIT_HHMM) {
    return { reason: 'EOD square-off (15:15 IST)' };
  }
  if (ltp <= 0) return null;

  if (leg.direction === 'BUY') {
    if (ltp <= leg.stop) return { reason: `Stop hit @ ${ltp.toFixed(2)}` };
    if (leg.target != null && ltp >= leg.target) {
      return { reason: `Target hit @ ${ltp.toFixed(2)}` };
    }
  } else {
    if (ltp >= leg.stop) return { reason: `Stop hit @ ${ltp.toFixed(2)}` };
    if (leg.target != null && ltp <= leg.target) {
      return { reason: `Target hit @ ${ltp.toFixed(2)}` };
    }
  }
  return null;
}

function findPendingSl(
  orders: KiteOrderRow[],
  symbol: string,
  positionDirection: 'BUY' | 'SELL',
): KiteOrderRow | undefined {
  const needSide = positionDirection === 'BUY' ? 'SELL' : 'BUY';
  return orders.find((o) => {
    if ((o.tradingsymbol ?? '').toUpperCase() !== symbol) return false;
    if ((o.transaction_type ?? '').toUpperCase() !== needSide) return false;
    const ot = (o.order_type ?? '').toUpperCase();
    if (ot !== 'SL-M' && ot !== 'SL') return false;
    return isCancellable(o.status ?? '');
  });
}

function isPalagaiEqTag(tag?: string): boolean {
  const t = (tag ?? '').toUpperCase();
  return t.startsWith('PALAGAI_EQ') || t === 'PALAGAI';
}

function isFilledOrWorking(status?: string): boolean {
  const s = (status ?? '').toUpperCase();
  return (
    s === 'COMPLETE' ||
    s === 'OPEN' ||
    s === 'TRIGGER PENDING' ||
    s === 'AMO REQ RECEIVED' ||
    s === 'PUT ORDER REQ RECEIVED'
  );
}

function isCancellable(status: string): boolean {
  const s = status.toUpperCase();
  return s === 'OPEN' || s === 'TRIGGER PENDING' || s === 'AMO REQ RECEIVED';
}

function tickFor(instruments: InstrumentStoreService, symbol: string): number {
  const hit = instruments.findNseEquityExact(symbol);
  const t = hit?.tickSize ?? 0.05;
  return t > 0 ? t : 0.05;
}

function roundTick(price: number, tick: number): number {
  if (tick <= 0) return Math.round(price * 100) / 100;
  return Math.round(price / tick) * tick;
}

function readOrderId(response: unknown): string | null {
  const parsed = response as KiteOrderResponse;
  return parsed?.data?.order_id?.trim() || null;
}

function readError(response: unknown): string | null {
  const parsed = response as KiteOrderResponse;
  if (parsed?.status === 'error') {
    return parsed.message ?? parsed.error_type ?? 'Kite order error';
  }
  return null;
}

function formatErr(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    return extractKiteApiError(err, 'orders');
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function nowIso(): string {
  return new Date().toISOString();
}

function istMinutesNow(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

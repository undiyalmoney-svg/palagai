import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { extractKiteApiError } from '../utils/kite-error.util';
import { PaperOptionContract } from '../paper-desk/paper-desk.models';

export interface LiveBrokerPosition {
  instrumentId: string;
  tradingSymbol: string;
  instrumentToken: number;
  quantity: number;
  direction: 'BUY' | 'SELL';
  entryOrderId: string | null;
  slOrderId: string | null;
  exitOrderId: string | null;
  entryPremium: number | null;
  slTrigger: number | null;
  entryTime: string;
  status: 'open' | 'flat' | 'error';
  lastError: string | null;
}

export interface LiveOrderEvent {
  at: string;
  instrumentId: string;
  instrumentName: string;
  action: 'ENTRY' | 'SL' | 'CANCEL_SL' | 'EXIT' | 'SKIP' | 'ERROR';
  detail: string;
  orderId?: string;
  tradingSymbol?: string;
  quantity?: number;
  triggerPrice?: number;
  averagePrice?: number;
}

/** Full session order book row for Live money UI. */
export interface LiveOrderSummaryRow {
  id: string;
  at: string;
  instrumentId: string;
  instrumentName: string;
  tradingSymbol: string;
  quantity: number;
  leg: 'ENTRY' | 'SL-M' | 'EXIT' | 'CANCEL_SL';
  side: 'BUY' | 'SELL' | '—';
  orderId: string;
  status: string;
  triggerPrice: number | null;
  averagePrice: number | null;
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
}

interface KiteOrdersBook {
  status?: string;
  data?: KiteOrderRow[];
}

interface KiteQuoteBook {
  status?: string;
  data?: Record<string, { last_price?: number }>;
}

export interface LiveOpenSignal {
  direction: 'BUY' | 'SELL';
  entryTime: string;
  indexEntry: number;
  indexStop: number;
  option: PaperOptionContract | null;
  optionEntryPremium: number | null;
}

/**
 * Live money executor (addon):
 * 1) MARKET BUY entry
 * 2) Protective SL-M SELL (trigger from index stop × ~0.5 delta on premium)
 * 3) Strategy exit → cancel pending SL → MARKET SELL
 * 4) If SL already COMPLETE → flat, no second exit
 */
@Injectable({ providedIn: 'root' })
export class LiveOrderExecutorService {
  private readonly kiteApi = inject(KiteApiService);

  private readonly positions = new Map<string, LiveBrokerPosition>();
  private readonly events: LiveOrderEvent[] = [];
  private readonly summary = new Map<string, LiveOrderSummaryRow>();
  private readonly instrumentNames = new Map<string, string>();

  reset(): void {
    this.positions.clear();
    this.events.length = 0;
    this.summary.clear();
  }

  getPositions(): LiveBrokerPosition[] {
    return [...this.positions.values()];
  }

  getEvents(): LiveOrderEvent[] {
    return [...this.events];
  }

  getOrderSummary(): LiveOrderSummaryRow[] {
    return [...this.summary.values()].sort((a, b) => b.at.localeCompare(a.at));
  }

  async syncInstrument(params: {
    authorization: string;
    instrumentId: string;
    instrumentName: string;
    open: LiveOpenSignal | null;
  }): Promise<void> {
    this.instrumentNames.set(params.instrumentId, params.instrumentName);
    const current = this.positions.get(params.instrumentId) ?? null;
    const open = params.open;

    if (current?.status === 'open') {
      const slState = await this.refreshSlState(params.authorization, current);
      if (slState === 'filled') {
        await this.refreshSummaryStatuses(params.authorization);
        return;
      }
    }

    if (open && (!current || current.status === 'flat' || current.status === 'error')) {
      await this.placeEntry(params.authorization, params.instrumentId, open);
      await this.refreshSummaryStatuses(params.authorization);
      return;
    }

    if (!open && current && current.status === 'open') {
      await this.placeExit(params.authorization, current);
      await this.refreshSummaryStatuses(params.authorization);
      return;
    }

    await this.refreshSummaryStatuses(params.authorization);
  }

  private async placeEntry(
    authorization: string,
    instrumentId: string,
    open: LiveOpenSignal,
  ): Promise<void> {
    const option = open.option;
    if (!option || option.source === 'synthetic' || option.instrumentToken <= 0) {
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId,
        action: 'SKIP',
        detail: 'No tradeable chain option (synthetic/missing) — real order blocked.',
        tradingSymbol: option?.tradingSymbol,
      });
      this.positions.set(instrumentId, this.errorPos(instrumentId, open, option, 'Synthetic/missing option'));
      return;
    }

    // 1 lot = exchange lot size for that contract (Nifty / Bank Nifty).
    const quantity = Math.max(1, option.lotSize || 1);
    try {
      const response = await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: 'NFO',
          tradingsymbol: option.tradingSymbol,
          transaction_type: 'BUY',
          order_type: 'MARKET',
          quantity: String(quantity),
          product: 'MIS',
          validity: 'DAY',
          market_protection: '-1',
          tag: 'PALAGAI',
        }),
      );
      const entryOrderId = this.readOrderId(response);
      if (!entryOrderId) {
        throw new Error(this.readError(response) || 'No order_id on entry');
      }

      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId,
        action: 'ENTRY',
        detail: `BUY ${quantity} ${option.tradingSymbol} MIS MARKET (1 lot)`,
        orderId: entryOrderId,
        tradingSymbol: option.tradingSymbol,
        quantity,
      });

      await delay(900);
      const fillPremium = await this.resolveEntryPremium(
        authorization,
        entryOrderId,
        option.tradingSymbol,
        open.optionEntryPremium,
      );
      const indexRisk = Math.abs(open.indexEntry - open.indexStop);
      const slTrigger = roundOptionTick(Math.max(0.05, fillPremium - indexRisk * 0.5));

      let slOrderId: string | null = null;
      try {
        const slRes = await firstValueFrom(
          this.kiteApi.placeRegularOrder(authorization, {
            exchange: 'NFO',
            tradingsymbol: option.tradingSymbol,
            transaction_type: 'SELL',
            order_type: 'SL-M',
            quantity: String(quantity),
            product: 'MIS',
            validity: 'DAY',
            trigger_price: String(slTrigger),
            market_protection: '-1',
            tag: 'PALAGAISL',
          }),
        );
        slOrderId = this.readOrderId(slRes);
        if (!slOrderId) {
          throw new Error(this.readError(slRes) || 'No order_id on SL-M');
        }
        this.pushEvent({
          at: new Date().toISOString(),
          instrumentId,
          action: 'SL',
          detail: `SL-M SELL ${quantity} ${option.tradingSymbol} trigger ${slTrigger} (index risk ${indexRisk.toFixed(1)}→~${(indexRisk * 0.5).toFixed(1)} prem)`,
          orderId: slOrderId,
          tradingSymbol: option.tradingSymbol,
          quantity,
          triggerPrice: slTrigger,
        });
      } catch (slErr) {
        this.pushEvent({
          at: new Date().toISOString(),
          instrumentId,
          action: 'ERROR',
          detail: `Entry filled but SL-M failed: ${this.formatErr(slErr)} — exit will use MARKET only`,
          tradingSymbol: option.tradingSymbol,
          quantity,
        });
      }

      this.positions.set(instrumentId, {
        instrumentId,
        tradingSymbol: option.tradingSymbol,
        instrumentToken: option.instrumentToken,
        quantity,
        direction: open.direction,
        entryOrderId,
        slOrderId,
        exitOrderId: null,
        entryPremium: fillPremium,
        slTrigger,
        entryTime: open.entryTime,
        status: 'open',
        lastError: slOrderId ? null : 'SL-M not placed',
      });
    } catch (err) {
      const message = this.formatErr(err);
      this.positions.set(instrumentId, this.errorPos(instrumentId, open, option, message));
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId,
        action: 'ERROR',
        detail: `Entry failed: ${message}`,
        tradingSymbol: option.tradingSymbol,
        quantity,
      });
    }
  }

  /**
   * Strategy exit: if SL still pending → cancel it, then MARKET SELL.
   * If SL already COMPLETE → already flat.
   */
  private async placeExit(authorization: string, pos: LiveBrokerPosition): Promise<void> {
    try {
      if (pos.slOrderId) {
        const slStatus = await this.getOrderStatus(authorization, pos.slOrderId);
        if (slStatus === 'COMPLETE') {
          this.positions.set(pos.instrumentId, {
            ...pos,
            status: 'flat',
            lastError: null,
          });
          this.pushEvent({
            at: new Date().toISOString(),
            instrumentId: pos.instrumentId,
            action: 'EXIT',
            detail: `Protective SL-M already filled — no MARKET exit needed`,
            orderId: pos.slOrderId,
            tradingSymbol: pos.tradingSymbol,
            quantity: pos.quantity,
          });
          return;
        }

        if (slStatus && isCancellable(slStatus)) {
          await firstValueFrom(this.kiteApi.cancelRegularOrder(authorization, pos.slOrderId));
          this.pushEvent({
            at: new Date().toISOString(),
            instrumentId: pos.instrumentId,
            action: 'CANCEL_SL',
            detail: `Cancelled pending SL-M before strategy exit (${slStatus})`,
            orderId: pos.slOrderId,
            tradingSymbol: pos.tradingSymbol,
            quantity: pos.quantity,
          });
          await delay(300);
        }
      }

      const response = await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: 'NFO',
          tradingsymbol: pos.tradingSymbol,
          transaction_type: 'SELL',
          order_type: 'MARKET',
          quantity: String(pos.quantity),
          product: 'MIS',
          validity: 'DAY',
          market_protection: '-1',
          tag: 'PALAGAI',
        }),
      );
      const orderId = this.readOrderId(response);
      if (!orderId) {
        throw new Error(this.readError(response) || 'No order_id on exit');
      }
      this.positions.set(pos.instrumentId, {
        ...pos,
        slOrderId: null,
        exitOrderId: orderId,
        status: 'flat',
        lastError: null,
      });
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'EXIT',
        detail: `SELL ${pos.quantity} ${pos.tradingSymbol} MIS MARKET (strategy exit)`,
        orderId,
        tradingSymbol: pos.tradingSymbol,
        quantity: pos.quantity,
      });
    } catch (err) {
      const message = this.formatErr(err);
      this.positions.set(pos.instrumentId, {
        ...pos,
        status: 'error',
        lastError: message,
      });
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'ERROR',
        detail: `Exit failed: ${message}`,
        tradingSymbol: pos.tradingSymbol,
        quantity: pos.quantity,
      });
    }
  }

  private async refreshSlState(
    authorization: string,
    pos: LiveBrokerPosition,
  ): Promise<'filled' | 'open' | 'unknown'> {
    if (!pos.slOrderId) {
      return 'open';
    }
    const status = await this.getOrderStatus(authorization, pos.slOrderId);
    if (status === 'COMPLETE') {
      this.positions.set(pos.instrumentId, {
        ...pos,
        status: 'flat',
        lastError: null,
      });
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'EXIT',
        detail: `Protective SL-M filled at exchange`,
        orderId: pos.slOrderId,
        tradingSymbol: pos.tradingSymbol,
        quantity: pos.quantity,
      });
      return 'filled';
    }
    return status ? 'open' : 'unknown';
  }

  private async refreshSummaryStatuses(authorization: string): Promise<void> {
    if (this.summary.size === 0) {
      return;
    }
    try {
      const book = (await firstValueFrom(this.kiteApi.getOrders(authorization))) as KiteOrdersBook;
      const byId = new Map(
        (book.data ?? [])
          .filter((o): o is KiteOrderRow & { order_id: string } => !!o.order_id)
          .map((o) => [o.order_id, o]),
      );
      for (const [id, row] of this.summary) {
        const kite = byId.get(id);
        if (!kite) {
          continue;
        }
        this.summary.set(id, {
          ...row,
          status: kite.status ?? row.status,
          averagePrice:
            kite.average_price && kite.average_price > 0 ? kite.average_price : row.averagePrice,
          triggerPrice:
            kite.trigger_price && kite.trigger_price > 0 ? kite.trigger_price : row.triggerPrice,
          tradingSymbol: kite.tradingsymbol || row.tradingSymbol,
        });
      }
    } catch {
      // Keep last known summary if book refresh fails.
    }
  }

  private async resolveEntryPremium(
    authorization: string,
    entryOrderId: string,
    tradingSymbol: string,
    fallback: number | null,
  ): Promise<number> {
    try {
      const book = (await firstValueFrom(this.kiteApi.getOrders(authorization))) as KiteOrdersBook;
      const row = book.data?.find((o) => o.order_id === entryOrderId);
      if (row?.average_price && row.average_price > 0) {
        return row.average_price;
      }
    } catch {
      // fall through
    }

    try {
      const key = `NFO:${tradingSymbol}`;
      const quote = (await firstValueFrom(
        this.kiteApi.getQuotes(authorization, [key]),
      )) as KiteQuoteBook;
      const ltp = quote.data?.[key]?.last_price;
      if (ltp && ltp > 0) {
        return ltp;
      }
    } catch {
      // fall through
    }

    if (fallback != null && fallback > 0) {
      return fallback;
    }
    return 1;
  }

  private async getOrderStatus(
    authorization: string,
    orderId: string,
  ): Promise<string | null> {
    try {
      const book = (await firstValueFrom(this.kiteApi.getOrders(authorization))) as KiteOrdersBook;
      const row = book.data?.find((o) => o.order_id === orderId);
      return row?.status ?? null;
    } catch {
      return null;
    }
  }

  private errorPos(
    instrumentId: string,
    open: LiveOpenSignal,
    option: PaperOptionContract | null,
    message: string,
  ): LiveBrokerPosition {
    return {
      instrumentId,
      tradingSymbol: option?.tradingSymbol ?? '',
      instrumentToken: option?.instrumentToken ?? 0,
      quantity: option?.lotSize ?? 0,
      direction: open.direction,
      entryOrderId: null,
      slOrderId: null,
      exitOrderId: null,
      entryPremium: null,
      slTrigger: null,
      entryTime: open.entryTime,
      status: 'error',
      lastError: message,
    };
  }

  private formatErr(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      return extractKiteApiError(err, 'orders');
    }
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }

  private readOrderId(response: unknown): string | null {
    const parsed = response as KiteOrderResponse;
    return parsed?.data?.order_id?.trim() || null;
  }

  private readError(response: unknown): string | null {
    const parsed = response as KiteOrderResponse;
    if (parsed?.status === 'error') {
      return parsed.message ?? parsed.error_type ?? 'Kite order error';
    }
    return null;
  }

  private pushEvent(
    partial: Omit<LiveOrderEvent, 'instrumentName'> & { instrumentName?: string },
  ): void {
    const event: LiveOrderEvent = {
      ...partial,
      instrumentName:
        partial.instrumentName ??
        this.instrumentNames.get(partial.instrumentId) ??
        partial.instrumentId,
    };
    this.events.unshift(event);
    if (this.events.length > 80) {
      this.events.length = 80;
    }
    this.upsertSummaryFromEvent(event);
  }

  private upsertSummaryFromEvent(event: LiveOrderEvent): void {
    if (!event.orderId) {
      return;
    }

    const prev = this.summary.get(event.orderId);

    if (event.action === 'CANCEL_SL') {
      if (prev) {
        this.summary.set(event.orderId, {
          ...prev,
          at: event.at,
          status: 'CANCELLED',
          leg: 'SL-M',
        });
      }
      return;
    }

    // SL fill: refresh the protective SL-M row, do not invent a fake EXIT order id.
    if (
      event.action === 'EXIT' &&
      (event.detail.includes('Protective SL-M') || event.detail.includes('SL-M already'))
    ) {
      if (prev) {
        this.summary.set(event.orderId, {
          ...prev,
          at: event.at,
          status: 'COMPLETE',
          leg: 'SL-M',
          side: 'SELL',
        });
      }
      return;
    }

    let leg: LiveOrderSummaryRow['leg'] | null = null;
    let side: LiveOrderSummaryRow['side'] = '—';
    if (event.action === 'ENTRY') {
      leg = 'ENTRY';
      side = 'BUY';
    } else if (event.action === 'SL') {
      leg = 'SL-M';
      side = 'SELL';
    } else if (event.action === 'EXIT') {
      leg = 'EXIT';
      side = 'SELL';
    } else {
      return;
    }

    this.summary.set(event.orderId, {
      id: event.orderId,
      at: event.at,
      instrumentId: event.instrumentId,
      instrumentName: event.instrumentName,
      tradingSymbol: event.tradingSymbol ?? prev?.tradingSymbol ?? '',
      quantity: event.quantity ?? prev?.quantity ?? 0,
      leg,
      side,
      orderId: event.orderId,
      status: prev?.status ?? 'PENDING',
      triggerPrice: event.triggerPrice ?? prev?.triggerPrice ?? null,
      averagePrice: event.averagePrice ?? prev?.averagePrice ?? null,
    });
  }
}

function isCancellable(status: string): boolean {
  const s = status.toUpperCase();
  return (
    s === 'OPEN' ||
    s === 'TRIGGER PENDING' ||
    s.includes('PENDING') ||
    s === 'AMO REQ RECEIVED'
  );
}

function roundOptionTick(price: number): number {
  return Math.max(0.05, Math.round(price / 0.05) * 0.05);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

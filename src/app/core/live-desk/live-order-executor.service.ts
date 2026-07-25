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
  exchange: 'NFO' | 'MCX';
  product: 'MIS' | 'NRML';
  /** Index levels used to size / amend protective SL-M. */
  indexEntry?: number;
  indexStop?: number;
}

export interface LiveOrderEvent {
  at: string;
  instrumentId: string;
  instrumentName: string;
  action: 'ENTRY' | 'SL' | 'MODIFY_SL' | 'CANCEL_SL' | 'EXIT' | 'ADOPT' | 'SKIP' | 'ERROR';
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
  exchange?: string;
  transaction_type?: string;
  order_type?: string;
  product?: string;
  quantity?: number;
  tag?: string;
}

interface KiteOrdersBook {
  status?: string;
  data?: KiteOrderRow[];
}

interface KiteQuoteBook {
  status?: string;
  data?: Record<string, { last_price?: number }>;
}

interface KitePositionRow {
  tradingsymbol?: string;
  exchange?: string;
  instrument_token?: number;
  product?: string;
  quantity?: number;
  average_price?: number;
  last_price?: number;
}

interface KitePositionsBook {
  status?: string;
  data?: { net?: KitePositionRow[]; day?: KitePositionRow[] };
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
  /** Open broker legs keyed by option tradingsymbol (restart adopt). */
  private readonly positionsBySymbol = new Map<string, LiveBrokerPosition>();
  private readonly events: LiveOrderEvent[] = [];
  private readonly summary = new Map<string, LiveOrderSummaryRow>();
  private readonly instrumentNames = new Map<string, string>();
  /** Number of lots (exchange lot size × this). Testing never uses this. */
  private lotsMultiplier = 1;

  reset(): void {
    this.positions.clear();
    this.positionsBySymbol.clear();
    this.events.length = 0;
    this.summary.clear();
  }

  /**
   * Clear broker state for one desk only so Trade Desk + Crude can run live together.
   * Full `reset()` would wipe the other desk's open SL / adopt map.
   */
  clearInstruments(instrumentIds: readonly string[]): void {
    const idSet = new Set(instrumentIds);
    for (const id of idSet) {
      const pos = this.positions.get(id);
      if (pos?.tradingSymbol) {
        this.positionsBySymbol.delete(pos.tradingSymbol.toUpperCase());
      }
      this.positions.delete(id);
      this.summary.delete(id);
    }
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      if (idSet.has(this.events[i]!.instrumentId)) {
        this.events.splice(i, 1);
      }
    }
  }

  setLotsMultiplier(lots: number): void {
    this.lotsMultiplier = Math.max(1, Math.floor(lots) || 1);
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

  /** Latest SKIP/ERROR detail for an instrument (for Trade Desk banners). */
  getLastBlockReason(instrumentId: string): string | null {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const e = this.events[i]!;
      if (e.instrumentId !== instrumentId) {
        continue;
      }
      if (e.action === 'SKIP' || e.action === 'ERROR') {
        return e.detail;
      }
      if (e.action === 'ENTRY') {
        return null;
      }
    }
    const pos = this.positions.get(instrumentId);
    return pos?.lastError ?? null;
  }

  /**
   * On Live money start: adopt open NFO/MCX legs tagged PALAGAI* so restart
   * does not double-enter. Places missing SL-M when needed.
   */
  async reconcileFromBroker(authorization: string): Promise<string> {
    let adopted = 0;
    let slPlaced = 0;
    try {
      const book = (await firstValueFrom(
        this.kiteApi.getPositions(authorization),
      )) as KitePositionsBook;
      const orders = await this.fetchOrders(authorization);
      const rows = [...(book.data?.net ?? []), ...(book.data?.day ?? [])];
      const seen = new Set<string>();

      for (const row of rows) {
        const exchange = (row.exchange ?? '').toUpperCase();
        if (exchange !== 'NFO' && exchange !== 'MCX') continue;
        const qty = Number(row.quantity ?? 0);
        if (!qty) continue;
        const symbol = (row.tradingsymbol ?? '').toUpperCase();
        if (!symbol || seen.has(symbol)) continue;
        seen.add(symbol);

        const tagged = orders.some(
          (o) =>
            (o.tradingsymbol ?? '').toUpperCase() === symbol &&
            isPalagaiTag(o.tag) &&
            isFilledOrWorking(o.status),
        );
        if (!tagged) continue;

        const product = ((row.product ?? 'MIS').toUpperCase() === 'NRML' ? 'NRML' : 'MIS') as
          | 'MIS'
          | 'NRML';
        const pendingSl = findPendingOptionSl(orders, symbol);
        const entryAvg = Number(row.average_price ?? 0) || Number(row.last_price ?? 0) || 1;
        const orphanId = `orphan:${symbol}`;

        const pos: LiveBrokerPosition = {
          instrumentId: orphanId,
          tradingSymbol: symbol,
          instrumentToken: Number(row.instrument_token ?? 0),
          quantity: Math.abs(qty),
          direction: 'BUY',
          entryOrderId: null,
          slOrderId: pendingSl?.order_id ?? null,
          exitOrderId: null,
          entryPremium: entryAvg,
          slTrigger: pendingSl?.trigger_price ?? null,
          entryTime: new Date().toISOString(),
          status: 'open',
          lastError: null,
          exchange: exchange as 'NFO' | 'MCX',
          product,
          indexEntry: undefined,
          indexStop: undefined,
        };
        this.positions.set(orphanId, pos);
        this.positionsBySymbol.set(symbol, pos);
        adopted += 1;
        this.pushEvent({
          at: new Date().toISOString(),
          instrumentId: orphanId,
          action: 'ADOPT',
          detail: `Adopted open ${exchange} ${product} ${symbol} qty ${pos.quantity} @ ~${entryAvg.toFixed(2)}`,
          tradingSymbol: symbol,
          quantity: pos.quantity,
          orderId: pendingSl?.order_id,
        });

        if (!pos.slOrderId && entryAvg > 0) {
          // Protective SL ~ half of a default 30pt index risk if unknown
          const slTrigger = roundOptionTick(Math.max(0.05, entryAvg - 15));
          const ok = await this.placeSlOnly(authorization, pos, slTrigger);
          if (ok) slPlaced += 1;
        }
      }
    } catch (err) {
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: 'reconcile',
        action: 'ERROR',
        detail: `Reconcile failed: ${this.formatErr(err)}`,
      });
      return `Reconcile failed: ${this.formatErr(err)}`;
    }
    return `Reconcile · adopted ${adopted} · SL placed ${slPlaced}`;
  }

  async syncInstrument(params: {
    authorization: string;
    instrumentId: string;
    instrumentName: string;
    open: LiveOpenSignal | null;
  }): Promise<void> {
    this.instrumentNames.set(params.instrumentId, params.instrumentName);
    const open = params.open;

    // Remap adopted orphan → desk instrument when symbols match.
    if (open?.option?.tradingSymbol) {
      const sym = open.option.tradingSymbol.toUpperCase();
      const bySym = this.positionsBySymbol.get(sym);
      if (bySym?.status === 'open') {
        const remapped: LiveBrokerPosition = {
          ...bySym,
          instrumentId: params.instrumentId,
          indexEntry: open.indexEntry,
          indexStop: open.indexStop,
        };
        this.positions.set(params.instrumentId, remapped);
        this.positionsBySymbol.set(sym, remapped);
        if (bySym.instrumentId.startsWith('orphan:')) {
          this.positions.delete(bySym.instrumentId);
        }
      }
    }

    let current = this.positions.get(params.instrumentId) ?? null;

    if (current?.status === 'open') {
      const slState = await this.refreshSlState(params.authorization, current);
      if (slState === 'filled') {
        await this.refreshSummaryStatuses(params.authorization);
        return;
      }
      current = this.positions.get(params.instrumentId) ?? current;
    }

    // Open paper + open broker: amend SL if index stop moved (BE / trail) — never re-enter.
    if (open && current?.status === 'open') {
      await this.syncProtectiveSl(params.authorization, current, open);
      await this.refreshSummaryStatuses(params.authorization);
      return;
    }

    if (open && (!current || current.status === 'flat' || current.status === 'error')) {
      // Safety: if broker already has this option open, adopt instead of second entry.
      if (open.option?.tradingSymbol) {
        const existing = this.positionsBySymbol.get(open.option.tradingSymbol.toUpperCase());
        if (existing?.status === 'open') {
          this.positions.set(params.instrumentId, {
            ...existing,
            instrumentId: params.instrumentId,
            indexEntry: open.indexEntry,
            indexStop: open.indexStop,
          });
          await this.syncProtectiveSl(
            params.authorization,
            this.positions.get(params.instrumentId)!,
            open,
          );
          await this.refreshSummaryStatuses(params.authorization);
          return;
        }
      }
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

    // qty = exchange lot size × configured lots (Live money only).
    const lotSize = Math.max(1, option.lotSize || 1);
    const quantity = lotSize * this.lotsMultiplier;
    const exchange = option.exchange ?? 'NFO';
    const product = option.product ?? 'MIS';
    try {
      const response = await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange,
          tradingsymbol: option.tradingSymbol,
          transaction_type: 'BUY',
          order_type: 'MARKET',
          quantity: String(quantity),
          product,
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
        detail: `BUY ${quantity} ${option.tradingSymbol} ${product} MARKET (${this.lotsMultiplier} lot × ${lotSize})`,
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
        exchange,
      );
      const indexRisk = Math.abs(open.indexEntry - open.indexStop);
      const slTrigger = roundOptionTick(Math.max(0.05, fillPremium - indexRisk * 0.5));

      let slOrderId: string | null = null;
      try {
        const slRes = await firstValueFrom(
          this.kiteApi.placeRegularOrder(authorization, {
            exchange,
            tradingsymbol: option.tradingSymbol,
            transaction_type: 'SELL',
            order_type: 'SL-M',
            quantity: String(quantity),
            product,
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
        exchange,
        product,
        indexEntry: open.indexEntry,
        indexStop: open.indexStop,
      });
      this.positionsBySymbol.set(option.tradingSymbol.toUpperCase(), this.positions.get(instrumentId)!);
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
   * When paper stop ratchets (BE / trail), amend pending SL-M trigger.
   * Never places a second entry.
   */
  private async syncProtectiveSl(
    authorization: string,
    pos: LiveBrokerPosition,
    open: LiveOpenSignal,
  ): Promise<void> {
    const fillPremium = pos.entryPremium ?? open.optionEntryPremium ?? 0;
    if (fillPremium <= 0) return;

    const indexRisk = Math.abs(open.indexEntry - open.indexStop);
    const nextTrigger = roundOptionTick(Math.max(0.05, fillPremium - indexRisk * 0.5));
    const prevTrigger = pos.slTrigger ?? 0;

    // Only tighten / move when meaningfully different (≥ 1 tick).
    if (Math.abs(nextTrigger - prevTrigger) < 0.049) {
      this.positions.set(pos.instrumentId, {
        ...pos,
        indexEntry: open.indexEntry,
        indexStop: open.indexStop,
      });
      return;
    }

    // Prefer modify; if no SL yet, place one.
    if (!pos.slOrderId) {
      await this.placeSlOnly(authorization, { ...pos, indexEntry: open.indexEntry, indexStop: open.indexStop }, nextTrigger);
      return;
    }

    const slStatus = await this.getOrderStatus(authorization, pos.slOrderId);
    if (slStatus === 'COMPLETE') {
      await this.refreshSlState(authorization, pos);
      return;
    }
    if (!slStatus || !isCancellable(slStatus)) {
      return;
    }

    try {
      await firstValueFrom(
        this.kiteApi.modifyOrder(authorization, 'regular', pos.slOrderId, {
          order_type: 'SL-M',
          quantity: String(pos.quantity),
          trigger_price: String(nextTrigger),
          validity: 'DAY',
          market_protection: '-1',
        }),
      );
      const updated: LiveBrokerPosition = {
        ...pos,
        slTrigger: nextTrigger,
        indexEntry: open.indexEntry,
        indexStop: open.indexStop,
        lastError: null,
      };
      this.positions.set(pos.instrumentId, updated);
      this.positionsBySymbol.set(pos.tradingSymbol.toUpperCase(), updated);
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'MODIFY_SL',
        detail: `SL-M trigger ${prevTrigger} → ${nextTrigger} (index SL ${open.indexStop.toFixed(1)})`,
        orderId: pos.slOrderId,
        tradingSymbol: pos.tradingSymbol,
        quantity: pos.quantity,
        triggerPrice: nextTrigger,
      });
    } catch (err) {
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'ERROR',
        detail: `SL modify failed: ${this.formatErr(err)}`,
        tradingSymbol: pos.tradingSymbol,
        orderId: pos.slOrderId ?? undefined,
      });
    }
  }

  private async placeSlOnly(
    authorization: string,
    pos: LiveBrokerPosition,
    slTrigger: number,
  ): Promise<boolean> {
    try {
      const slRes = await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: pos.exchange,
          tradingsymbol: pos.tradingSymbol,
          transaction_type: 'SELL',
          order_type: 'SL-M',
          quantity: String(pos.quantity),
          product: pos.product,
          validity: 'DAY',
          trigger_price: String(slTrigger),
          market_protection: '-1',
          tag: 'PALAGAISL',
        }),
      );
      const slOrderId = this.readOrderId(slRes);
      if (!slOrderId) {
        throw new Error(this.readError(slRes) || 'No order_id on SL-M');
      }
      const updated: LiveBrokerPosition = {
        ...pos,
        slOrderId,
        slTrigger,
        lastError: null,
        status: 'open',
      };
      this.positions.set(pos.instrumentId, updated);
      this.positionsBySymbol.set(pos.tradingSymbol.toUpperCase(), updated);
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'SL',
        detail: `SL-M SELL ${pos.quantity} ${pos.tradingSymbol} trigger ${slTrigger}`,
        orderId: slOrderId,
        tradingSymbol: pos.tradingSymbol,
        quantity: pos.quantity,
        triggerPrice: slTrigger,
      });
      return true;
    } catch (err) {
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'ERROR',
        detail: `SL-M place failed: ${this.formatErr(err)}`,
        tradingSymbol: pos.tradingSymbol,
      });
      return false;
    }
  }

  private async fetchOrders(authorization: string): Promise<KiteOrderRow[]> {
    try {
      const book = (await firstValueFrom(this.kiteApi.getOrders(authorization))) as KiteOrdersBook;
      return book.data ?? [];
    } catch {
      return [];
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
          exchange: pos.exchange ?? 'NFO',
          tradingsymbol: pos.tradingSymbol,
          transaction_type: 'SELL',
          order_type: 'MARKET',
          quantity: String(pos.quantity),
          product: pos.product ?? 'MIS',
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
      this.positionsBySymbol.delete(pos.tradingSymbol.toUpperCase());
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'EXIT',
        detail: `SELL ${pos.quantity} ${pos.tradingSymbol} ${pos.product ?? 'MIS'} MARKET (strategy exit)`,
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
      this.positionsBySymbol.delete(pos.tradingSymbol.toUpperCase());
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
    exchange: 'NFO' | 'MCX' = 'NFO',
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
      const key = `${exchange}:${tradingSymbol}`;
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
      exchange: option?.exchange ?? 'NFO',
      product: option?.product ?? 'MIS',
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
    } else if (event.action === 'MODIFY_SL') {
      if (prev) {
        this.summary.set(event.orderId, {
          ...prev,
          at: event.at,
          triggerPrice: event.triggerPrice ?? prev.triggerPrice,
          status: prev.status ?? 'TRIGGER PENDING',
        });
      }
      return;
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

function isPalagaiTag(tag?: string): boolean {
  const t = (tag ?? '').toUpperCase();
  return t.startsWith('PALAGAI');
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

function findPendingOptionSl(orders: KiteOrderRow[], symbol: string): KiteOrderRow | undefined {
  return orders.find((o) => {
    if ((o.tradingsymbol ?? '').toUpperCase() !== symbol) return false;
    if ((o.transaction_type ?? '').toUpperCase() !== 'SELL') return false;
    const ot = (o.order_type ?? '').toUpperCase();
    if (ot !== 'SL-M' && ot !== 'SL') return false;
    return isCancellable(o.status ?? '');
  });
}

function roundOptionTick(price: number): number {
  return Math.max(0.05, Math.round(price / 0.05) * 0.05);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

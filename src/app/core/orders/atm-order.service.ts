/**
 * Manual ATM option buys for the charts tab.
 *
 * This places REAL orders straight through the Kite proxy, which means it
 * bypasses every rail the autobot runs behind: no regime filter, no premium
 * cap, no per-day trade count, no desk loss stop, and no protective stop after
 * the fill. That is the point — it is a human pressing a button — but it is
 * also why the flow is: resolve the exact contract, fetch its live premium,
 * show both, and only then send anything.
 *
 * The order is tagged PALAGAI_CHART rather than PALAGAI so a manual buy is
 * distinguishable in the order book and is never mistaken for a desk fill.
 */
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { InstrumentStoreService } from '../services/instrument-store.service';
import { ChartBookId } from '../charts/live-chart-data.service';
import {
  AtmOptionSide,
  AtmOrderPlan,
  AtmOrderTicket,
  atmExitFields,
  atmOrderFields,
  atmQuoteKey,
  atmStopFields,
  atmTargetFields,
  buildAtmOrderPlan,
} from './atm-order.util';
import {
  ChartLiveTrade,
  buildChartLiveTrades,
  extractKiteOrders,
  extractKitePositions,
} from '../charts/chart-live-trades';

export interface AtmOrderResult {
  ok: boolean;
  orderId: string | null;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class AtmOrderService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly instrumentStore = inject(InstrumentStoreService);

  /** Resolve the contract a button press would buy, without sending anything. */
  async plan(params: {
    book: ChartBookId;
    side: AtmOptionSide;
    spot: number;
    lots: number;
  }): Promise<AtmOrderPlan> {
    if (!this.kiteSession.getAuthorizationHeader()) {
      return { ok: false, reason: 'Kite session required. Connect in the Token tab.' };
    }
    try {
      await this.instrumentStore.ensureLoaded();
    } catch {
      return { ok: false, reason: 'Could not load the instrument list. Refresh it in Settings.' };
    }
    return buildAtmOrderPlan({
      book: params.book,
      instruments: this.instrumentStore.allInstruments(),
      side: params.side,
      spot: params.spot,
      asOfDateTime: new Date().toISOString(),
      lots: params.lots,
    });
  }

  /**
   * Live premium for the resolved contract.
   *
   * Null rather than throwing: a missing quote should not stop the order being
   * offered, it should just be shown honestly as unknown so the confirmation
   * step never invents a cost.
   */
  async premium(ticket: AtmOrderTicket): Promise<number | null> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) return null;
    const key = atmQuoteKey(ticket);
    try {
      const res = (await firstValueFrom(this.kiteApi.getQuotes(authorization, [key]))) as {
        data?: Record<string, { last_price?: number } | undefined>;
      };
      const price = Number(res?.data?.[key]?.last_price);
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
      return null;
    }
  }

  async place(ticket: AtmOrderTicket): Promise<AtmOrderResult> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      return { ok: false, orderId: null, message: 'Kite session required.' };
    }
    try {
      const res = (await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, atmOrderFields(ticket)),
      )) as { status?: string; message?: string; data?: { order_id?: string } };

      const orderId = res?.data?.order_id ?? null;
      if (orderId) {
        return { ok: true, orderId, message: `Order ${orderId} sent.` };
      }
      // Kite answered without an id, so whether it reached the exchange is
      // genuinely unknown — say that rather than claiming either outcome.
      return {
        ok: false,
        orderId: null,
        message: res?.message || 'Kite returned no order id. Check the order book.',
      };
    } catch (error) {
      return { ok: false, orderId: null, message: describeOrderError(error) };
    }
  }

  /**
   * Rest a protective SELL stop on the same contract the Charts tab just bought.
   * Charts-tab only — the live desk places its own stops and never reads these.
   */
  async placeStop(ticket: AtmOrderTicket, triggerPremium: number): Promise<AtmOrderResult> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      return { ok: false, orderId: null, message: 'Kite session required.' };
    }
    const fields = atmStopFields(ticket, triggerPremium);
    if (!fields) {
      return { ok: false, orderId: null, message: 'Could not rest a stop at that premium.' };
    }
    try {
      const res = (await firstValueFrom(this.kiteApi.placeRegularOrder(authorization, fields))) as {
        status?: string;
        message?: string;
        data?: { order_id?: string };
      };
      const orderId = res?.data?.order_id ?? null;
      if (orderId) {
        return { ok: true, orderId, message: `SL ${orderId} resting at ₹${fields['trigger_price']}.` };
      }
      return {
        ok: false,
        orderId: null,
        message: res?.message || 'Kite returned no stop order id. Check the order book.',
      };
    } catch (error) {
      return { ok: false, orderId: null, message: describeOrderError(error) };
    }
  }

  /**
   * Rest a LIMIT SELL at the Charts auto-bot 0.5R. Charts-tab only — the live
   * desk places its own targets and never reads these. Kite regular orders
   * are not OCO: if this fills, cancel the SL in the order book.
   */
  async placeTarget(ticket: AtmOrderTicket, targetPremium: number): Promise<AtmOrderResult> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      return { ok: false, orderId: null, message: 'Kite session required.' };
    }
    const fields = atmTargetFields(ticket, targetPremium);
    if (!fields) {
      return { ok: false, orderId: null, message: 'Could not rest a target at that premium.' };
    }
    try {
      const res = (await firstValueFrom(this.kiteApi.placeRegularOrder(authorization, fields))) as {
        status?: string;
        message?: string;
        data?: { order_id?: string };
      };
      const orderId = res?.data?.order_id ?? null;
      if (orderId) {
        return { ok: true, orderId, message: `TP ${orderId} resting at ₹${fields['price']}.` };
      }
      return {
        ok: false,
        orderId: null,
        message: res?.message || 'Kite returned no target order id. Check the order book.',
      };
    } catch (error) {
      return { ok: false, orderId: null, message: describeOrderError(error) };
    }
  }

  /**
   * Average fill of a just-sent MARKET buy. Falls back to `fallback` if the
   * order book has not caught up yet — the stop still has to rest.
   */
  async fillPrice(orderId: string | null, fallback: number | null): Promise<number | null> {
    if (!orderId) return fallback;
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) return fallback;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const price = await this.readAveragePrice(authorization, orderId);
      if (price != null) return price;
      await delay(350);
    }
    return fallback;
  }

  private async readAveragePrice(authorization: string, orderId: string): Promise<number | null> {
    try {
      const res = (await firstValueFrom(this.kiteApi.getOrderHistory(authorization, orderId))) as {
        data?: Array<{ status?: string; average_price?: number | string }>;
      };
      const rows = Array.isArray(res?.data) ? res.data : [];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i]!;
        const px = Number(row.average_price);
        if (/complete/i.test(String(row.status || '')) && px > 0) {
          return px;
        }
      }
    } catch {
      // The stop can still rest off the quote we already showed.
    }
    return null;
  }

  async cancelChartOrder(orderId: string): Promise<AtmOrderResult> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      return { ok: false, orderId: null, message: 'Kite session required.' };
    }
    const id = String(orderId || '').trim();
    if (!id) {
      return { ok: false, orderId: null, message: 'No order id to cancel.' };
    }
    try {
      await firstValueFrom(this.kiteApi.cancelRegularOrder(authorization, id));
      return { ok: true, orderId: id, message: `Cancelled ${id}.` };
    } catch (error) {
      return { ok: false, orderId: id, message: describeOrderError(error) };
    }
  }

  /**
   * Cap hit: cancel the resting Charts SL/TP on this contract, then MARKET
   * sell whatever quantity is still open so we do not double-exit a fill
   * that the stop already took.
   */
  async flattenChartTrade(
    trade: ChartLiveTrade,
    reason: 'PROFIT' | 'LOSS',
  ): Promise<AtmOrderResult> {
    const extras: string[] = [];
    if (trade.slOrderId) {
      extras.push((await this.cancelChartOrder(trade.slOrderId)).message);
    }
    if (trade.tpOrderId) {
      extras.push((await this.cancelChartOrder(trade.tpOrderId)).message);
    }

    const live = await this.chartLiveTrades();
    const latest = live?.find((row) => row.instrument === trade.instrument) ?? trade;
    const qty = latest.qty > 0 && latest.status === 'OPEN' ? latest.qty : 0;
    const label = reason === 'PROFIT' ? 'Max profit' : 'Max loss';
    if (!(qty > 0)) {
      return {
        ok: true,
        orderId: null,
        message: `${label} — already flat on ${trade.instrument}. ${extras.join(' ')}`.trim(),
      };
    }

    const sell = await this.placeExit(latest, qty);
    return {
      ok: sell.ok,
      orderId: sell.orderId,
      message: `${label} — ${sell.message}${extras.length ? ' · ' + extras.join(' ') : ''}`,
    };
  }

  private async placeExit(trade: ChartLiveTrade, qty: number): Promise<AtmOrderResult> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      return { ok: false, orderId: null, message: 'Kite session required.' };
    }
    const fields = atmExitFields({
      instrument: trade.instrument,
      exchange: trade.exchange,
      qty,
    });
    if (!fields) {
      return { ok: false, orderId: null, message: 'Could not build an exit for that fill.' };
    }
    try {
      const res = (await firstValueFrom(this.kiteApi.placeRegularOrder(authorization, fields))) as {
        status?: string;
        message?: string;
        data?: { order_id?: string };
      };
      const orderId = res?.data?.order_id ?? null;
      if (orderId) {
        return { ok: true, orderId, message: `sold ${trade.instrument} qty ${qty} (${orderId}).` };
      }
      return {
        ok: false,
        orderId: null,
        message: res?.message || 'Kite returned no exit order id. Check the order book.',
      };
    } catch (error) {
      return { ok: false, orderId: null, message: describeOrderError(error) };
    }
  }

  /**
   * Today's Charts ATM fills with the resting stop and target, read from Kite.
   * Null when there is no session — the board should say to connect, not invent rows.
   */
  async chartLiveTrades(): Promise<ChartLiveTrade[] | null> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) return null;
    try {
      const [orderRes, posRes] = await Promise.all([
        firstValueFrom(this.kiteApi.getOrders(authorization)),
        firstValueFrom(this.kiteApi.getPositions(authorization)),
      ]);
      return buildChartLiveTrades(extractKiteOrders(orderRes), extractKitePositions(posRes));
    } catch {
      return [];
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeOrderError(error: unknown): string {
  const body = (error as { error?: { message?: string } } | null)?.error;
  if (body?.message) return body.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Order failed. Check the order book before retrying.';
}

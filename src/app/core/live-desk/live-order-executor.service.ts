import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { extractKiteApiError } from '../utils/kite-error.util';
import { PaperOptionContract } from '../paper-desk/paper-desk.models';
import { liveOpenMatchesBroker } from './live-open-match.util';
import { resolveExitSellQty } from './live-exit-guard.util';
import { computeProtectiveSlTrigger } from './option-sl-premium.util';
import {
  mergeSummaryRows,
  summaryRowsFromKiteOrderBook,
} from './kite-order-book-fills.util';
import { isSameBarReentry, sameBarReentryReason } from './reentry-cooldown.util';

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
  /** open = live long; exiting = close in flight; flat/error = done. */
  status: 'open' | 'exiting' | 'flat' | 'error';
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
  action:
    | 'ENTRY'
    | 'SL'
    | 'MODIFY_SL'
    | 'CANCEL_SL'
    | 'EXIT'
    | 'HOLD'
    | 'ADOPT'
    | 'SKIP'
    | 'ERROR';
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
  order_timestamp?: string;
  exchange_timestamp?: string;
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

export { liveOpenMatchesBroker } from './live-open-match.util';

/**
 * Live money executor (addon):
 * 1) MARKET BUY entry (CE/PE long only — never short entry)
 * 2) Protective SL-M SELL (Kite exits if SL hits; we do not double-exit)
 * 3) Cutoff / target → cancel pending SL-M → MARKET SELL only to close broker long
 * 4) If SL already COMPLETE or broker qty=0 → flat, no second SELL (no naked short)
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
  /** Bar time of the last leg closed per instrument — blocks same-candle re-entry. */
  private readonly lastExitBarByInstrument = new Map<string, string>();
  private readonly sameBarReentryLogged = new Set<string>();
  /** Number of lots (exchange lot size × this). Testing never uses this. */
  private lotsMultiplier = 1;
  /** Per-desk-instrument lots so Nifty / Bank / Crude can differ on one Live run. */
  private readonly lotsByInstrument = new Map<string, number>();
  /** Symbols with an exit in flight — blocks duplicate SELL (naked short). */
  private readonly exitingSymbols = new Set<string>();

  reset(): void {
    this.positions.clear();
    this.positionsBySymbol.clear();
    this.events.length = 0;
    this.summary.clear();
    this.exitingSymbols.clear();
    this.lotsByInstrument.clear();
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
        const sym = pos.tradingSymbol.toUpperCase();
        this.positionsBySymbol.delete(sym);
        this.exitingSymbols.delete(sym);
      }
      this.positions.delete(id);
      this.summary.delete(id);
      this.lotsByInstrument.delete(id);
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

  /** Per-instrument lots for mixed Trade Desk books (overrides global multiplier). */
  setLotsForInstrument(instrumentId: string, lots: number): void {
    this.lotsByInstrument.set(instrumentId, Math.max(1, Math.floor(lots) || 1));
  }

  private lotsFor(instrumentId: string): number {
    return this.lotsByInstrument.get(instrumentId) ?? this.lotsMultiplier;
  }

  getPositions(): LiveBrokerPosition[] {
    return [...this.positions.values()];
  }

  /**
   * True when Kite already holds this leg — by desk instrument or by symbol
   * (adopted orphans are keyed by symbol until the desk remaps them).
   */
  hasOpenPositionFor(instrumentId: string, tradingSymbol?: string | null): boolean {
    if (this.positions.get(instrumentId)?.status === 'open') {
      return true;
    }
    const sym = (tradingSymbol ?? '').toUpperCase();
    return !!sym && this.positionsBySymbol.get(sym)?.status === 'open';
  }

  getEvents(): LiveOrderEvent[] {
    return [...this.events];
  }

  getOrderSummary(): LiveOrderSummaryRow[] {
    return [...this.summary.values()].sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * Pull today's PALAGAI fills back from Kite so a refresh/restart cannot drop
   * earlier legs out of Profit ₹. Kite order book is the record of truth.
   */
  async importFillsFromBroker(authorization: string): Promise<number> {
    const orders = await this.fetchOrders(authorization);
    if (!orders.length) {
      return 0;
    }
    const brokerRows = summaryRowsFromKiteOrderBook(orders, this.instrumentNames);
    if (!brokerRows.length) {
      return 0;
    }
    const merged = mergeSummaryRows([...this.summary.values()], brokerRows);
    let added = 0;
    for (const row of merged) {
      const key = row.orderId || row.id;
      if (!this.summary.has(key)) {
        added += 1;
      }
      this.summary.set(key, row);
    }
    return added;
  }

  /**
   * Desk replay closed a leg that never got a Kite ENTRY (blocked / missed tick).
   * Event log only — does not place orders.
   */
  pushDeskSkipEvent(params: {
    instrumentId: string;
    instrumentName?: string;
    detail: string;
    tradingSymbol?: string;
  }): void {
    this.pushEvent({
      at: new Date().toISOString(),
      instrumentId: params.instrumentId,
      instrumentName: params.instrumentName,
      action: 'SKIP',
      detail: params.detail,
      tradingSymbol: params.tradingSymbol,
    });
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
          // Desk direction is the index/futures side: long CE = BUY, long PE = SELL.
          direction: symbol.endsWith('PE') ? 'SELL' : 'BUY',
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
          // Protective SL from default ~30pt index risk when unknown
          const slTrigger = computeProtectiveSlTrigger({
            fillPremium: entryAvg,
            indexRiskPts: exchange === 'MCX' ? 15 : 30,
            exchange,
            tradingSymbol: symbol,
          });
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
    /** Optional per-book lots (Nifty / Bank / Crude can differ). */
    lots?: number;
    /**
     * Paper exit reason for close sync (open=null).
     * "Profit drained" + option LTP still below entry → hold for SL-M instead of
     * market-dumping a red option while index trail says green.
     */
    closeReason?: string | null;
  }): Promise<void> {
    this.instrumentNames.set(params.instrumentId, params.instrumentName);
    if (params.lots != null) {
      this.setLotsForInstrument(params.instrumentId, params.lots);
    }
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

    // Exit already in flight — wait only while the lock is held. If status is stuck
    // on 'exiting' after the lock cleared (bug / API fail), recover so the next
    // paper signal can placeEntry (otherwise the book is dead until Live restart).
    if (current?.status === 'exiting') {
      const sym = (current.tradingSymbol || '').toUpperCase();
      if (sym && this.exitingSymbols.has(sym)) {
        await this.refreshSummaryStatuses(params.authorization);
        return;
      }
      const brokerQty = sym
        ? await this.readBrokerLongQty(params.authorization, current)
        : 0;
      if (brokerQty != null && brokerQty > 0) {
        // Still long at broker — finish the exit next, don't start a second SELL race.
        await this.refreshSummaryStatuses(params.authorization);
        return;
      }
      this.positions.set(params.instrumentId, {
        ...current,
        status: 'flat',
        lastError: null,
      });
      if (sym) {
        this.positionsBySymbol.delete(sym);
      }
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: params.instrumentId,
        instrumentName: params.instrumentName,
        action: 'EXIT',
        detail: `Recovered stuck exiting state for ${current.tradingSymbol || params.instrumentId} — marked flat for re-entry`,
        tradingSymbol: current.tradingSymbol,
        quantity: current.quantity,
      });
      current = this.positions.get(params.instrumentId) ?? null;
    } else if (
      current?.tradingSymbol &&
      this.exitingSymbols.has(current.tradingSymbol.toUpperCase())
    ) {
      await this.refreshSummaryStatuses(params.authorization);
      return;
    }

    if (current?.status === 'open') {
      const beforeSl = current;
      const slState = await this.refreshSlState(params.authorization, current);
      if (slState === 'filled') {
        await this.refreshSummaryStatuses(params.authorization);
        current = this.positions.get(params.instrumentId) ?? null;
        // Paper may still show the SL'd leg open for one bar — do not re-buy it.
        const closedSym = (beforeSl.tradingSymbol || '').toUpperCase();
        const openSym = (open?.option?.tradingSymbol || '').toUpperCase();
        const sameLeg =
          !!open &&
          !!closedSym &&
          closedSym === openSym &&
          (!beforeSl.entryTime || beforeSl.entryTime === open.entryTime);
        if (sameLeg || !open) {
          return;
        }
        // Different / newer paper signal — fall through to placeEntry on flat.
      } else {
        current = this.positions.get(params.instrumentId) ?? current;
      }
    }

    // Open paper + open broker:
    //  - same contract → amend SL if index stop moved (BE / trail)
    //  - different contract (Kutty→Strat / new strike) → exit then enter
    if (open && current?.status === 'open') {
      if (liveOpenMatchesBroker(current, open)) {
        await this.syncProtectiveSl(params.authorization, current, open);
        await this.refreshSummaryStatuses(params.authorization);
        return;
      }
      // A contract switch inside a candle we already traded is churn, not a
      // handoff. Hold what we have and let the existing SL work.
      if (
        isSameBarReentry({
          signalEntryTime: open.entryTime,
          lastExitEntryTime: this.lastExitBarByInstrument.get(params.instrumentId),
        })
      ) {
        await this.syncProtectiveSl(params.authorization, current, open);
        await this.refreshSummaryStatuses(params.authorization);
        return;
      }
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: params.instrumentId,
        instrumentName: params.instrumentName,
        action: 'EXIT',
        detail: `Handoff — paper flipped contract · was ${current.tradingSymbol} @ ${current.entryTime} → ${open.option?.tradingSymbol ?? '?'} @ ${open.entryTime}`,
        tradingSymbol: current.tradingSymbol,
        quantity: current.quantity,
      });
      await this.placeExit(params.authorization, current);
      await this.placeEntry(params.authorization, params.instrumentId, open);
      await this.refreshSummaryStatuses(params.authorization);
      return;
    }

    if (open && (!current || current.status === 'flat' || current.status === 'error')) {
      if (
        isSameBarReentry({
          signalEntryTime: open.entryTime,
          lastExitEntryTime: this.lastExitBarByInstrument.get(params.instrumentId),
        })
      ) {
        const key = `${params.instrumentId}:${open.entryTime}`;
        if (!this.sameBarReentryLogged.has(key)) {
          this.sameBarReentryLogged.add(key);
          this.pushEvent({
            at: new Date().toISOString(),
            instrumentId: params.instrumentId,
            instrumentName: params.instrumentName,
            action: 'SKIP',
            detail: sameBarReentryReason(
              open.entryTime,
              this.lastExitBarByInstrument.get(params.instrumentId),
            ),
            tradingSymbol: open.option?.tradingSymbol,
          });
        }
        await this.refreshSummaryStatuses(params.authorization);
        return;
      }
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
      const held = await this.maybeHoldDrainWhileOptionRed(
        params.authorization,
        current,
        params.closeReason,
      );
      if (!held) {
        await this.placeExit(params.authorization, current);
      }
      await this.refreshSummaryStatuses(params.authorization);
      return;
    }

    await this.refreshSummaryStatuses(params.authorization);
  }

  /**
   * Index/futures peak-trail can arm on pts×₹30/65 while the ATM option never made
   * that money. Market-exiting on "Profit drained" then books option losses with a
   * green fut label — owner "same issue". Hold and let SL-M work when option is red.
   */
  private async maybeHoldDrainWhileOptionRed(
    authorization: string,
    pos: LiveBrokerPosition,
    closeReason: string | null | undefined,
  ): Promise<boolean> {
    const reason = (closeReason ?? '').toLowerCase();
    if (!reason.includes('profit drained')) {
      return false;
    }
    const fill = pos.entryPremium ?? 0;
    if (!(fill > 0) || !pos.tradingSymbol) {
      return false;
    }
    const exchange = (pos.exchange === 'MCX' ? 'MCX' : 'NFO') as 'NFO' | 'MCX';
    let ltp: number | null = null;
    try {
      ltp = await this.resolveOptionLtp(authorization, pos.tradingSymbol, exchange, fill);
    } catch {
      ltp = null;
    }
    if (ltp == null || !(ltp > 0) || ltp >= fill - 0.049) {
      return false;
    }

    // Tighten protective SL under current LTP; do not MARKET SELL the red print.
    const fakeOpen: LiveOpenSignal = {
      direction: pos.direction,
      entryTime: pos.entryTime,
      indexEntry: pos.indexEntry ?? 0,
      // Keep broker stop at last known index stop (already trail-ratcheted on paper).
      indexStop: pos.indexStop ?? 0,
      option: {
        tradingSymbol: pos.tradingSymbol,
        instrumentToken: pos.instrumentToken,
        strike: 0,
        expiry: '',
        optionType: 'CE',
        lotSize: Math.max(1, pos.quantity),
        source: 'chain',
        exchange,
        product: pos.product,
      },
      optionEntryPremium: fill,
    };
    await this.syncProtectiveSl(authorization, pos, fakeOpen);
    this.pushEvent({
      at: new Date().toISOString(),
      instrumentId: pos.instrumentId,
      action: 'HOLD',
      detail:
        `Index profit-drained but option LTP ${ltp.toFixed(2)} < entry ${fill.toFixed(2)} — ` +
        `hold for SL-M (no market dump)`,
      tradingSymbol: pos.tradingSymbol,
      quantity: pos.quantity,
    });
    return true;
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
        detail:
          'No tradeable chain option (synthetic/missing) — real order blocked. ' +
          'Nifty weeklies expire Tuesday; refresh Instruments then restart Live money.',
        tradingSymbol: option?.tradingSymbol,
      });
      this.positions.set(instrumentId, this.errorPos(instrumentId, open, option, 'Synthetic/missing option'));
      return;
    }

    const symUpper = option.tradingSymbol.toUpperCase();
    const exchange: 'NFO' | 'MCX' =
      option.exchange ??
      (symUpper.startsWith('CRUDEOIL') || symUpper.startsWith('NATURALGAS') || symUpper.startsWith('NATGAS')
        ? 'MCX'
        : 'NFO');
    // qty = exchange lot size × configured lots (Live money only).
    // Crude options: never place qty=1 when lot is 10 (today's book showed qty=1 vs Positions ×10 ₹).
    const lotSize =
      exchange === 'MCX' && symUpper.startsWith('CRUDEOIL')
        ? Math.max(10, Math.floor(option.lotSize || 10) || 10)
        : Math.max(1, option.lotSize || 1);
    const lotsMult = this.lotsFor(instrumentId);
    const quantity = lotSize * lotsMult;
    // Crude/energy options: prefer MIS (Zerodha allows MIS on energy MCX options).
    const product =
      option.product ??
      (exchange === 'MCX' ? 'MIS' : 'MIS');
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
        detail: `BUY ${quantity} ${option.tradingSymbol} ${product} MARKET (${lotsMult} lot × ${lotSize})`,
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
      const ltp = await this.resolveOptionLtp(
        authorization,
        option.tradingSymbol,
        exchange,
        fillPremium,
      );
      const slTrigger = computeProtectiveSlTrigger({
        fillPremium,
        indexRiskPts: indexRisk,
        exchange,
        tradingSymbol: option.tradingSymbol,
        ltp,
      });

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
          detail: `SL-M SELL ${quantity} ${option.tradingSymbol} trigger ${slTrigger} (index risk ${indexRisk.toFixed(1)} · ${exchange} Δ)`,
          orderId: slOrderId,
          tradingSymbol: option.tradingSymbol,
          quantity,
          triggerPrice: slTrigger,
        });
      } catch (slErr) {
        // Place may have succeeded on Kite while the response was lost (Failed to fetch).
        const recoveredId = await this.adoptPendingSlFromBook(
          authorization,
          instrumentId,
          option.tradingSymbol,
          quantity,
        );
        if (recoveredId) {
          slOrderId = recoveredId;
          this.pushEvent({
            at: new Date().toISOString(),
            instrumentId,
            action: 'SL',
            detail: `Recovered pending SL-M after place response lost (${this.formatErr(slErr)})`,
            orderId: recoveredId,
            tradingSymbol: option.tradingSymbol,
            quantity,
            triggerPrice: slTrigger,
          });
        } else {
          this.pushEvent({
            at: new Date().toISOString(),
            instrumentId,
            action: 'ERROR',
            detail: `Entry filled but SL-M failed: ${this.formatErr(slErr)} — exit will cancel any pending SL then MARKET`,
            tradingSymbol: option.tradingSymbol,
            quantity,
          });
        }
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
    // Always fetch LTP on amend so peak-trail cannot slam SL into the print (₹8–10 tuck).
    let ltp: number | null = null;
    try {
      const exchange = (pos.exchange === 'MCX' ? 'MCX' : 'NFO') as 'NFO' | 'MCX';
      ltp = await this.resolveOptionLtp(
        authorization,
        pos.tradingSymbol,
        exchange,
        fillPremium,
      );
    } catch {
      ltp = null;
    }
    const nextTrigger = computeProtectiveSlTrigger({
      fillPremium,
      indexRiskPts: indexRisk,
      exchange: pos.exchange,
      tradingSymbol: pos.tradingSymbol,
      ltp,
    });
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
      const recoveredId = await this.adoptPendingSlFromBook(
        authorization,
        pos.instrumentId,
        pos.tradingSymbol,
        pos.quantity,
      );
      if (recoveredId) {
        const updated: LiveBrokerPosition = {
          ...pos,
          slOrderId: recoveredId,
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
          detail: `Recovered pending SL-M after place response lost (${this.formatErr(err)})`,
          orderId: recoveredId,
          tradingSymbol: pos.tradingSymbol,
          quantity: pos.quantity,
          triggerPrice: slTrigger,
        });
        return true;
      }
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
   * If SL place response was lost, pick up a pending protective SELL SL-M for this symbol.
   */
  private async adoptPendingSlFromBook(
    authorization: string,
    instrumentId: string,
    tradingSymbol: string,
    quantity: number,
  ): Promise<string | null> {
    const orders = await this.fetchOrders(authorization);
    const pending = findAllPendingOptionSl(orders, tradingSymbol);
    const match =
      pending.find((o) => Number(o.quantity ?? 0) === quantity) ?? pending[0] ?? null;
    return match?.order_id ?? null;
  }

  /**
   * Before MARKET exit: cancel every pending protective SL-M for this symbol.
   * Covers known slOrderId and ghost SLs (place succeeded, response lost).
   * Returns 'filled' when the known SL already completed (position already flat).
   */
  private async cancelPendingSlBeforeExit(
    authorization: string,
    pos: LiveBrokerPosition,
  ): Promise<'filled' | 'cleared'> {
    const orders = await this.fetchOrders(authorization);
    const cancelIds = new Set<string>();

    if (pos.slOrderId) {
      const known = orders.find((o) => o.order_id === pos.slOrderId);
      const knownStatus = (known?.status ?? (await this.getOrderStatus(authorization, pos.slOrderId))) ?? null;
      if (knownStatus === 'COMPLETE') {
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
          detail: `Protective SL-M already filled — no MARKET exit needed`,
          orderId: pos.slOrderId,
          tradingSymbol: pos.tradingSymbol,
          quantity: pos.quantity,
        });
        return 'filled';
      }
      if (knownStatus && isCancellable(knownStatus)) {
        cancelIds.add(pos.slOrderId);
      }
    }

    for (const row of findAllPendingOptionSl(orders, pos.tradingSymbol)) {
      if (row.order_id) {
        cancelIds.add(row.order_id);
      }
    }

    for (const orderId of cancelIds) {
      try {
        const status =
          orders.find((o) => o.order_id === orderId)?.status ??
          (await this.getOrderStatus(authorization, orderId));
        if (status === 'COMPLETE') {
          continue;
        }
        if (status && !isCancellable(status)) {
          continue;
        }
        await firstValueFrom(this.kiteApi.cancelRegularOrder(authorization, orderId));
        this.pushEvent({
          at: new Date().toISOString(),
          instrumentId: pos.instrumentId,
          action: 'CANCEL_SL',
          detail: `Cancelled pending SL-M before strategy exit (${status ?? 'book'})`,
          orderId,
          tradingSymbol: pos.tradingSymbol,
          quantity: pos.quantity,
        });
      } catch (err) {
        this.pushEvent({
          at: new Date().toISOString(),
          instrumentId: pos.instrumentId,
          action: 'ERROR',
          detail: `Cancel SL-M ${orderId} failed: ${this.formatErr(err)} — will still try MARKET exit`,
          orderId,
          tradingSymbol: pos.tradingSymbol,
          quantity: pos.quantity,
        });
      }
    }

    if (cancelIds.size > 0) {
      await delay(400);
      this.positions.set(pos.instrumentId, {
        ...pos,
        slOrderId: null,
        slTrigger: null,
      });
    }

    return 'cleared';
  }

  /**
   * Cutoff / target exit: cancel pending SL-M, then MARKET SELL only if broker still long.
   * Never naked-shorts CE/PE. Concurrent duplicate exits are blocked per symbol.
   */
  private async placeExit(authorization: string, pos: LiveBrokerPosition): Promise<void> {
    const sym = pos.tradingSymbol.toUpperCase();
    const latest = this.positions.get(pos.instrumentId) ?? pos;
    if (latest.status !== 'open') {
      return;
    }
    if (this.exitingSymbols.has(sym)) {
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'SKIP',
        detail: `Exit already in flight for ${pos.tradingSymbol} — skip duplicate SELL`,
        tradingSymbol: pos.tradingSymbol,
        quantity: pos.quantity,
      });
      return;
    }

    this.exitingSymbols.add(sym);
    // Remember which bar we just traded so the next signal in the same candle
    // cannot re-enter and pay the spread again.
    this.lastExitBarByInstrument.set(pos.instrumentId, latest.entryTime);
    const exitingPos: LiveBrokerPosition = { ...latest, status: 'exiting', lastError: null };
    this.positions.set(pos.instrumentId, exitingPos);
    this.positionsBySymbol.set(sym, exitingPos);

    try {
      const slGate = await this.cancelPendingSlBeforeExit(authorization, exitingPos);
      if (slGate === 'filled') {
        return;
      }
      // Re-read in case cancel / SL fill updated memory.
      pos = this.positions.get(pos.instrumentId) ?? exitingPos;
      if (pos.status === 'flat') {
        return;
      }

      const brokerLongQty = await this.readBrokerLongQty(authorization, pos);
      let sellQty: number | null;
      if (brokerLongQty == null) {
        // Positions API failed — only skip if order book already shows a completed close.
        if (await this.hasCompletedCloseSell(authorization, pos)) {
          this.positions.set(pos.instrumentId, {
            ...pos,
            slOrderId: null,
            status: 'flat',
            lastError: null,
          });
          this.positionsBySymbol.delete(sym);
          this.pushEvent({
            at: new Date().toISOString(),
            instrumentId: pos.instrumentId,
            action: 'EXIT',
            detail: `Close already COMPLETE in order book for ${pos.tradingSymbol} — skip duplicate SELL`,
            tradingSymbol: pos.tradingSymbol,
            quantity: pos.quantity,
          });
          return;
        }
        sellQty = Math.max(0, Math.floor(pos.quantity) || 0) || null;
      } else {
        sellQty = resolveExitSellQty(brokerLongQty, pos.quantity);
        if (sellQty == null) {
          this.positions.set(pos.instrumentId, {
            ...pos,
            slOrderId: null,
            status: 'flat',
            lastError: null,
          });
          this.positionsBySymbol.delete(sym);
          this.pushEvent({
            at: new Date().toISOString(),
            instrumentId: pos.instrumentId,
            action: 'EXIT',
            detail:
              `Already flat at broker (${pos.tradingSymbol} long qty ${brokerLongQty}) — skip SELL (no naked short)`,
            tradingSymbol: pos.tradingSymbol,
            quantity: pos.quantity,
          });
          return;
        }
      }
      if (sellQty == null) {
        // Positions API failed and remembered qty is 0 — never leave status 'exiting'
        // (that permanently blocks placeEntry until Live restart).
        this.positions.set(pos.instrumentId, {
          ...pos,
          slOrderId: null,
          status: 'flat',
          lastError: null,
        });
        this.positionsBySymbol.delete(sym);
        this.pushEvent({
          at: new Date().toISOString(),
          instrumentId: pos.instrumentId,
          action: 'EXIT',
          detail:
            `No sell qty for ${pos.tradingSymbol} (broker qty unknown · remembered 0) — marked flat`,
          tradingSymbol: pos.tradingSymbol,
          quantity: pos.quantity,
        });
        return;
      }

      const response = await firstValueFrom(
        this.kiteApi.placeRegularOrder(authorization, {
          exchange: pos.exchange ?? 'NFO',
          tradingsymbol: pos.tradingSymbol,
          transaction_type: 'SELL',
          order_type: 'MARKET',
          quantity: String(sellQty),
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
        quantity: sellQty,
        slOrderId: null,
        exitOrderId: orderId,
        status: 'flat',
        lastError: null,
      });
      this.positionsBySymbol.delete(sym);
      this.pushEvent({
        at: new Date().toISOString(),
        instrumentId: pos.instrumentId,
        action: 'EXIT',
        detail: `SELL ${sellQty} ${pos.tradingSymbol} ${pos.product ?? 'MIS'} MARKET (close long · cutoff/target)`,
        orderId,
        tradingSymbol: pos.tradingSymbol,
        quantity: sellQty,
      });
    } catch (err) {
      const message = this.formatErr(err);
      const cur = this.positions.get(pos.instrumentId) ?? pos;
      this.positions.set(pos.instrumentId, {
        ...cur,
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
    } finally {
      this.exitingSymbols.delete(sym);
      // Safety net: never leave a book stuck on 'exiting' after the lock is gone.
      const cur = this.positions.get(pos.instrumentId);
      if (cur?.status === 'exiting') {
        this.positions.set(pos.instrumentId, {
          ...cur,
          status: 'flat',
          lastError: null,
        });
        this.positionsBySymbol.delete(sym);
        this.pushEvent({
          at: new Date().toISOString(),
          instrumentId: pos.instrumentId,
          action: 'EXIT',
          detail: `Exit path left ${pos.tradingSymbol} stuck exiting — forced flat for re-entry`,
          tradingSymbol: pos.tradingSymbol,
          quantity: pos.quantity,
        });
      }
    }
  }

  /** Net long qty at broker for this option (same symbol + product). null = API failed. */
  private async readBrokerLongQty(
    authorization: string,
    pos: LiveBrokerPosition,
  ): Promise<number | null> {
    try {
      const book = (await firstValueFrom(
        this.kiteApi.getPositions(authorization),
      )) as KitePositionsBook;
      const rows = [...(book.data?.net ?? []), ...(book.data?.day ?? [])];
      const sym = pos.tradingSymbol.toUpperCase();
      const product = (pos.product ?? 'MIS').toUpperCase();
      let best = 0;
      for (const row of rows) {
        if ((row.tradingsymbol ?? '').toUpperCase() !== sym) {
          continue;
        }
        if ((row.product ?? '').toUpperCase() !== product) {
          continue;
        }
        const qty = Number(row.quantity ?? 0);
        if (qty > best) {
          best = qty;
        }
      }
      return best;
    } catch {
      return null;
    }
  }

  /** True if a PALAGAI close SELL already COMPLETE for this leg (after entry). */
  private async hasCompletedCloseSell(
    authorization: string,
    pos: LiveBrokerPosition,
  ): Promise<boolean> {
    if (pos.exitOrderId) {
      return true;
    }
    try {
      const orders = await this.fetchOrders(authorization);
      const sym = pos.tradingSymbol.toUpperCase();
      const entryMs = Date.parse(pos.entryTime) || 0;
      return orders.some((o) => {
        if ((o.tradingsymbol ?? '').toUpperCase() !== sym) {
          return false;
        }
        if ((o.transaction_type ?? '').toUpperCase() !== 'SELL') {
          return false;
        }
        if ((o.status ?? '').toUpperCase() !== 'COMPLETE') {
          return false;
        }
        if (!isPalagaiTag(o.tag)) {
          return false;
        }
        if (!(Number(o.quantity ?? 0) > 0)) {
          return false;
        }
        const ts = Date.parse(o.order_timestamp || o.exchange_timestamp || '') || 0;
        // Only count closes from this leg (after entry), not earlier same-day trades.
        return entryMs <= 0 || ts >= entryMs - 2000;
      });
    } catch {
      return false;
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
      this.lastExitBarByInstrument.set(pos.instrumentId, pos.entryTime);
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

  private async resolveOptionLtp(
    authorization: string,
    tradingSymbol: string,
    exchange: 'NFO' | 'MCX',
    fallback: number | null,
  ): Promise<number | null> {
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
    return fallback != null && fallback > 0 ? fallback : null;
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
  return findAllPendingOptionSl(orders, symbol)[0];
}

/** All cancellable protective SELL SL/SL-M orders for a symbol (ghost SLs included). */
function findAllPendingOptionSl(orders: KiteOrderRow[], symbol: string): KiteOrderRow[] {
  const sym = symbol.toUpperCase();
  return orders.filter((o) => {
    if ((o.tradingsymbol ?? '').toUpperCase() !== sym) return false;
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

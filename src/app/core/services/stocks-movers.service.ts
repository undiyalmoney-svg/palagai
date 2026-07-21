/**
 * Live NSE movers: quote Nifty-universe, rank top gainers / losers, resolve instruments.
 */
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { InstrumentStoreService } from './instrument-store.service';

/** Liquid NSE EQ scan set (Nifty-ish). */
export const STOCKS_SCAN_UNIVERSE: string[] = [
  'ADANIENT',
  'ADANIPORTS',
  'APOLLOHOSP',
  'ASIANPAINT',
  'AXISBANK',
  'BAJAJ-AUTO',
  'BAJAJFINSV',
  'BAJFINANCE',
  'BEL',
  'BHARTIARTL',
  'BPCL',
  'BRITANNIA',
  'CIPLA',
  'COALINDIA',
  'DIVISLAB',
  'DRREDDY',
  'EICHERMOT',
  'GRASIM',
  'HCLTECH',
  'HDFCBANK',
  'HDFCLIFE',
  'HEROMOTOCO',
  'HINDALCO',
  'HINDUNILVR',
  'ICICIBANK',
  'INDIGO',
  'INDUSINDBK',
  'INFY',
  'ITC',
  'JSWSTEEL',
  'KOTAKBANK',
  'LT',
  'M&M',
  'MARUTI',
  'NESTLEIND',
  'NTPC',
  'ONGC',
  'POWERGRID',
  'RELIANCE',
  'SBILIFE',
  'SBIN',
  'SUNPHARMA',
  'TATACONSUM',
  'TATASTEEL',
  'TCS',
  'TECHM',
  'TITAN',
  'TRENT',
  'ULTRACEMCO',
  'WIPRO',
];

export interface StocksMover {
  symbol: string;
  name: string;
  instrumentToken: number;
  lastPrice: number;
  open: number;
  prevClose: number;
  /** (last - prevClose) / prevClose */
  dayChangePct: number;
  /** (open - prevClose) / prevClose */
  gapPct: number;
  volume: number;
}

export interface StocksMoversSnapshot {
  fetchedAt: string;
  gainers: StocksMover[];
  losers: StocksMover[];
  scanned: number;
  message: string;
}

interface KiteQuoteRow {
  instrument_token?: number;
  last_price?: number;
  net_change?: number;
  volume?: number;
  ohlc?: { open?: number; high?: number; low?: number; close?: number };
}

@Injectable({ providedIn: 'root' })
export class StocksMoversService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly instruments = inject(InstrumentStoreService);

  readonly snapshot = signal<StocksMoversSnapshot>({
    fetchedAt: '',
    gainers: [],
    losers: [],
    scanned: 0,
    message: 'Idle',
  });

  /**
   * Quote scan universe in batches, return top gainers / losers.
   * Also usable to seed live entry candidates.
   */
  async refreshMovers(options?: { topN?: number }): Promise<StocksMoversSnapshot> {
    const topN = options?.topN ?? 10;
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      throw new Error('Kite access token required. Generate token in Get Token tab.');
    }
    await this.instruments.ensureLoaded();

    const keys: string[] = [];
    const meta = new Map<string, { symbol: string; name: string; token: number }>();

    for (const sym of STOCKS_SCAN_UNIVERSE) {
      const hit = this.resolveNseEq(sym);
      if (!hit) continue;
      const key = `NSE:${hit.tradingSymbol}`;
      keys.push(key);
      meta.set(key, {
        symbol: hit.tradingSymbol.toUpperCase(),
        name: hit.name || hit.tradingSymbol,
        token: hit.instrumentToken,
      });
    }

    const movers: StocksMover[] = [];
    const batchSize = 40;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const body = (await firstValueFrom(this.kiteApi.getQuotes(authorization, batch))) as {
        status?: string;
        data?: Record<string, KiteQuoteRow>;
        message?: string;
      };
      if (body.status === 'error') {
        throw new Error(body.message || 'Kite quote failed');
      }
      const data = body.data ?? {};
      for (const key of batch) {
        const q = data[key];
        const m = meta.get(key);
        if (!q || !m) continue;
        const prevClose = Number(q.ohlc?.close ?? 0);
        const open = Number(q.ohlc?.open ?? 0);
        const last = Number(q.last_price ?? 0);
        if (prevClose <= 0 || last <= 0) continue;
        const dayChangePct = (last - prevClose) / prevClose;
        const gapPct = open > 0 ? (open - prevClose) / prevClose : 0;
        movers.push({
          symbol: m.symbol,
          name: m.name,
          instrumentToken: m.token || Number(q.instrument_token ?? 0),
          lastPrice: last,
          open: open || last,
          prevClose,
          dayChangePct,
          gapPct,
          volume: Number(q.volume ?? 0),
        });
      }
    }

    const gainers = [...movers].sort((a, b) => b.dayChangePct - a.dayChangePct).slice(0, topN);
    const losers = [...movers].sort((a, b) => a.dayChangePct - b.dayChangePct).slice(0, topN);

    const snap: StocksMoversSnapshot = {
      fetchedAt: new Date().toISOString(),
      gainers,
      losers,
      scanned: movers.length,
      message: `Scanned ${movers.length} · top ${topN} gainers/losers`,
    };
    this.snapshot.set(snap);
    return snap;
  }

  resolveNseEq(symbol: string): { tradingSymbol: string; name: string; instrumentToken: number } | null {
    const q = symbol.trim().toUpperCase();
    const hit = this.instruments.findNseEquityExact(q);
    if (!hit) return null;
    return {
      tradingSymbol: hit.tradingSymbol,
      name: hit.name || hit.tradingSymbol,
      instrumentToken: hit.instrumentToken,
    };
  }
}

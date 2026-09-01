import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { Candle, KiteHistoricalResponse, Timeframe } from '../models/candle.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { InstrumentStoreService } from './instrument-store.service';
import { NIFTY_500_UNIVERSE } from './nifty500-universe';
import { ResolvedEquity, resolveNseEquitySymbol } from './stocks-equity-resolve';
import {
  SwingEntrySignal,
  evaluateSwingEntry,
} from '../strategy-engine/strategies/swing-breakout/swing-breakout.evaluator';
import { extractKiteApiError, assertKiteHistoricalSuccess } from '../utils/kite-error.util';
import { mapWithConcurrency } from '../utils/concurrency.util';
import { chunkInclusiveDateRange, kiteMaxDaysForInterval } from '../kite/kite-historical-limits';

/** Pause between chunked historical calls — Kite rate-limits the historical endpoint. */
const INTRADAY_CHUNK_DELAY_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type SymbolResolver = (
  symbol: string,
  authorization: string,
) => Promise<{ tradingSymbol: string; name: string; instrumentToken: number } | null>;

/** ~7 months of calendar days — comfortably covers EMA50 + Donchian20 + swing lookback in trading days. */
const SCAN_LOOKBACK_CALENDAR_DAYS = 220;
/** Kite historical is rate-limited; keep parallel requests modest. */
const SCAN_CONCURRENCY = 3;
const SCAN_BATCH_DELAY_MS = 350;

export interface SwingScanResult extends SwingEntrySignal {
  symbol: string;
  name: string;
  instrumentToken: number;
}

export interface SwingScanProgress {
  done: number;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class SwingScannerService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly instruments = inject(InstrumentStoreService);

  readonly results = signal<SwingScanResult[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly progress = signal<SwingScanProgress>({ done: 0, total: 0 });
  readonly lastScanAt = signal<string | null>(null);
  readonly skippedUnresolved = signal<string[]>([]);
  /** True after the most recent run was scanCustom() rather than scan() — purely cosmetic for the UI. */
  readonly lastScanWasCustom = signal(false);

  readonly lookupResult = signal<ResolvedEquity | null>(null);
  readonly lookupError = signal('');
  readonly lookupBusy = signal(false);

  hasKiteSession(): boolean {
    return !!this.kiteSession.getAuthorizationHeader();
  }

  /** Fetch daily candles for one NSE symbol — reused by scan() and position exit checks. */
  async fetchDailyCandles(symbol: string, days = SCAN_LOOKBACK_CALENDAR_DAYS): Promise<Candle[]> {
    const to = todayIso();
    const from = shiftDays(to, -Math.abs(days));
    return this.fetchDailyCandlesRange(symbol, from, to);
  }

  /**
   * Fetch daily candles by raw instrument token. Needed for things the equity symbol
   * resolver can't reach — notably the NIFTY 50 index used by the market-regime filter.
   */
  async fetchDailyCandlesByToken(token: number, fromDate: string, toDate: string): Promise<Candle[]> {
    const authorization = this.requireAuth();
    return this.fetchCandlesForToken(token, authorization, fromDate, toDate);
  }

  /** Fetch daily candles for one NSE symbol over an explicit [fromDate, toDate] window. */
  async fetchDailyCandlesRange(symbol: string, fromDate: string, toDate: string): Promise<Candle[]> {
    const authorization = this.requireAuth();
    await this.instruments.ensureLoaded();
    const inst = this.instruments.findNseEquityExact(symbol);
    if (inst) {
      return this.fetchCandlesForToken(inst.instrumentToken, authorization, fromDate, toDate);
    }
    // Fast path missed (e.g. a custom symbol added before the cache saw it) — fall back to
    // the robust quote/dump/known-token resolver instead of failing outright.
    const resolved = await resolveNseEquitySymbol({
      symbol,
      authorization,
      kiteApi: this.kiteApi,
      instruments: this.instruments,
    });
    if (!resolved) {
      throw new Error(`Could not resolve NSE symbol "${symbol}".`);
    }
    return this.fetchCandlesForToken(resolved.instrumentToken, authorization, fromDate, toDate);
  }

  /** Scan the built-in universe (default: Nifty 500) — fast local resolve, no extra quote calls. */
  async scan(universe: readonly string[] = NIFTY_500_UNIVERSE): Promise<void> {
    await this.runScan(universe as string[], false, async (symbol) => {
      const inst = this.instruments.findNseEquityExact(symbol);
      return inst
        ? { tradingSymbol: inst.tradingSymbol, name: inst.name || inst.tradingSymbol, instrumentToken: inst.instrumentToken }
        : null;
    });
  }

  /**
   * Scan a user-supplied list of symbols (comma / whitespace separated). Uses the robust
   * quote → dump → known-token resolver so symbols missing from the cached instrument dump
   * still resolve, at the cost of one extra quote call per symbol.
   */
  async scanCustom(rawSymbols: string): Promise<void> {
    const symbols = parseSymbolList(rawSymbols);
    if (!symbols.length) {
      this.error.set('Enter at least one symbol (e.g. RELIANCE, TCS, INFY).');
      return;
    }
    await this.runScan(symbols, true, async (symbol, authorization) => {
      const resolved = await resolveNseEquitySymbol({
        symbol,
        authorization,
        kiteApi: this.kiteApi,
        instruments: this.instruments,
      });
      return resolved;
    });
  }

  /** Resolve a single symbol → instrument token (quote → dump → known-token fallback). */
  async lookupToken(rawSymbol: string): Promise<void> {
    const symbol = rawSymbol.trim().toUpperCase();
    this.lookupError.set('');
    this.lookupResult.set(null);
    if (!symbol) {
      this.lookupError.set('Enter a symbol.');
      return;
    }
    const authorization = this.requireAuthSafe();
    if (!authorization) {
      this.lookupError.set('Kite access token required. Generate token in Get Token tab.');
      return;
    }
    this.lookupBusy.set(true);
    try {
      const resolved = await resolveNseEquitySymbol({
        symbol,
        authorization,
        kiteApi: this.kiteApi,
        instruments: this.instruments,
      });
      if (!resolved) {
        this.lookupError.set(`Could not resolve "${symbol}" — check the spelling.`);
        return;
      }
      this.lookupResult.set(resolved);
    } catch (err) {
      this.lookupError.set(extractKiteApiError(err, 'Instrument lookup'));
    } finally {
      this.lookupBusy.set(false);
    }
  }

  private async runScan(symbols: string[], custom: boolean, resolver: SymbolResolver): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.error.set('');
    this.results.set([]);
    this.skippedUnresolved.set([]);
    const authorization = this.requireAuthSafe();
    if (!authorization) {
      this.error.set('Kite access token required. Generate token in Get Token tab.');
      return;
    }

    this.busy.set(true);
    this.progress.set({ done: 0, total: symbols.length });
    const unresolved: string[] = [];
    const found: SwingScanResult[] = [];

    try {
      await this.instruments.ensureLoaded();

      await mapWithConcurrency(
        symbols,
        SCAN_CONCURRENCY,
        async (symbol) => {
          try {
            const inst = await resolver(symbol, authorization);
            if (!inst) {
              unresolved.push(symbol);
              return;
            }
            const to = todayIso();
            const from = shiftDays(to, -SCAN_LOOKBACK_CALENDAR_DAYS);
            const candles = await this.fetchCandlesForToken(inst.instrumentToken, authorization, from, to);
            const entrySignal = evaluateSwingEntry(candles);
            if (entrySignal) {
              found.push({
                ...entrySignal,
                symbol: inst.tradingSymbol,
                name: inst.name || inst.tradingSymbol,
                instrumentToken: inst.instrumentToken,
              });
            }
          } catch {
            // one bad symbol should not abort the whole scan
          } finally {
            this.progress.update((p) => ({ ...p, done: p.done + 1 }));
          }
        },
        SCAN_BATCH_DELAY_MS,
      );

      found.sort((a, b) => b.volumeRatio - a.volumeRatio);
      this.results.set(found);
      this.skippedUnresolved.set(unresolved);
      this.lastScanAt.set(new Date().toISOString());
      this.lastScanWasCustom.set(custom);
    } catch (err) {
      this.error.set(extractKiteApiError(err, 'Swing scan'));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Intraday candles for one NSE symbol. Kite caps how many calendar days a single
   * historical call may span (100 for 5-minute), so a multi-month window is fetched in
   * chunks and stitched back together.
   */
  async fetchIntradayCandlesRange(
    symbol: string,
    fromDate: string,
    toDate: string,
    interval: Timeframe = '5minute',
  ): Promise<Candle[]> {
    const authorization = this.requireAuth();
    await this.instruments.ensureLoaded();
    let token = this.instruments.findNseEquityExact(symbol)?.instrumentToken;
    if (!token) {
      const resolved = await resolveNseEquitySymbol({
        symbol,
        authorization,
        kiteApi: this.kiteApi,
        instruments: this.instruments,
      });
      if (!resolved) throw new Error(`Could not resolve NSE symbol "${symbol}".`);
      token = resolved.instrumentToken;
    }

    const chunks = chunkInclusiveDateRange(fromDate, toDate, kiteMaxDaysForInterval(interval));
    const out: Candle[] = [];
    for (const chunk of chunks) {
      const part = await this.fetchCandlesForToken(
        token,
        authorization,
        chunk.fromDate,
        chunk.toDate,
        interval,
      );
      out.push(...part);
      await sleep(INTRADAY_CHUNK_DELAY_MS);
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }

  private async fetchCandlesForToken(
    token: number,
    authorization: string,
    from: string,
    to: string,
    interval: Timeframe = 'day',
  ): Promise<Candle[]> {
    const response = await firstValueFrom(
      this.kiteApi
        .getHistoricalData({
          instrumentToken: String(token),
          interval,
          from: `${from} 09:00:00`,
          to: `${to} 15:30:00`,
          authorization,
        })
        .pipe(timeout(45_000)),
    );
    assertKiteHistoricalSuccess(response as KiteHistoricalResponse, interval);
    const rows = (response as KiteHistoricalResponse).data?.candles ?? [];
    const candles: Candle[] = rows.map((row) => ({
      date: String(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5] ?? 0),
    }));
    candles.sort((a, b) => a.date.localeCompare(b.date));
    return candles;
  }

  private requireAuth(): string {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      throw new Error('Kite access token required. Generate token in Get Token tab.');
    }
    return authorization;
  }

  private requireAuthSafe(): string | null {
    try {
      return this.requireAuth();
    } catch {
      return null;
    }
  }
}

function parseSymbolList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const symbol = part.trim().toUpperCase();
    if (symbol && !seen.has(symbol)) {
      seen.add(symbol);
      out.push(symbol);
    }
  }
  return out;
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function shiftDays(fromIso: string, delta: number): string {
  const d = new Date(`${fromIso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Instrument, InstrumentMetadata } from '../models/instrument.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { parseKiteInstrumentsCsv } from '../utils/csv.util';
import { formatUnknownError } from '../utils/kite-error.util';
import { slimTradingInstruments } from '../utils/trading-instruments-slim.util';
import { countIndexOptions } from '../utils/option-chain.util';

const STORAGE_KEY = 'palagai_instruments';
const META_KEY = 'palagai_instruments_meta';

@Injectable({ providedIn: 'root' })
export class InstrumentStoreService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);

  private readonly instruments = signal<Instrument[]>(this.readInstruments());
  private readonly metadata = signal<InstrumentMetadata>(this.readMetadata());

  readonly allInstruments = this.instruments.asReadonly();
  readonly instrumentMetadata = this.metadata.asReadonly();

  search(query: string, limit = 100): Instrument[] {
    const q = query.trim().toLowerCase();
    if (!q) {
      return this.instruments().slice(0, limit);
    }
    return this.instruments()
      .filter(
        (item) =>
          item.tradingSymbol.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          String(item.instrumentToken).includes(q),
      )
      .slice(0, limit);
  }

  /**
   * Resolve NSE cash equity by exact tradingsymbol (e.g. CANBK, RELIANCE).
   * Scans the full dump — not capped — so NFO options don't hide the EQ row.
   */
  findNseEquityExact(symbol: string): Instrument | undefined {
    const q = symbol.trim().toUpperCase();
    if (!q) return undefined;
    const list = this.instruments();
    // Prefer true cash EQ / BE (SME) with no expiry
    const cash = list.find(
      (i) =>
        i.exchange === 'NSE' &&
        i.tradingSymbol.toUpperCase() === q &&
        (i.instrumentType === 'EQ' || i.instrumentType === 'BE') &&
        !i.expiry,
    );
    if (cash) return cash;
    // Fallback: any NSE row with exact symbol and no option-like type
    return list.find(
      (i) =>
        i.exchange === 'NSE' &&
        i.tradingSymbol.toUpperCase() === q &&
        !i.expiry &&
        i.instrumentType !== 'CE' &&
        i.instrumentType !== 'PE' &&
        i.instrumentType !== 'FUT',
    );
  }

  getByToken(token: number): Instrument | undefined {
    return this.instruments().find((item) => item.instrumentToken === token);
  }

  async ensureLoaded(): Promise<void> {
    if (this.instruments().length > 0 && this.isRefreshedToday()) {
      return;
    }

    // Use stale cache when offline — only hard-fail if we have nothing at all.
    if (this.instruments().length > 0) {
      try {
        await this.refresh(false);
      } catch {
        // refresh() keeps stale rows when cache exists
      }
      return;
    }

    await this.refresh(false);
  }

  /** Refresh from Kite; never throws if a cached instrument file already exists. */
  async refreshBestEffort(force: boolean): Promise<boolean> {
    const hadCache = this.instruments().length > 0;
    try {
      await this.refresh(force);
      return this.metadata().status === 'ready';
    } catch {
      return hadCache && this.instruments().length > 0;
    }
  }

  async refresh(force: boolean): Promise<void> {
    if (!force && this.instruments().length > 0 && this.isRefreshedToday()) {
      return;
    }

    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      throw new Error('Kite access token required. Generate token in Get Token tab.');
    }

    try {
      const csv = await firstValueFrom(this.kiteApi.getInstrumentsCsv(authorization));
      const parsed = parseKiteInstrumentsCsv(csv);
      if (!parsed.length) {
        throw new Error('Instrument file parsed empty.');
      }
      this.persist(parsed);
    } catch (error) {
      if (this.instruments().length > 0) {
        this.metadata.set({
          ...this.metadata(),
          status: 'stale',
        });
        return;
      }
      throw new Error(formatUnknownError(error, 'Instruments'));
    }
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(META_KEY);
    this.instruments.set([]);
    this.metadata.set({
      lastRefreshAt: '',
      totalInstruments: 0,
      fileSizeBytes: 0,
      status: 'missing',
    });
  }

  private isRefreshedToday(): boolean {
    const last = this.metadata().lastRefreshAt;
    if (!last) {
      return false;
    }
    const lastDate = new Date(last);
    const now = new Date();
    return lastDate.toDateString() === now.toDateString();
  }

  private readInstruments(): Instrument[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Instrument[]) : [];
    } catch {
      return [];
    }
  }

  private readMetadata(): InstrumentMetadata {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) {
        return JSON.parse(raw) as InstrumentMetadata;
      }
    } catch {
      // ignore
    }
    return {
      lastRefreshAt: '',
      totalInstruments: 0,
      fileSizeBytes: 0,
      status: 'missing',
    };
  }

  private persist(list: Instrument[]): void {
    // Prefer slim desk set in memory+storage — full dump blows mobile localStorage.
    const slim = slimTradingInstruments(list);
    const stored = slim.length > 0 ? slim : list;
    const json = JSON.stringify(stored);
    const meta: InstrumentMetadata = {
      lastRefreshAt: new Date().toISOString(),
      totalInstruments: stored.length,
      fileSizeBytes: new Blob([json]).size,
      status: 'ready',
    };

    try {
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // Quota exceeded — keep in-memory for this session; next load will re-fetch.
      meta.status = 'ready';
    }

    this.instruments.set(stored);
    this.metadata.set(meta);
  }

  /** Index CE/PE count — Live money needs a real NFO chain, not an empty cache. */
  indexOptionCount(): number {
    return countIndexOptions(this.instruments());
  }
}

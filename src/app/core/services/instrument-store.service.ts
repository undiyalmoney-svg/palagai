import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Instrument, InstrumentMetadata } from '../models/instrument.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { parseKiteInstrumentsCsv } from '../utils/csv.util';

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

  getByToken(token: number): Instrument | undefined {
    return this.instruments().find((item) => item.instrumentToken === token);
  }

  async ensureLoaded(): Promise<void> {
    if (this.instruments().length > 0 && this.isRefreshedToday()) {
      return;
    }
    await this.refresh(false);
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
      throw error;
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
    const json = JSON.stringify(list);
    const meta: InstrumentMetadata = {
      lastRefreshAt: new Date().toISOString(),
      totalInstruments: list.length,
      fileSizeBytes: new Blob([json]).size,
      status: 'ready',
    };

    try {
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      meta.status = 'ready';
    }

    this.instruments.set(list);
    this.metadata.set(meta);
  }
}

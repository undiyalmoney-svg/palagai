import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Candle, KiteHistoricalResponse } from '../models/candle.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { InstrumentStoreService } from '../services/instrument-store.service';
import {
  BANK_NIFTY_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
  TesterInstrument,
} from '../constants/instruments.const';
import {
  assertKiteHistoricalSuccess,
  extractKiteApiError,
} from '../utils/kite-error.util';
import { extractTradeDate } from '../utils/trade-date.util';
import { Instrument } from '../models/instrument.model';
import {
  IndexOptionKind,
  countIndexOptions,
  resolveAtmWeeklyOption,
} from '../utils/option-chain.util';
import {
  enrichTradesWithOptionPremiums,
  replayPaperOnIndex,
} from './paper-desk-engine';
import {
  PaperDeskMode,
  PaperDeskSnapshot,
  PaperInstrumentStatus,
  PaperOptionContract,
  PaperTrade,
} from './paper-desk.models';

interface LiveLeg {
  instrument: TesterInstrument;
  kind: IndexOptionKind;
  candles: Candle[];
  processedThrough: number;
  resultTrades: PaperTrade[];
}

@Injectable({ providedIn: 'root' })
export class PaperTradeDeskService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly instrumentStore = inject(InstrumentStoreService);

  private readonly instruments: Array<{ instrument: TesterInstrument; kind: IndexOptionKind }> = [
    { instrument: NIFTY_50_INSTRUMENT, kind: 'nifty' },
    { instrument: BANK_NIFTY_INSTRUMENT, kind: 'banknifty' },
  ];

  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private liveLegs: LiveLeg[] = [];
  private liveTrades: PaperTrade[] = [];

  readonly snapshot = signal<PaperDeskSnapshot>(emptySnapshot('testing'));
  readonly busy = signal(false);

  async runTesting(fromDate: string, toDate: string): Promise<void> {
    this.stopLive();
    this.busy.set(true);
    this.snapshot.set({
      ...emptySnapshot('testing'),
      running: true,
      fromDate,
      toDate,
      message: 'Fetching index candles…',
      marketOpen: true,
    });

    try {
      const authorization = this.requireAuth();
      await this.instrumentStore.ensureLoaded();
      let allInstruments = this.instrumentStore.allInstruments();
      if (countIndexOptions(allInstruments) < 100) {
        this.patchMessage('Refreshing NFO option instruments…');
        await this.instrumentStore.refresh(true);
        allInstruments = this.instrumentStore.allInstruments();
      }
      this.patchMessage(
        `Instruments ready · ${countIndexOptions(allInstruments)} index options in cache`,
      );

      const lookbackFrom = shiftDate(fromDate, -12);
      const candleMap = new Map<string, Candle[]>();

      for (let i = 0; i < this.instruments.length; i += 1) {
        const { instrument } = this.instruments[i]!;
        if (i > 0) {
          await delay(1500);
        }
        this.patchMessage(`Loading ${instrument.name} 5m…`);
        const candles = await this.fetch5m({
          instrumentToken: instrument.instrumentToken,
          from: `${lookbackFrom} 09:00:00`,
          to: `${toDate} 15:30:00`,
          authorization,
        });
        candleMap.set(instrument.id, candles);
      }

      const needed = new Set<number>();
      const emptyOpt = new Map<number, Candle[]>();
      const firstPassTrades: PaperTrade[] = [];
      const statuses: PaperInstrumentStatus[] = [];

      for (const { instrument, kind } of this.instruments) {
        const candles = candleMap.get(instrument.id) ?? [];
        const replay = replayPaperOnIndex({
          instrumentId: instrument.id,
          instrumentName: instrument.name,
          kind,
          candles,
          fromDate,
          toDate,
          instruments: allInstruments,
          optionCandlesByToken: emptyOpt,
          neededOptionTokens: needed,
        });
        firstPassTrades.push(...replay.trades);
        statuses.push({
          instrumentId: instrument.id,
          instrumentName: instrument.name,
          lastBarTime: candles.at(-1)?.date ?? null,
          dayNetIndexPts: Object.values(replay.dayNetByDate).reduce((a, b) => a + b, 0),
          dayNetOptionRs: 0,
          openTrade: null,
          chosenOption: replay.chosenOption,
          chosenBias: replay.chosenBias,
          indexSpot: replay.indexSpot,
          chosenAsOf: replay.chosenAsOf,
          lastSignal: replay.lastSignal,
          tradesToday: replay.trades.length,
        });
      }

      this.patchMessage(`Loading ${needed.size} option contract(s)…`);
      const optionCandles = await this.fetchOptionHistories(
        [...needed],
        lookbackFrom,
        toDate,
        authorization,
      );

      const enriched = enrichTradesWithOptionPremiums(firstPassTrades, optionCandles);
      for (const s of statuses) {
        const mine = enriched.filter((t) => t.instrumentId === s.instrumentId);
        s.dayNetOptionRs = mine.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
        s.tradesToday = mine.length;
      }

      this.snapshot.set({
        mode: 'testing',
        running: false,
        fromDate,
        toDate,
        marketOpen: true,
        message: `Testing complete · ${enriched.length} paper trade(s)`,
        statuses,
        trades: enriched.sort((a, b) => a.entryTime.localeCompare(b.entryTime)),
        totals: summarize(enriched),
      });
    } catch (err) {
      this.snapshot.set({
        ...emptySnapshot('testing'),
        fromDate,
        toDate,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.busy.set(false);
    }
  }

  async startLive(): Promise<void> {
    this.stopLive();
    const today = todayIso();
    const now = istNowHhMm();

    if (now < '09:15' || now > '15:30') {
      try {
        await this.instrumentStore.ensureLoaded();
        let allInstruments = this.instrumentStore.allInstruments();
        if (countIndexOptions(allInstruments) < 100) {
          await this.instrumentStore.refresh(true);
          allInstruments = this.instrumentStore.allInstruments();
        }
        // Show what ATM contracts would be (using last index close if available)
        const statuses = await this.previewChosenInstruments(today, allInstruments);
        this.snapshot.set({
          ...emptySnapshot('live'),
          fromDate: today,
          toDate: today,
          marketOpen: false,
          message: `Live paper only 09:15–15:30 IST (now ${now}). Showing today’s ATM picks below — use Testing to run after hours.`,
          statuses,
        });
      } catch (err) {
        this.snapshot.set({
          ...emptySnapshot('live'),
          fromDate: today,
          toDate: today,
          marketOpen: false,
          message: `Live paper only 09:15–15:30 IST (now ${now}). ${err instanceof Error ? err.message : ''}`,
        });
      }
      return;
    }

    this.busy.set(true);
    this.snapshot.set({
      ...emptySnapshot('live'),
      running: true,
      fromDate: today,
      toDate: today,
      marketOpen: true,
      message: 'Starting live paper…',
    });

    try {
      const authorization = this.requireAuth();
      await this.instrumentStore.ensureLoaded();
      let allInstruments = this.instrumentStore.allInstruments();
      if (countIndexOptions(allInstruments) < 100) {
        this.patchMessage('Refreshing NFO option instruments…');
        await this.instrumentStore.refresh(true);
        allInstruments = this.instrumentStore.allInstruments();
      }
      const lookbackFrom = shiftDate(today, -12);

      this.liveLegs = [];
      this.liveTrades = [];

      for (let i = 0; i < this.instruments.length; i += 1) {
        const row = this.instruments[i]!;
        if (i > 0) {
          await delay(1500);
        }
        const candles = await this.fetch5m({
          instrumentToken: row.instrument.instrumentToken,
          from: `${lookbackFrom} 09:00:00`,
          to: `${today} 15:30:00`,
          authorization,
        });
        this.liveLegs.push({
          instrument: row.instrument,
          kind: row.kind,
          candles,
          processedThrough: -1,
          resultTrades: [],
        });
      }

      await this.tickLive(true);

      this.liveTimer = setInterval(() => {
        void this.tickLive(false);
      }, 60_000);
    } catch (err) {
      this.snapshot.set({
        ...emptySnapshot('live'),
        fromDate: today,
        toDate: today,
        message: err instanceof Error ? err.message : String(err),
      });
      this.stopLive();
      throw err;
    } finally {
      this.busy.set(false);
    }
  }

  stopLive(): void {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    const cur = this.snapshot();
    if (cur.mode === 'live' && cur.running) {
      this.snapshot.set({
        ...cur,
        running: false,
        message: cur.message.includes('complete') ? cur.message : 'Live paper stopped',
      });
    }
  }

  private async tickLive(initial: boolean): Promise<void> {
    const today = todayIso();
    const now = istNowHhMm();
    if (now > '15:30') {
      this.snapshot.update((s) => ({
        ...s,
        marketOpen: false,
        running: false,
        message: 'Market closed (after 15:30). Live paper stopped.',
      }));
      this.stopLive();
      return;
    }
    if (now < '09:15') {
      this.snapshot.update((s) => ({
        ...s,
        marketOpen: false,
        message: `Waiting for open (09:15). Now ${now}`,
      }));
      return;
    }

    const authorization = this.requireAuth();
    const allInstruments = this.instrumentStore.allInstruments();

    for (let i = 0; i < this.liveLegs.length; i += 1) {
      const leg = this.liveLegs[i]!;
      if (!initial && i > 0) {
        await delay(1200);
      }
      try {
        const fresh = await this.fetch5m({
          instrumentToken: leg.instrument.instrumentToken,
          from: `${shiftDate(today, -12)} 09:00:00`,
          to: `${today} 15:30:00`,
          authorization,
        });
        leg.candles = fresh;
      } catch {
        // keep previous candles
      }
    }

    const needed = new Set<number>();
    const emptyOpt = new Map<number, Candle[]>();
    const allTrades: PaperTrade[] = [];
    const statuses: PaperInstrumentStatus[] = [];

    for (const leg of this.liveLegs) {
      const replay = replayPaperOnIndex({
        instrumentId: leg.instrument.id,
        instrumentName: leg.instrument.name,
        kind: leg.kind,
        candles: leg.candles,
        fromDate: today,
        toDate: today,
        instruments: allInstruments,
        optionCandlesByToken: emptyOpt,
        neededOptionTokens: needed,
        forceCloseOpen: now >= '15:15',
      });
      allTrades.push(...replay.trades);
      statuses.push({
        instrumentId: leg.instrument.id,
        instrumentName: leg.instrument.name,
        lastBarTime: leg.candles.at(-1)?.date ?? null,
        dayNetIndexPts: replay.trades.reduce((a, t) => a + t.indexPoints, 0),
        dayNetOptionRs: 0,
        openTrade: replay.open
          ? {
              direction: replay.open.direction,
              indexEntry: replay.open.entry,
              indexStop: replay.open.stop,
              indexTarget: replay.open.target,
              entryTime: replay.open.entryTime,
              option: replay.open.option,
              optionEntryPremium: replay.open.optionEntryPremium,
            }
          : null,
        chosenOption: replay.chosenOption,
        chosenBias: replay.chosenBias,
        indexSpot: replay.indexSpot,
        chosenAsOf: replay.chosenAsOf,
        lastSignal: replay.lastSignal,
        tradesToday: replay.trades.length,
      });
    }

    const optionCandles = await this.fetchOptionHistories(
      [...needed],
      shiftDate(today, -5),
      today,
      authorization,
    );
    const enriched = enrichTradesWithOptionPremiums(allTrades, optionCandles);

    for (const s of statuses) {
      const mine = enriched.filter((t) => t.instrumentId === s.instrumentId);
      s.dayNetOptionRs = mine.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
      s.tradesToday = mine.length;
    }

    this.liveTrades = enriched;
    this.snapshot.set({
      mode: 'live',
      running: true,
      fromDate: today,
      toDate: today,
      marketOpen: true,
      message: `Live paper · last tick ${now} · ${enriched.length} closed`,
      statuses,
      trades: enriched.sort((a, b) => b.entryTime.localeCompare(a.entryTime)),
      totals: summarize(enriched),
    });
  }

  private async previewChosenInstruments(
    today: string,
    allInstruments: Instrument[],
  ): Promise<PaperInstrumentStatus[]> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    const statuses: PaperInstrumentStatus[] = [];

    for (let i = 0; i < this.instruments.length; i += 1) {
      const { instrument, kind } = this.instruments[i]!;
      let spot: number | null = null;
      let asOf = `${today} 15:15:00`;
      if (authorization) {
        try {
          if (i > 0) {
            await delay(1200);
          }
          const candles = await this.fetch5m({
            instrumentToken: instrument.instrumentToken,
            from: `${shiftDate(today, -5)} 09:00:00`,
            to: `${today} 15:30:00`,
            authorization,
          });
          const last = candles.at(-1);
          if (last) {
            spot = last.close;
            asOf = last.date;
          }
        } catch {
          // fall through with null spot
        }
      }

      const bias: 'BUY' | 'SELL' = 'BUY';
      const resolved = resolveAtmWeeklyOption({
        instruments: allInstruments,
        kind,
        direction: bias,
        spot: spot ?? (kind === 'banknifty' ? 52000 : 24500),
        asOfDateTime: asOf,
      });
      const chosenOption: PaperOptionContract = {
        tradingSymbol: resolved.instrument.tradingSymbol,
        instrumentToken: resolved.instrument.instrumentToken,
        strike: resolved.instrument.strike,
        expiry: resolved.instrument.expiry,
        optionType: resolved.instrument.instrumentType === 'PE' ? 'PE' : 'CE',
        lotSize: resolved.instrument.lotSize > 0 ? resolved.instrument.lotSize : 1,
        source: resolved.source,
      };

      statuses.push({
        instrumentId: instrument.id,
        instrumentName: instrument.name,
        lastBarTime: asOf,
        dayNetIndexPts: 0,
        dayNetOptionRs: 0,
        openTrade: null,
        chosenOption,
        chosenBias: bias,
        indexSpot: spot ?? chosenOption.strike,
        chosenAsOf: asOf,
        lastSignal: spot != null ? `Preview ATM @ ${spot.toFixed(1)}` : 'Preview ATM (spot fallback)',
        tradesToday: 0,
      });
    }

    return statuses;
  }

  private async fetchOptionHistories(
    tokens: number[],
    fromDate: string,
    toDate: string,
    authorization: string,
  ): Promise<Map<number, Candle[]>> {
    const map = new Map<number, Candle[]>();
    const unique = [...new Set(tokens)].slice(0, 40);
    for (let i = 0; i < unique.length; i += 1) {
      const token = unique[i]!;
      if (i > 0) {
        await delay(1200);
      }
      try {
        const candles = await this.fetch5m({
          instrumentToken: token,
          from: `${fromDate} 09:00:00`,
          to: `${toDate} 15:30:00`,
          authorization,
        });
        map.set(token, candles);
      } catch {
        // premium will be estimated
      }
    }
    return map;
  }

  private async fetch5m(params: {
    instrumentToken: number;
    from: string;
    to: string;
    authorization: string;
  }): Promise<Candle[]> {
    try {
      const response = await firstValueFrom(
        this.kiteApi.getHistoricalData({
          instrumentToken: String(params.instrumentToken),
          interval: '5minute',
          from: params.from,
          to: params.to,
          authorization: params.authorization,
        }),
      );
      assertKiteHistoricalSuccess(response, '5minute');
      const parsed = response as KiteHistoricalResponse;
      const candles =
        parsed.data?.candles?.map((row: [string, number, number, number, number, number]) => ({
          date: row[0],
          open: row[1],
          high: row[2],
          low: row[3],
          close: row[4],
          volume: row[5],
        })) ?? [];
      if (!candles.length) {
        throw new Error(`No 5m candles for token ${params.instrumentToken}`);
      }
      return candles;
    } catch (error) {
      throw new Error(extractKiteApiError(error, '5minute'));
    }
  }

  private requireAuth(): string {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      throw new Error('Kite access token required. Go to Get Token.');
    }
    return authorization;
  }

  private patchMessage(message: string): void {
    this.snapshot.update((s) => ({ ...s, message }));
  }
}

function emptySnapshot(mode: PaperDeskMode): PaperDeskSnapshot {
  return {
    mode,
    running: false,
    fromDate: '',
    toDate: '',
    marketOpen: mode === 'testing',
    message: '',
    statuses: [],
    trades: [],
    totals: { trades: 0, wins: 0, losses: 0, indexNetPts: 0, optionNetRs: 0 },
  };
}

function summarize(trades: PaperTrade[]): PaperDeskSnapshot['totals'] {
  return {
    trades: trades.length,
    wins: trades.filter((t) => t.outcome === 'WIN').length,
    losses: trades.filter((t) => t.outcome === 'LOSS').length,
    indexNetPts: trades.reduce((a, t) => a + t.indexPoints, 0),
    optionNetRs: trades.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0),
  };
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function istNowHhMm(): string {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

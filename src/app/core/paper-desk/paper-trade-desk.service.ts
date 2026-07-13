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
import {
  calendarDaysInclusive,
  chunkInclusiveDateRange,
  datePart,
  kiteMaxDaysForInterval,
} from '../kite/kite-historical-limits';
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
import { LiveOrderExecutorService } from '../live-desk/live-order-executor.service';

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
  private historicalCalls = 0;
  private lastRangeDays = 0;
  private realOrders = false;
  private readonly maxDaysPerCall = kiteMaxDaysForInterval('5minute');
  private readonly liveOrders = inject(LiveOrderExecutorService);

  readonly snapshot = signal<PaperDeskSnapshot>(emptySnapshot('testing'));
  readonly busy = signal(false);

  private resetKiteStats(): void {
    this.historicalCalls = 0;
    this.lastRangeDays = 0;
  }

  private kiteStats(): PaperDeskSnapshot['kiteStats'] {
    return {
      historicalCalls: this.historicalCalls,
      lastRangeDays: this.lastRangeDays,
      maxDaysPerCall: this.maxDaysPerCall,
    };
  }

  private kiteStatsLabel(): string {
    return `Kite 5m calls ${this.historicalCalls} · last span ${this.lastRangeDays}d (max ${this.maxDaysPerCall}d/call)`;
  }

  async runTesting(fromDate: string, toDate: string): Promise<void> {
    this.stopLive();
    this.resetKiteStats();
    this.busy.set(true);
    const spanDays = calendarDaysInclusive(shiftDate(fromDate, -12), toDate);
    this.snapshot.set({
      ...emptySnapshot('testing'),
      running: true,
      fromDate,
      toDate,
      message:
        spanDays > this.maxDaysPerCall
          ? `Fetching index candles in chunks (${spanDays}d span, max ${this.maxDaysPerCall}d/call)…`
          : 'Fetching index candles…',
      marketOpen: true,
      kiteStats: this.kiteStats(),
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
        statuses.push(
          withLiveFields({
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
          }),
        );
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
        applyLivePhase(s, mine, false);
      }

      this.snapshot.set({
        mode: 'testing',
        running: false,
        fromDate,
        toDate,
        marketOpen: true,
        realOrders: false,
        lastTickAt: null,
        message: `Testing complete · ${enriched.length} paper trade(s) · ${this.kiteStatsLabel()}`,
        statuses,
        trades: enriched.sort((a, b) => a.entryTime.localeCompare(b.entryTime)),
        totals: summarize(enriched),
        kiteStats: this.kiteStats(),
        orderEvents: [],
        orderSummary: [],
      });
    } catch (err) {
      this.snapshot.set({
        ...emptySnapshot('testing'),
        fromDate,
        toDate,
        message: err instanceof Error ? err.message : String(err),
        kiteStats: this.kiteStats(),
      });
      throw err;
    } finally {
      this.busy.set(false);
    }
  }

  async startLive(options?: { realOrders?: boolean }): Promise<void> {
    this.stopLive();
    this.resetKiteStats();
    this.realOrders = !!options?.realOrders;
    this.liveOrders.reset();
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
          kiteStats: this.kiteStats(),
        });
      } catch (err) {
        this.snapshot.set({
          ...emptySnapshot('live'),
          fromDate: today,
          toDate: today,
          marketOpen: false,
          message: `Live paper only 09:15–15:30 IST (now ${now}). ${err instanceof Error ? err.message : ''}`,
          kiteStats: this.kiteStats(),
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
      realOrders: this.realOrders,
      message: this.realOrders
        ? 'Starting LIVE MONEY desk (real Kite MIS orders)…'
        : 'Starting live paper…',
      kiteStats: this.kiteStats(),
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
        kiteStats: this.kiteStats(),
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
        message: cur.message.includes('complete')
          ? cur.message
          : cur.realOrders
            ? 'Live money stopped — check Kite for open MIS positions'
            : 'Live paper stopped',
        orderEvents: this.liveOrders.getEvents(),
        orderSummary: this.liveOrders.getOrderSummary(),
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
        // Warm-up (~12d) is loaded in startLive; later ticks only refresh today and merge
        // so we never approach Kite's 100-day 5m cap during live polling.
        if (initial && leg.candles.length) {
          // already warm
        } else if (initial) {
          leg.candles = await this.fetch5m({
            instrumentToken: leg.instrument.instrumentToken,
            from: `${shiftDate(today, -12)} 09:00:00`,
            to: `${today} 15:30:00`,
            authorization,
          });
        } else {
          const todayBars = await this.fetch5m({
            instrumentToken: leg.instrument.instrumentToken,
            from: `${today} 09:00:00`,
            to: `${today} 15:30:00`,
            authorization,
          });
          const prior = leg.candles.filter((c) => datePart(c.date) !== today);
          leg.candles = [...prior, ...todayBars];
        }
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
      statuses.push(
        withLiveFields({
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
        }),
      );
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
      applyLivePhase(s, mine, true);
    }

    if (this.realOrders) {
      for (const s of statuses) {
        await this.liveOrders.syncInstrument({
          authorization,
          instrumentId: s.instrumentId,
          instrumentName: s.instrumentName,
          open: s.openTrade
            ? {
                direction: s.openTrade.direction,
                entryTime: s.openTrade.entryTime,
                indexEntry: s.openTrade.indexEntry,
                indexStop: s.openTrade.indexStop,
                option: s.openTrade.option,
                optionEntryPremium: s.openTrade.optionEntryPremium,
              }
            : null,
        });
        await delay(350);
      }
      for (const s of statuses) {
        const pos = this.liveOrders.getPositions().find((p) => p.instrumentId === s.instrumentId);
        s.brokerSlTrigger = pos?.slTrigger ?? null;
        s.brokerSlOrderId = pos?.slOrderId ?? null;
        s.brokerEntryOrderId = pos?.entryOrderId ?? null;
        if (pos?.status === 'open' && s.livePhase === 'waiting') {
          // broker still open while paper flat — rare race; keep in_trade label
        }
        if (pos?.status === 'flat' && s.lastExitReason?.toLowerCase().includes('target')) {
          s.livePhase = 'target_hit';
          s.livePhaseLabel = 'Target achieved';
        }
      }
    }

    this.liveTrades = enriched;
    const moneyTag = this.realOrders ? 'LIVE MONEY' : 'Live paper';
    const waiting = statuses.filter((s) => s.livePhase === 'waiting').length;
    const inTrade = statuses.filter((s) => s.livePhase === 'in_trade').length;
    const targets = statuses.filter((s) => s.livePhase === 'target_hit').length;
    const openBits = statuses
      .filter((s) => s.openTrade)
      .map((s) => {
        const o = s.openTrade!;
        return `${s.instrumentName} ${o.direction} E${o.indexEntry.toFixed(0)}/SL${o.indexStop.toFixed(0)}/T${o.indexTarget.toFixed(0)}`;
      });
    const openMsg = openBits.length
      ? ` · ON MARKET: ${openBits.join(' · ')}`
      : '';
    this.snapshot.set({
      mode: 'live',
      running: true,
      fromDate: today,
      toDate: today,
      marketOpen: true,
      realOrders: this.realOrders,
      lastTickAt: new Date().toISOString(),
      message: `${moneyTag} · alive ${now} · waiting ${waiting} · in trade ${inTrade}${targets ? ` · target hit ${targets}` : ''}${openMsg} · ${this.kiteStatsLabel()}`,
      statuses,
      trades: enriched.sort((a, b) => b.entryTime.localeCompare(a.entryTime)),
      totals: summarize(enriched),
      kiteStats: this.kiteStats(),
      orderEvents: this.liveOrders.getEvents(),
      orderSummary: this.liveOrders.getOrderSummary(),
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

      statuses.push(
        withLiveFields({
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
        }),
      );
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
    const maxDays = this.maxDaysPerCall;
    const fromDate = datePart(params.from);
    const toDate = datePart(params.to);
    this.lastRangeDays = calendarDaysInclusive(fromDate, toDate);
    const chunks = chunkInclusiveDateRange(fromDate, toDate, maxDays);
    if (!chunks.length) {
      throw new Error(`Invalid 5m range ${params.from} → ${params.to}`);
    }

    const fromTime = params.from.includes(' ') ? params.from.slice(11) : '09:00:00';
    const toTime = params.to.includes(' ') ? params.to.slice(11) : '15:30:00';
    const merged: Candle[] = [];

    try {
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i]!;
        if (i > 0) {
          await delay(400);
        }
        this.historicalCalls += 1;
        const response = await firstValueFrom(
          this.kiteApi.getHistoricalData({
            instrumentToken: String(params.instrumentToken),
            interval: '5minute',
            from: `${chunk.fromDate} ${fromTime}`,
            to: `${chunk.toDate} ${toTime}`,
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
        merged.push(...candles);
      }

      const byDate = new Map<string, Candle>();
      for (const c of merged) {
        byDate.set(c.date, c);
      }
      const candles = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
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
    this.snapshot.update((s) => ({
      ...s,
      message,
      kiteStats: this.kiteStats(),
    }));
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
    realOrders: false,
    lastTickAt: null,
    statuses: [],
    trades: [],
    totals: { trades: 0, wins: 0, losses: 0, indexNetPts: 0, optionNetRs: 0 },
    kiteStats: {
      historicalCalls: 0,
      lastRangeDays: 0,
      maxDaysPerCall: kiteMaxDaysForInterval('5minute'),
    },
    orderEvents: [],
    orderSummary: [],
  };
}

function withLiveFields(
  partial: Omit<
    PaperInstrumentStatus,
    | 'livePhase'
    | 'livePhaseLabel'
    | 'lastExitReason'
    | 'lastExitTime'
    | 'brokerSlTrigger'
    | 'brokerSlOrderId'
    | 'brokerEntryOrderId'
  >,
): PaperInstrumentStatus {
  return {
    ...partial,
    livePhase: 'idle',
    livePhaseLabel: 'Idle',
    lastExitReason: null,
    lastExitTime: null,
    brokerSlTrigger: null,
    brokerSlOrderId: null,
    brokerEntryOrderId: null,
  };
}

function applyLivePhase(
  status: PaperInstrumentStatus,
  trades: PaperTrade[],
  liveRunning: boolean,
): void {
  const last = [...trades].sort((a, b) => b.exitTime.localeCompare(a.exitTime))[0] ?? null;
  status.lastExitReason = last?.exitReason ?? null;
  status.lastExitTime = last?.exitTime ?? null;

  if (status.openTrade) {
    status.livePhase = 'in_trade';
    status.livePhaseLabel = `In trade · SL ${status.openTrade.indexStop.toFixed(1)} · Tgt ${status.openTrade.indexTarget.toFixed(1)}`;
    return;
  }

  const reason = (last?.exitReason ?? '').toLowerCase();
  if (reason.includes('target')) {
    status.livePhase = 'target_hit';
    status.livePhaseLabel = 'Target achieved';
    return;
  }
  if (reason.includes('stop')) {
    status.livePhase = 'sl_hit';
    status.livePhaseLabel = 'Stop loss hit';
    return;
  }
  if (last) {
    status.livePhase = 'exited';
    status.livePhaseLabel = last.exitReason || 'Exited';
    return;
  }
  if (liveRunning) {
    status.livePhase = 'waiting';
    status.livePhaseLabel = 'Waiting for entry';
    return;
  }
  status.livePhase = 'idle';
  status.livePhaseLabel = 'Idle';
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

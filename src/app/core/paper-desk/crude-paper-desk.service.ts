import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Candle, KiteHistoricalResponse } from '../models/candle.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { InstrumentStoreService } from '../services/instrument-store.service';
import { CRUDE_OIL_MINI_INSTRUMENT } from '../constants/instruments.const';
import { MCX_CRUDE_SESSION } from '../config/session.config';
import {
  assertKiteHistoricalSuccess,
  extractKiteApiError,
  formatUnknownError,
} from '../utils/kite-error.util';
import {
  calendarDaysInclusive,
  chunkInclusiveDateRange,
  datePart,
  kiteMaxDaysForInterval,
} from '../kite/kite-historical-limits';
import { resolveCrudeOilMiniFuturesToken } from '../utils/instrument-resolver.util';
import {
  countCrudeMiniOptions,
  resolveAtmCrudeMiniOption,
  toCrudePaperOption,
} from '../utils/crude-option.util';
import {
  enrichCrudeTradesWithOptionPremiums,
  replayPaperOnCrude,
} from './crude-paper-engine';
import { CRUDE_EXIT_BY, CRUDE_RUPEES_PER_POINT } from '../strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import {
  PaperDeskMode,
  PaperDeskSnapshot,
  PaperInstrumentStatus,
  PaperTrade,
} from './paper-desk.models';
import { LiveOrderExecutorService } from '../live-desk/live-order-executor.service';

const HISTORICAL_TIMEOUT_MS = 45_000;

@Injectable({ providedIn: 'root' })
export class CrudePaperDeskService {
  private readonly kiteApi = inject(KiteApiService);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly instrumentStore = inject(InstrumentStoreService);
  private readonly liveOrders = inject(LiveOrderExecutorService);

  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private liveCandles: Candle[] = [];
  private liveTrades: PaperTrade[] = [];
  private futuresToken = 0;
  private futuresSymbol = CRUDE_OIL_MINI_INSTRUMENT.tradingSymbol;
  private historicalCalls = 0;
  private lastRangeDays = 0;
  private realOrders = false;
  private lotsMultiplier = 1;
  private runGeneration = 0;
  private readonly maxDaysPerCall = kiteMaxDaysForInterval('5minute');

  readonly snapshot = signal<PaperDeskSnapshot>(emptySnapshot('testing'));
  readonly busy = signal(false);

  /** Cancel in-flight Testing fetch or stop Live so the UI leaves "Running…". */
  cancelRun(options?: { silent?: boolean }): void {
    const wasBusy = this.busy();
    this.runGeneration += 1;
    this.stopLive();
    this.busy.set(false);
    if (options?.silent) {
      return;
    }
    const cur = this.snapshot();
    if (wasBusy || cur.running) {
      this.snapshot.set({
        ...cur,
        running: false,
        message: 'Cancelled — press Start to try again.',
      });
    }
  }

  async runTesting(fromDate: string, toDate: string, lots: number = 1): Promise<void> {
    this.cancelRun({ silent: true });
    const runId = this.runGeneration;
    this.resetKiteStats();
    this.lotsMultiplier = Math.max(1, Math.floor(lots) || 1);
    this.busy.set(true);
    this.snapshot.set({
      ...emptySnapshot('testing'),
      running: true,
      fromDate,
      toDate,
      message: 'Fetching CRUDEOILM candles…',
      marketOpen: true,
      kiteStats: this.kiteStats(),
    });

    try {
      this.assertActive(runId);
      const authorization = this.requireAuth();
      const allInstruments = await this.loadInstruments();
      this.assertActive(runId);
      const future = resolveCrudeOilMiniFuturesToken(allInstruments);
      if (!future) {
        throw new Error('No live CRUDEOILM futures contract. Settings → Refresh Instruments.');
      }
      this.futuresToken = future.instrumentToken;
      this.futuresSymbol = future.tradingSymbol;

      const lookbackFrom = shiftDate(fromDate, -12);
      this.patchMessage(`Loading ${future.tradingSymbol} 5m…`);
      const candles = await this.fetch5m({
        instrumentToken: future.instrumentToken,
        from: `${lookbackFrom} 09:00:00`,
        to: `${toDate} 23:30:00`,
        authorization,
        runId,
      });

      const needed = new Set<number>();
      const emptyOpt = new Map<number, Candle[]>();
      const replay = replayPaperOnCrude({
        instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
        instrumentName: `${CRUDE_OIL_MINI_INSTRUMENT.name} (${future.tradingSymbol})`,
        candles,
        fromDate,
        toDate,
        instruments: allInstruments,
        optionCandlesByToken: emptyOpt,
        neededOptionTokens: needed,
        lotsMultiplier: this.lotsMultiplier,
      });

      this.assertActive(runId);
      this.patchMessage(`Loading ${needed.size} option contract(s)…`);
      const optionCandles = await this.fetchOptionHistories(
        [...needed],
        lookbackFrom,
        toDate,
        authorization,
        runId,
      );
      this.assertActive(runId);
      const enriched = enrichCrudeTradesWithOptionPremiums(
        replay.trades,
        optionCandles,
        this.lotsMultiplier,
      );
      const status = withLiveFields({
        instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
        instrumentName: `${CRUDE_OIL_MINI_INSTRUMENT.name} (${future.tradingSymbol})`,
        lastBarTime: candles.at(-1)?.date ?? null,
        dayNetIndexPts: Object.values(replay.dayNetByDate).reduce((a, b) => a + b, 0),
        dayNetOptionRs: enriched.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0),
        openTrade: null,
        chosenOption: replay.chosenOption,
        chosenBias: replay.chosenBias,
        indexSpot: replay.indexSpot,
        chosenAsOf: replay.chosenAsOf,
        lastSignal: replay.lastSignal,
        tradesToday: enriched.length,
      });
      applyLivePhase(status, enriched, false);

      this.snapshot.set({
        mode: 'testing',
        running: false,
        fromDate,
        toDate,
        marketOpen: true,
        realOrders: false,
        lastTickAt: null,
        message: `Testing complete · ${enriched.length} paper trade(s) · ${this.lotsMultiplier} lot(s) · PDHL 19:00–21:00 · ${this.kiteStatsLabel()}`,
        statuses: [status],
        trades: enriched.sort((a, b) => a.entryTime.localeCompare(b.entryTime)),
        totals: summarize(enriched, this.lotsMultiplier, CRUDE_RUPEES_PER_POINT),
        kiteStats: this.kiteStats(),
        orderEvents: [],
        orderSummary: [],
      });
    } catch (err) {
      if (isCancelledError(err)) {
        return;
      }
      this.snapshot.set({
        ...emptySnapshot('testing'),
        fromDate,
        toDate,
        message: formatUnknownError(err, 'Crude testing'),
        kiteStats: this.kiteStats(),
      });
      throw err;
    } finally {
      if (runId === this.runGeneration) {
        this.busy.set(false);
      }
    }
  }

  async startLive(options?: { realOrders?: boolean; lots?: number }): Promise<void> {
    this.cancelRun({ silent: true });
    const runId = this.runGeneration;
    this.resetKiteStats();
    this.realOrders = !!environment.allowLiveMoney && !!options?.realOrders;
    this.lotsMultiplier = Math.max(1, Math.floor(options?.lots ?? 1) || 1);
    this.liveOrders.reset();
    this.liveOrders.setLotsMultiplier(this.lotsMultiplier);
    const today = todayIso();
    const now = istNowHhMm();

    if (now < MCX_CRUDE_SESSION.marketOpen || now > MCX_CRUDE_SESSION.marketClose) {
      try {
        const allInstruments = await this.loadInstruments(false);
        const statuses = await this.previewChosen(today, allInstruments);
        this.snapshot.set({
          ...emptySnapshot('live'),
          fromDate: today,
          toDate: today,
          marketOpen: false,
          message: `Live paper only ${MCX_CRUDE_SESSION.marketOpen}–${MCX_CRUDE_SESSION.marketClose} IST (now ${now}). Champion entries 19:00–21:00 — use Testing after hours.`,
          statuses,
          kiteStats: this.kiteStats(),
        });
      } catch (err) {
        this.snapshot.set({
          ...emptySnapshot('live'),
          fromDate: today,
          toDate: today,
          marketOpen: false,
          message: `Live paper only ${MCX_CRUDE_SESSION.marketOpen}–${MCX_CRUDE_SESSION.marketClose} IST (now ${now}). ${formatUnknownError(err, 'Preview')}`,
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
        ? 'Starting LIVE MONEY crude desk…'
        : 'Starting live paper crude desk…',
      kiteStats: this.kiteStats(),
    });

    try {
      this.assertActive(runId);
      const authorization = this.requireAuth();
      const allInstruments = await this.loadInstruments();
      this.assertActive(runId);
      const future = resolveCrudeOilMiniFuturesToken(allInstruments);
      if (!future) {
        throw new Error('No live CRUDEOILM futures contract.');
      }
      this.futuresToken = future.instrumentToken;
      this.futuresSymbol = future.tradingSymbol;

      const lookbackFrom = shiftDate(today, -12);
      this.liveCandles = await this.fetch5m({
        instrumentToken: future.instrumentToken,
        from: `${lookbackFrom} 09:00:00`,
        to: `${today} 23:30:00`,
        authorization,
        runId,
      });
      this.liveTrades = [];

      await this.tickLive(true);
      this.assertActive(runId);
      this.liveTimer = setInterval(() => {
        void this.tickLive(false);
      }, 60_000);
    } catch (err) {
      if (isCancelledError(err)) {
        return;
      }
      this.snapshot.set({
        ...emptySnapshot('live'),
        fromDate: today,
        toDate: today,
        message: formatUnknownError(err, 'Crude live'),
        kiteStats: this.kiteStats(),
      });
      this.stopLive();
      throw err;
    } finally {
      if (runId === this.runGeneration) {
        this.busy.set(false);
      }
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
          : `${cur.message} · stopped`,
      });
    }
  }

  private async tickLive(initial: boolean): Promise<void> {
    const today = todayIso();
    const now = istNowHhMm();
    if (now > MCX_CRUDE_SESSION.marketClose) {
      this.snapshot.update((s) => ({
        ...s,
        running: false,
        marketOpen: false,
        message: `Market closed (after ${MCX_CRUDE_SESSION.marketClose}). Live paper stopped.`,
      }));
      this.stopLive();
      return;
    }

    const authorization = this.requireAuth();
    const allInstruments = this.instrumentStore.allInstruments();

    if (!initial) {
      try {
        const todayBars = await this.fetch5m({
          instrumentToken: this.futuresToken,
          from: `${today} 09:00:00`,
          to: `${today} 23:30:00`,
          authorization,
        });
        const prior = this.liveCandles.filter((c) => datePart(c.date) !== today);
        this.liveCandles = [...prior, ...todayBars];
      } catch {
        // keep previous
      }
    }

    const needed = new Set<number>();
    const emptyOpt = new Map<number, Candle[]>();
    const replay = replayPaperOnCrude({
      instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
      instrumentName: `${CRUDE_OIL_MINI_INSTRUMENT.name} (${this.futuresSymbol})`,
      candles: this.liveCandles,
      fromDate: today,
      toDate: today,
      instruments: allInstruments,
      optionCandlesByToken: emptyOpt,
      neededOptionTokens: needed,
      forceCloseOpen: now >= CRUDE_EXIT_BY,
      lotsMultiplier: this.lotsMultiplier,
    });

    const optionCandles = await this.fetchOptionHistories(
      [...needed],
      shiftDate(today, -5),
      today,
      authorization,
    );
    const enriched = enrichCrudeTradesWithOptionPremiums(
      replay.trades,
      optionCandles,
      this.lotsMultiplier,
    );
    this.liveTrades = enriched;

    const status = withLiveFields({
      instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
      instrumentName: `${CRUDE_OIL_MINI_INSTRUMENT.name} (${this.futuresSymbol})`,
      lastBarTime: this.liveCandles.at(-1)?.date ?? null,
      dayNetIndexPts: enriched.reduce((a, t) => a + t.indexPoints, 0),
      dayNetOptionRs: enriched.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0),
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
      tradesToday: enriched.length,
    });
    applyLivePhase(status, enriched, true);

    if (this.realOrders) {
      await this.liveOrders.syncInstrument({
        authorization,
        instrumentId: status.instrumentId,
        instrumentName: status.instrumentName,
        open: status.openTrade
          ? {
              direction: status.openTrade.direction,
              entryTime: status.openTrade.entryTime,
              indexEntry: status.openTrade.indexEntry,
              indexStop: status.openTrade.indexStop,
              option: status.openTrade.option,
              optionEntryPremium: status.openTrade.optionEntryPremium,
            }
          : null,
      });
      const pos = this.liveOrders.getPositions().find((p) => p.instrumentId === status.instrumentId);
      status.brokerSlTrigger = pos?.slTrigger ?? null;
      status.brokerSlOrderId = pos?.slOrderId ?? null;
      status.brokerEntryOrderId = pos?.entryOrderId ?? null;
    }

    const moneyTag = this.realOrders ? 'LIVE MONEY' : 'Live paper';
    this.snapshot.set({
      mode: 'live',
      running: true,
      fromDate: today,
      toDate: today,
      marketOpen: true,
      realOrders: this.realOrders,
      lastTickAt: new Date().toISOString(),
      message: `${moneyTag} · alive ${now} · ${status.livePhaseLabel} · ${this.kiteStatsLabel()}`,
      statuses: [status],
      trades: enriched.sort((a, b) => a.entryTime.localeCompare(b.entryTime)),
      totals: summarize(enriched, this.lotsMultiplier, CRUDE_RUPEES_PER_POINT),
      kiteStats: this.kiteStats(),
      orderEvents: this.realOrders ? this.liveOrders.getEvents() : [],
      orderSummary: this.realOrders ? this.liveOrders.getOrderSummary() : [],
    });
  }

  private async previewChosen(
    today: string,
    allInstruments: ReturnType<InstrumentStoreService['allInstruments']>,
  ): Promise<PaperInstrumentStatus[]> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    const future = resolveCrudeOilMiniFuturesToken(allInstruments);
    let spot: number | null = null;
    let asOf = `${today} 15:15:00`;
    let symbol = CRUDE_OIL_MINI_INSTRUMENT.tradingSymbol;

    if (future && authorization) {
      symbol = future.tradingSymbol;
      try {
        const candles = await this.fetch5m({
          instrumentToken: future.instrumentToken,
          from: `${shiftDate(today, -5)} 09:00:00`,
          to: `${today} 23:30:00`,
          authorization,
        });
        const last = candles.at(-1);
        if (last) {
          spot = last.close;
          asOf = last.date;
        }
      } catch {
        // preview without spot
      }
    }

    const resolved = resolveAtmCrudeMiniOption({
      instruments: allInstruments,
      direction: 'BUY',
      spot: spot ?? 7600,
      asOfDateTime: asOf,
    });
    const chosenOption = toCrudePaperOption(resolved.instrument, resolved.source);

    return [
      withLiveFields({
        instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
        instrumentName: `${CRUDE_OIL_MINI_INSTRUMENT.name} (${symbol})`,
        lastBarTime: asOf,
        dayNetIndexPts: 0,
        dayNetOptionRs: 0,
        openTrade: null,
        chosenOption,
        chosenBias: 'BUY',
        indexSpot: spot ?? chosenOption.strike,
        chosenAsOf: asOf,
        lastSignal: spot != null ? `Preview ATM @ ${spot.toFixed(1)}` : 'Preview ATM (spot fallback)',
        tradesToday: 0,
      }),
    ];
  }

  private async loadInstruments(requireMinimum = true): Promise<
    ReturnType<InstrumentStoreService['allInstruments']>
  > {
    await this.instrumentStore.ensureLoaded();
    let all = this.instrumentStore.allInstruments();
    if (countCrudeMiniOptions(all) < 20) {
      this.patchMessage('Refreshing MCX instruments…');
      const ok = await this.instrumentStore.refreshBestEffort(true);
      all = this.instrumentStore.allInstruments();
      if (!ok && requireMinimum && countCrudeMiniOptions(all) < 5) {
        throw new Error(
          'Could not load MCX crude options. Check internet, then Settings → Refresh Instruments.',
        );
      }
    }
    return all;
  }

  private async fetchOptionHistories(
    tokens: number[],
    fromDate: string,
    toDate: string,
    authorization: string,
    runId?: number,
  ): Promise<Map<number, Candle[]>> {
    const map = new Map<number, Candle[]>();
    const unique = [...new Set(tokens)].filter((t) => t > 0).slice(0, 12);
    for (let i = 0; i < unique.length; i += 1) {
      if (runId != null) {
        this.assertActive(runId);
      }
      const token = unique[i]!;
      if (i > 0) {
        await delay(800);
      }
      try {
        const candles = await this.fetch5m({
          instrumentToken: token,
          from: `${fromDate} 09:00:00`,
          to: `${toDate} 23:30:00`,
          authorization,
          runId,
        });
        map.set(token, candles);
      } catch (err) {
        if (isCancelledError(err)) {
          throw err;
        }
        // estimate premiums
      }
    }
    return map;
  }

  private async fetch5m(params: {
    instrumentToken: number;
    from: string;
    to: string;
    authorization: string;
    runId?: number;
  }): Promise<Candle[]> {
    const fromDate = datePart(params.from);
    const toDate = datePart(params.to);
    this.lastRangeDays = calendarDaysInclusive(fromDate, toDate);
    const chunks = chunkInclusiveDateRange(fromDate, toDate, this.maxDaysPerCall);
    if (!chunks.length) {
      throw new Error(`Invalid 5m range ${params.from} → ${params.to}`);
    }

    const fromTime = params.from.includes(' ') ? params.from.slice(11) : '09:00:00';
    const toTime = params.to.includes(' ') ? params.to.slice(11) : '23:30:00';
    const merged: Candle[] = [];

    try {
      for (let i = 0; i < chunks.length; i += 1) {
        if (params.runId != null) {
          this.assertActive(params.runId);
        }
        const chunk = chunks[i]!;
        if (i > 0) {
          await delay(400);
        }
        this.historicalCalls += 1;
        const response = await firstValueFrom(
          this.kiteApi
            .getHistoricalData({
              instrumentToken: String(params.instrumentToken),
              interval: '5minute',
              from: `${chunk.fromDate} ${fromTime}`,
              to: `${chunk.toDate} ${toTime}`,
              authorization: params.authorization,
            })
            .pipe(timeout(HISTORICAL_TIMEOUT_MS)),
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
      if (isCancelledError(error)) {
        throw error;
      }
      if (error instanceof TimeoutError) {
        throw new Error(
          `Kite historical timed out after ${HISTORICAL_TIMEOUT_MS / 1000}s — check token/proxy, then Cancel and retry.`,
        );
      }
      if (error instanceof Error && error.message && error.message !== '[object Object]') {
        throw error;
      }
      throw new Error(extractKiteApiError(error, '5minute'));
    }
  }

  private assertActive(runId: number): void {
    if (runId !== this.runGeneration) {
      throw new CancelledError();
    }
  }

  private requireAuth(): string {
    const authorization = this.kiteSession.getAuthorizationHeader();
    if (!authorization) {
      throw new Error('Kite access token required. Go to Get Token.');
    }
    return authorization;
  }

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
    return `Kite 5m calls ${this.historicalCalls} · last span ${this.lastRangeDays}d`;
  }

  private patchMessage(message: string): void {
    this.snapshot.update((s) => ({ ...s, message, kiteStats: this.kiteStats() }));
  }
}

class CancelledError extends Error {
  constructor() {
    super('CANCELLED');
    this.name = 'CancelledError';
  }
}

function isCancelledError(err: unknown): boolean {
  return err instanceof CancelledError || (err instanceof Error && err.message === 'CANCELLED');
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
    totals: { trades: 0, wins: 0, losses: 0, indexNetPts: 0, optionNetRs: 0, lotsUsed: 1, pointsMoneyRs: 0 },
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

function summarize(
  trades: PaperTrade[],
  lotsUsed: number = 1,
  rupeesPerPoint: number = CRUDE_RUPEES_PER_POINT,
): PaperDeskSnapshot['totals'] {
  const lots = Math.max(1, Math.floor(lotsUsed) || 1);
  const indexNetPts = trades.reduce((a, t) => a + t.indexPoints, 0);
  return {
    trades: trades.length,
    wins: trades.filter((t) => t.outcome === 'WIN').length,
    losses: trades.filter((t) => t.outcome === 'LOSS').length,
    indexNetPts,
    optionNetRs: trades.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0),
    lotsUsed: lots,
    pointsMoneyRs: indexNetPts * rupeesPerPoint * lots,
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

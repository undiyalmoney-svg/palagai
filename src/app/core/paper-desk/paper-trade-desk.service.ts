import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { environment } from '../../../environments/environment';
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
  formatUnknownError,
} from '../utils/kite-error.util';
import {
  calendarDaysInclusive,
  chunkInclusiveDateRange,
  datePart,
  DESK_HISTORICAL_CHUNK_DAYS,
} from '../kite/kite-historical-limits';
import { Instrument } from '../models/instrument.model';
import {
  IndexOptionKind,
  countIndexOptions,
  resolveAtmWeeklyOption,
} from '../utils/option-chain.util';
import {
  buildContext,
  enrichTradesWithOptionPremiums,
  replayPaperOnIndex,
  toOptionContract,
} from './paper-desk-engine';
import { buildPaperDeskDayStats, emptyPaperDeskDayStats } from './paper-desk-day-stats';
import { PDHL_RUPEES_PER_POINT, buildDeskRiskOverrides } from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { StrategyManagerService } from '../strategy-manager/runtime/strategy-manager.service';
import { StrategyEventLogger } from '../strategy-manager/runtime/strategy-event-logger.service';
import { ShadowBookService } from '../strategy-manager/runtime/shadow-book.service';
import { StrategyPerformanceService } from '../strategy-manager/runtime/strategy-performance.service';
import { DeskChannel } from '../strategy-manager/models/desk-channel.model';
import {
  IManagedStrategy,
  ManagedOpenPosition,
} from '../strategy-manager/models/strategy-module.interface';
import { extractTradeDate } from '../utils/trade-date.util';
import {
  PaperDeskMode,
  PaperDeskSnapshot,
  PaperInstrumentStatus,
  PaperOptionContract,
  PaperTrade,
} from './paper-desk.models';
import { LiveOrderExecutorService } from '../live-desk/live-order-executor.service';

export interface TradeDeskRunOptions {
  lots?: number;
  realOrders?: boolean;
  enableNifty?: boolean;
  enableBank?: boolean;
  /** Combined strict day loss ≈ −₹2,950 (split if both books on). */
  strictDayStop?: boolean;
  /** Combined day profit lock ≈ +₹5,000 (split if both books on). */
  dayProfitLock?: boolean;
}

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
  private readonly strategyManager = inject(StrategyManagerService);
  private readonly strategyLog = inject(StrategyEventLogger);
  private readonly shadowBook = inject(ShadowBookService);
  private readonly strategyPerf = inject(StrategyPerformanceService);

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
  /** Exchange lot × this — applies to Testing + Live paper option ₹ and Live money qty. */
  private lotsMultiplier = 1;
  private deskRunOptions: Required<
    Pick<TradeDeskRunOptions, 'enableNifty' | 'enableBank' | 'strictDayStop' | 'dayProfitLock'>
  > = {
    enableNifty: true,
    enableBank: true,
    strictDayStop: false,
    dayProfitLock: false,
  };
  private runGeneration = 0;
  private readonly maxDaysPerCall = DESK_HISTORICAL_CHUNK_DAYS;
  private readonly liveOrders = inject(LiveOrderExecutorService);
  private readonly historicalTimeoutMs = 45_000;

  readonly snapshot = signal<PaperDeskSnapshot>(emptySnapshot('testing'));
  readonly busy = signal(false);

  /**
   * Re-run the live replay immediately after Strat settings/assignment change
   * so Max trades / protect updates are not stuck until the next 60s tick.
   */
  refreshLiveAfterSettingsChange(): void {
    const snap = this.snapshot();
    if (snap.mode !== 'live' || !snap.running || !this.liveLegs.length) {
      return;
    }
    if (this.busy()) {
      return;
    }
    void this.tickLive(false);
  }

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

  private assertActive(runId: number): void {
    if (runId !== this.runGeneration) {
      throw new CancelledError();
    }
  }

  private normalizeDeskOptions(options?: TradeDeskRunOptions): void {
    const enableNifty = options?.enableNifty !== false;
    const enableBank = options?.enableBank !== false;
    if (!enableNifty && !enableBank) {
      throw new Error('Select at least one index: Nifty 50 or Bank Nifty.');
    }
    this.deskRunOptions = {
      enableNifty,
      enableBank,
      strictDayStop: !!options?.strictDayStop,
      dayProfitLock: !!options?.dayProfitLock,
    };
  }

  private activeInstruments(): Array<{ instrument: TesterInstrument; kind: IndexOptionKind }> {
    return this.instruments.filter((row) => {
      if (row.kind === 'nifty') {
        return this.deskRunOptions.enableNifty;
      }
      return this.deskRunOptions.enableBank;
    });
  }

  private pdhlOverridesFor(instrumentId: string) {
    return buildDeskRiskOverrides({
      instrumentId,
      enableNifty: this.deskRunOptions.enableNifty,
      enableBank: this.deskRunOptions.enableBank,
      strictDayStop: this.deskRunOptions.strictDayStop,
      dayProfitLock: this.deskRunOptions.dayProfitLock,
    });
  }

  private channelForKind(kind: IndexOptionKind): DeskChannel {
    return kind === 'nifty' ? 'nifty' : 'bank';
  }

  /** Resolve Strategy Manager primary (+ hydrate Champion desk risk overrides). */
  private resolveDeskStrategy(kind: IndexOptionKind, mode: 'paper' | 'live') {
    const channel = this.channelForKind(kind);
    this.strategyManager.applyChampionDeskOverrides(
      this.pdhlOverridesFor(
        kind === 'nifty' ? NIFTY_50_INSTRUMENT.id : BANK_NIFTY_INSTRUMENT.id,
      ) ?? null,
    );
    const resolved = this.strategyManager.resolve(channel, mode);
    return resolved;
  }

  /** Shadow-only replay: same modules, no option attach / no orders. */
  private runShadowReplay(params: {
    channel: DeskChannel;
    mode: 'paper' | 'live';
    shadow: IManagedStrategy;
    primaryActions: Map<string, string>;
    instrumentId: string;
    candles: Candle[];
    fromDate: string;
    toDate: string;
  }): void {
    const { shadow, channel, mode, instrumentId, candles, fromDate, toDate } = params;
    shadow.reset();
    let open: ManagedOpenPosition | null = null;
    for (let i = 40; i < candles.length; i += 1) {
      const candle = candles[i]!;
      const day = extractTradeDate(candle.date);
      if (day < fromDate || day > toDate) {
        continue;
      }
      const closes = candles.slice(0, i + 1).map((c) => c.close);
      const ctx = buildContext(candles, i, instrumentId);
      if (open) {
        const exit = shadow.exitLogic(candle, open, closes, ctx);
        if (exit) {
          const points =
            open.direction === 'BUY'
              ? exit.exitPrice - open.entry
              : open.entry - exit.exitPrice;
          this.shadowBook.recordTrade({
            channel,
            strategyId: shadow.id,
            strategyName: shadow.name,
            direction: open.direction,
            entryTime: open.entryTime,
            exitTime: candle.date,
            entryPrice: open.entry,
            exitPrice: exit.exitPrice,
            points,
            exitReason: exit.reason,
            instrumentId,
          });
          shadow.onTradeClosed?.(points, day);
          open = null;
        }
        continue;
      }
      const signal = shadow.generateSignal(ctx);
      if (signal.action === 'BUY' || signal.action === 'SELL') {
        this.shadowBook.recordSignal({
          channel,
          mode,
          strategyId: shadow.id,
          strategyName: shadow.name,
          action: signal.action,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          target: signal.target,
          reason: signal.reason,
          primaryAction: params.primaryActions.get(candle.date),
          instrumentId,
          barTime: candle.date,
        });
        this.strategyLog.log({
          type: 'shadow_signal',
          strategyId: shadow.id,
          strategyName: shadow.name,
          channel,
          mode: 'shadow',
          message: `${signal.action} @ ${signal.entryPrice.toFixed(1)}`,
          data: { reason: signal.reason },
        });
        open = {
          direction: signal.action,
          entry: signal.entryPrice,
          stop: signal.stopLoss,
          target: signal.target,
          entryTime: candle.date,
        };
      }
    }
  }

  private deskOptionsLabel(): string {
    const books = [
      this.deskRunOptions.enableNifty ? 'Nifty' : null,
      this.deskRunOptions.enableBank ? 'Bank' : null,
    ]
      .filter(Boolean)
      .join('+');
    const risk = [
      this.deskRunOptions.strictDayStop ? 'strict −₹2950' : null,
      this.deskRunOptions.dayProfitLock ? 'profit lock +₹5000' : null,
    ]
      .filter(Boolean)
      .join(', ');
    return risk ? `${books} · ${risk}` : books;
  }

  async runTesting(
    fromDate: string,
    toDate: string,
    lotsOrOptions: number | TradeDeskRunOptions = 1,
  ): Promise<void> {
    this.cancelRun({ silent: true });
    const runId = this.runGeneration;
    this.resetKiteStats();
    const options: TradeDeskRunOptions =
      typeof lotsOrOptions === 'number' ? { lots: lotsOrOptions } : lotsOrOptions;
    this.normalizeDeskOptions(options);
    this.lotsMultiplier = Math.max(1, Math.floor(options.lots ?? 1) || 1);
    this.busy.set(true);
    const batches = chunkInclusiveDateRange(fromDate, toDate, DESK_HISTORICAL_CHUNK_DAYS);
    this.snapshot.set({
      ...emptySnapshot('testing'),
      running: true,
      fromDate,
      toDate,
      message:
        batches.length > 1
          ? `Testing in ${batches.length} × ~3-month batches…`
          : 'Fetching index candles…',
      marketOpen: true,
      kiteStats: this.kiteStats(),
    });

    try {
      this.assertActive(runId);
      const authorization = this.requireAuth();
      const allInstruments = await this.loadOptionInstruments();
      this.assertActive(runId);

      const active = this.activeInstruments();
      const allEnriched: PaperTrade[] = [];
      const statusAcc = new Map<
        string,
        {
          instrumentId: string;
          instrumentName: string;
          lastBarTime: string | null;
          dayNetIndexPts: number;
          dayNetOptionRs: number;
          chosenOption: PaperInstrumentStatus['chosenOption'];
          chosenBias: PaperInstrumentStatus['chosenBias'];
          indexSpot: number | null;
          chosenAsOf: string | null;
          lastSignal: string;
          strategyId?: string;
          strategyName?: string;
          maxTradesPerDay?: number;
        }
      >();

      for (let b = 0; b < batches.length; b += 1) {
        this.assertActive(runId);
        const batch = batches[b]!;
        this.patchMessage(
          `Batch ${b + 1}/${batches.length}: ${batch.fromDate} → ${batch.toDate} · loading indices…`,
        );
        const lookbackFrom = shiftDate(batch.fromDate, -12);
        const candleMap = new Map<string, Candle[]>();

        for (let i = 0; i < active.length; i += 1) {
          this.assertActive(runId);
          const { instrument } = active[i]!;
          if (i > 0 || b > 0) {
            await delay(i > 0 ? 1500 : 400);
          }
          this.patchMessage(
            `Batch ${b + 1}/${batches.length}: loading ${instrument.name} 5m…`,
          );
          const candles = await this.fetch5m({
            instrumentToken: instrument.instrumentToken,
            from: `${lookbackFrom} 09:00:00`,
            to: `${batch.toDate} 15:30:00`,
            authorization,
            runId,
          });
          candleMap.set(instrument.id, candles);
        }

        const needed = new Set<number>();
        const emptyOpt = new Map<number, Candle[]>();
        const batchTrades: PaperTrade[] = [];

        for (const { instrument, kind } of active) {
          const candles = candleMap.get(instrument.id) ?? [];
          const resolved = this.resolveDeskStrategy(kind, 'paper');
          const primaryActions = new Map<string, string>();
          const replay = replayPaperOnIndex({
            instrumentId: instrument.id,
            instrumentName: instrument.name,
            kind,
            candles,
            fromDate: batch.fromDate,
            toDate: batch.toDate,
            instruments: allInstruments,
            optionCandlesByToken: emptyOpt,
            neededOptionTokens: needed,
            lotsMultiplier: this.lotsMultiplier,
            strategy: resolved.primary,
          });
          for (const t of replay.trades) {
            primaryActions.set(t.entryTime, t.direction);
            this.strategyLog.log({
              type: 'exit',
              strategyId: replay.strategyId,
              strategyName: replay.strategyName,
              channel: resolved.channel,
              mode: 'paper',
              message: `${t.direction} ${t.indexPoints.toFixed(1)} pts · ${t.exitReason}`,
              data: { entry: t.entryTime, exit: t.exitTime },
            });
          }
          if (resolved.shadow) {
            this.runShadowReplay({
              channel: resolved.channel,
              mode: 'paper',
              shadow: resolved.shadow,
              primaryActions,
              instrumentId: instrument.id,
              candles,
              fromDate: batch.fromDate,
              toDate: batch.toDate,
            });
          }
          batchTrades.push(...replay.trades);

          const prev = statusAcc.get(instrument.id);
          const batchIndexNet = Object.values(replay.dayNetByDate).reduce((a, v) => a + v, 0);
          statusAcc.set(instrument.id, {
            instrumentId: instrument.id,
            instrumentName: instrument.name,
            lastBarTime: candles.at(-1)?.date ?? prev?.lastBarTime ?? null,
            dayNetIndexPts: (prev?.dayNetIndexPts ?? 0) + batchIndexNet,
            dayNetOptionRs: prev?.dayNetOptionRs ?? 0,
            chosenOption: replay.chosenOption ?? prev?.chosenOption ?? null,
            chosenBias: replay.chosenBias ?? prev?.chosenBias ?? null,
            indexSpot: replay.indexSpot ?? prev?.indexSpot ?? null,
            chosenAsOf: replay.chosenAsOf ?? prev?.chosenAsOf ?? null,
            lastSignal: replay.lastSignal || prev?.lastSignal || 'Waiting',
            strategyId: resolved.primary.id,
            strategyName: resolved.primary.name,
            maxTradesPerDay: resolved.primary.getSettings().maxTradesPerDay,
          });
        }

        this.assertActive(runId);
        if (needed.size) {
          this.patchMessage(
            `Batch ${b + 1}/${batches.length}: loading ${needed.size} option contract(s)…`,
          );
        }
        const optionCandles = await this.fetchOptionHistories(
          [...needed],
          lookbackFrom,
          batch.toDate,
          authorization,
          runId,
        );
        this.assertActive(runId);

        const enriched = enrichTradesWithOptionPremiums(
          batchTrades,
          optionCandles,
          this.lotsMultiplier,
        );
        allEnriched.push(...enriched);

        for (const [id, acc] of statusAcc) {
          const mine = enriched.filter((t) => t.instrumentId === id);
          acc.dayNetOptionRs += mine.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
        }
      }

      const statuses: PaperInstrumentStatus[] = [...statusAcc.values()].map((acc) => {
        const mine = allEnriched.filter((t) => t.instrumentId === acc.instrumentId);
        const status = withLiveFields({
          instrumentId: acc.instrumentId,
          instrumentName: acc.instrumentName,
          lastBarTime: acc.lastBarTime,
          dayNetIndexPts: acc.dayNetIndexPts,
          dayNetOptionRs: acc.dayNetOptionRs,
          openTrade: null,
          chosenOption: acc.chosenOption,
          chosenBias: acc.chosenBias,
          indexSpot: acc.indexSpot,
          chosenAsOf: acc.chosenAsOf,
          lastSignal: acc.lastSignal,
          tradesToday: mine.length,
          strategyId: acc.strategyId,
          strategyName: acc.strategyName,
          maxTradesPerDay: acc.maxTradesPerDay,
        });
        applyLivePhase(status, mine, false);
        return status;
      });

      const sorted = allEnriched.sort((a, b) => a.entryTime.localeCompare(b.entryTime));
      this.strategyPerf.recordMany(
        sorted.map((t) => ({
          strategyId: t.strategyId ?? 'unknown',
          channel:
            t.instrumentId === NIFTY_50_INSTRUMENT.id
              ? ('nifty' as DeskChannel)
              : ('bank' as DeskChannel),
          mode: 'paper' as const,
          direction: t.direction,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          points: t.indexPoints,
          exitReason: t.exitReason,
          instrumentId: t.instrumentId,
        })),
      );
      const dayStats = buildPaperDeskDayStats(sorted);

      this.snapshot.set({
        mode: 'testing',
        running: false,
        fromDate,
        toDate,
        marketOpen: true,
        realOrders: false,
        lastTickAt: null,
        message: `Testing complete · ${sorted.length} paper trade(s) · ${batches.length} batch(es) · ${this.lotsMultiplier} lot(s) · ${this.deskOptionsLabel()} · ${this.kiteStatsLabel()}`,
        statuses,
        trades: sorted,
        totals: summarize(sorted, this.lotsMultiplier, PDHL_RUPEES_PER_POINT),
        dayStats,
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
        message: formatUnknownError(err, 'Testing'),
        kiteStats: this.kiteStats(),
      });
      throw err;
    } finally {
      if (runId === this.runGeneration) {
        this.busy.set(false);
      }
    }
  }

  async startLive(options?: TradeDeskRunOptions): Promise<void> {
    this.cancelRun({ silent: true });
    const runId = this.runGeneration;
    this.resetKiteStats();
    this.normalizeDeskOptions(options);
    this.realOrders = !!environment.allowLiveMoney && !!options?.realOrders;
    this.lotsMultiplier = Math.max(1, Math.floor(options?.lots ?? 1) || 1);
    this.liveOrders.reset();
    this.liveOrders.setLotsMultiplier(this.lotsMultiplier);
    const today = todayIso();
    const now = istNowHhMm();
    const active = this.activeInstruments();

    if (now < '09:15' || now > '15:30') {
      try {
        const allInstruments = await this.loadOptionInstruments({
          patchStatus: false,
          requireMinimum: false,
        });
        // Show what ATM contracts would be (using last index close if available)
        const statuses = await this.previewChosenInstruments(today, allInstruments, active);
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
          message: `Live paper only 09:15–15:30 IST (now ${now}). ${formatUnknownError(err, 'Preview')}`,
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
        ? `Starting LIVE MONEY desk (${this.deskOptionsLabel()})…`
        : `Starting live paper (${this.deskOptionsLabel()})…`,
      kiteStats: this.kiteStats(),
    });

    try {
      this.assertActive(runId);
      const authorization = this.requireAuth();
      await this.loadOptionInstruments({ patchStatus: false });
      // Live money needs a fresh NFO dump — stale/empty cache → synthetic options → no Kite orders.
      if (this.realOrders) {
        this.patchMessage('Live money · refreshing NFO option chain for real orders…');
        await this.instrumentStore.refreshBestEffort(true);
      }
      this.assertActive(runId);
      const lookbackFrom = shiftDate(today, -12);

      this.liveLegs = [];
      this.liveTrades = [];

      for (let i = 0; i < active.length; i += 1) {
        this.assertActive(runId);
        const row = active[i]!;
        if (i > 0) {
          await delay(1500);
        }
        const candles = await this.fetch5m({
          instrumentToken: row.instrument.instrumentToken,
          from: `${lookbackFrom} 09:00:00`,
          to: `${today} 15:30:00`,
          authorization,
          runId,
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
        message: formatUnknownError(err, 'Testing'),
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
      const resolved = this.resolveDeskStrategy(leg.kind, 'live');
      const primaryActions = new Map<string, string>();
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
        lotsMultiplier: this.lotsMultiplier,
        strategy: resolved.primary,
      });
      for (const t of replay.trades) {
        primaryActions.set(t.entryTime, t.direction);
      }
      if (resolved.shadow) {
        this.runShadowReplay({
          channel: resolved.channel,
          mode: 'live',
          shadow: resolved.shadow,
          primaryActions,
          instrumentId: leg.instrument.id,
          candles: leg.candles,
          fromDate: today,
          toDate: today,
        });
      }
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
          strategyId: resolved.primary.id,
          strategyName: resolved.primary.name,
          maxTradesPerDay: resolved.primary.getSettings().maxTradesPerDay,
        }),
      );
    }

    const optionCandles = await this.fetchOptionHistories(
      [...needed],
      shiftDate(today, -5),
      today,
      authorization,
    );
    const enriched = enrichTradesWithOptionPremiums(allTrades, optionCandles, this.lotsMultiplier);

    for (const s of statuses) {
      const mine = enriched.filter((t) => t.instrumentId === s.instrumentId);
      s.dayNetOptionRs = mine.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
      s.tradesToday = mine.length;
      applyLivePhase(s, mine, true);
    }

    if (this.realOrders) {
      const allInstruments = this.instrumentStore.allInstruments();
      for (const s of statuses) {
        // Re-resolve ATM from the live chain so we don't send synthetic labels to Kite.
        if (s.openTrade) {
          const kind: IndexOptionKind =
            s.instrumentId === NIFTY_50_INSTRUMENT.id ? 'nifty' : 'banknifty';
          const resolved = resolveAtmWeeklyOption({
            instruments: allInstruments,
            kind,
            direction: s.openTrade.direction,
            spot: s.openTrade.indexEntry,
            asOfDateTime: s.openTrade.entryTime,
          });
          const fresh = toOptionContract(resolved.instrument, resolved.source);
          s.openTrade = { ...s.openTrade, option: fresh };
          s.chosenOption = fresh;
          s.chosenBias = s.openTrade.direction;
        }

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
        if (s.openTrade && !s.brokerEntryOrderId) {
          s.kiteBlockReason =
            this.liveOrders.getLastBlockReason(s.instrumentId) ??
            (s.openTrade.option?.source === 'synthetic'
              ? 'Synthetic/missing NFO option — refresh Instruments, then restart Live money'
              : 'Kite entry not confirmed — see Event log');
          s.livePhaseLabel = `Signal only · not on Kite`;
        } else {
          s.kiteBlockReason = null;
        }
        if (pos?.status === 'open' && s.livePhase === 'waiting') {
          // broker still open while paper flat — rare race; keep in_trade label
        }
        if (pos?.status === 'flat' && s.lastExitReason?.toLowerCase().includes('target')) {
          s.livePhase = 'target_hit';
          s.livePhaseLabel = 'Target achieved';
        }
      }
    } else {
      for (const s of statuses) {
        s.kiteBlockReason = s.openTrade
          ? 'Live paper only — tick Real Orders + confirm to send MIS to Kite'
          : null;
      }
    }

    this.liveTrades = enriched;
    const moneyTag = this.realOrders ? 'LIVE MONEY' : 'Live paper';
    const waiting = statuses.filter((s) => s.livePhase === 'waiting').length;
    const inTrade = statuses.filter((s) => s.openTrade && (!this.realOrders || !!s.brokerEntryOrderId)).length;
    const blocked = statuses.filter((s) => !!s.kiteBlockReason && !!s.openTrade && !s.brokerEntryOrderId).length;
    const targets = statuses.filter((s) => s.livePhase === 'target_hit').length;
    const openBits = statuses
      .filter((s) => s.openTrade && (!this.realOrders || !!s.brokerEntryOrderId))
      .map((s) => {
        const o = s.openTrade!;
        return `${s.instrumentName} ${o.direction} E${o.indexEntry.toFixed(0)}/SL${o.indexStop.toFixed(0)}/T${o.indexTarget.toFixed(0)}`;
      });
    const blockedBits = statuses
      .filter((s) => s.openTrade && this.realOrders && !s.brokerEntryOrderId)
      .map((s) => `${s.instrumentName}: ${s.kiteBlockReason ?? 'blocked'}`);
    const openMsg = openBits.length
      ? ` · ON KITE: ${openBits.join(' · ')}`
      : '';
    const blockedMsg = blockedBits.length
      ? ` · NOT ON KITE (${blocked}): ${blockedBits.join(' · ')}`
      : '';
    this.snapshot.set({
      mode: 'live',
      running: true,
      fromDate: today,
      toDate: today,
      marketOpen: true,
      realOrders: this.realOrders,
      lastTickAt: new Date().toISOString(),
      message: `${moneyTag} · alive ${now} · waiting ${waiting} · in trade ${inTrade}${targets ? ` · target hit ${targets}` : ''}${openMsg}${blockedMsg} · ${this.kiteStatsLabel()}`,
      statuses,
      trades: enriched.sort((a, b) => b.entryTime.localeCompare(a.entryTime)),
      totals: summarize(enriched, this.lotsMultiplier, PDHL_RUPEES_PER_POINT),
      dayStats: buildPaperDeskDayStats(enriched),
      kiteStats: this.kiteStats(),
      orderEvents: this.liveOrders.getEvents(),
      orderSummary: this.liveOrders.getOrderSummary(),
    });
  }

  private async previewChosenInstruments(
    today: string,
    allInstruments: Instrument[],
    activeRows: Array<{ instrument: TesterInstrument; kind: IndexOptionKind }> = this.instruments,
  ): Promise<PaperInstrumentStatus[]> {
    const authorization = this.kiteSession.getAuthorizationHeader();
    const statuses: PaperInstrumentStatus[] = [];

    for (let i = 0; i < activeRows.length; i += 1) {
      const { instrument, kind } = activeRows[i]!;
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
    runId?: number,
  ): Promise<Map<number, Candle[]>> {
    const map = new Map<number, Candle[]>();
    const unique = [...new Set(tokens)].slice(0, 24);
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
          to: `${toDate} 15:30:00`,
          authorization,
          runId,
        });
        map.set(token, candles);
      } catch (err) {
        if (isCancelledError(err)) {
          throw err;
        }
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
    runId?: number;
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
            .pipe(timeout(this.historicalTimeoutMs)),
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
          `Kite historical timed out after ${this.historicalTimeoutMs / 1000}s — check token/proxy, then Cancel and retry.`,
        );
      }
      // Preserve already-formatted Errors; never wrap objects into "[object Object]".
      if (error instanceof Error && error.message && error.message !== '[object Object]') {
        throw error;
      }
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

  private async loadOptionInstruments(options?: {
    patchStatus?: boolean;
    requireMinimum?: boolean;
  }): Promise<Instrument[]> {
    const patchStatus = options?.patchStatus !== false;
    const requireMinimum = options?.requireMinimum !== false;

    await this.instrumentStore.ensureLoaded();
    let allInstruments = this.instrumentStore.allInstruments();

    if (countIndexOptions(allInstruments) < 100) {
      if (patchStatus) {
        this.patchMessage('Refreshing NFO option instruments…');
      }
      const refreshed = await this.instrumentStore.refreshBestEffort(true);
      allInstruments = this.instrumentStore.allInstruments();

      if (!refreshed && requireMinimum && countIndexOptions(allInstruments) < 10) {
        throw new Error(
          'Could not load NFO instruments from Kite. Check internet, then Settings → Refresh Instruments. If token expired, update it in Get Token.',
        );
      }
      if (!refreshed && patchStatus) {
        this.patchMessage(
          `Using cached instruments (${countIndexOptions(allInstruments)} index options) — live refresh failed, continuing…`,
        );
      }
    }

    if (patchStatus) {
      this.patchMessage(
        `Instruments ready · ${countIndexOptions(allInstruments)} index options in cache`,
      );
    }

    return allInstruments;
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
    totals: { trades: 0, wins: 0, losses: 0, indexNetPts: 0, optionNetRs: 0, lotsUsed: 1, pointsMoneyRs: 0 },
    dayStats: emptyPaperDeskDayStats(),
    kiteStats: {
      historicalCalls: 0,
      lastRangeDays: 0,
      maxDaysPerCall: DESK_HISTORICAL_CHUNK_DAYS,
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
    | 'kiteBlockReason'
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
    kiteBlockReason: null,
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

class CancelledError extends Error {
  constructor() {
    super('CANCELLED');
    this.name = 'CancelledError';
  }
}

function isCancelledError(err: unknown): boolean {
  return err instanceof CancelledError || (err instanceof Error && err.message === 'CANCELLED');
}

function summarize(
  trades: PaperTrade[],
  lotsUsed: number = 1,
  rupeesPerPoint: number = PDHL_RUPEES_PER_POINT,
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

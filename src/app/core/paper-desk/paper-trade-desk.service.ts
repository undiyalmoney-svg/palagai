import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Candle, KiteHistoricalResponse } from '../models/candle.model';
import { KiteApiService } from '../kite/kite-api.service';
import { KiteSessionService } from '../kite/kite-session.service';
import { InstrumentStoreService } from '../services/instrument-store.service';
import {
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
  NATGAS_MINI_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
  TesterInstrument,
} from '../constants/instruments.const';
import { MCX_MINI_ASSETS } from '../config/mcx-mini-asset';
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
  DESK_HISTORICAL_CHUNK_DAYS,
} from '../kite/kite-historical-limits';
import { Instrument } from '../models/instrument.model';
import {
  IndexOptionKind,
  countIndexOptions,
  describeOptionChainGap,
  resolveAtmWeeklyOption,
} from '../utils/option-chain.util';
import {
  buildContext,
  effectiveProtectiveStop,
  enrichTradesWithOptionPremiums,
  replayPaperOnIndex,
  toOptionContract,
} from './paper-desk-engine';
import {
  enrichCrudeTradesWithOptionPremiums,
  replayPaperOnCrude,
} from './crude-paper-engine';
import { applyKiteFillPnl } from './apply-kite-fill-pnl';
import { enrichTradesWithCharges } from './trade-charges.util';
import { buildPaperDeskDayStats, emptyPaperDeskDayStats } from './paper-desk-day-stats';
import { MAX_OPTION_HISTORY_TOKENS, rankTokensByFrequency } from './option-history-tokens.util';
import { PDHL_RUPEES_PER_POINT, buildDeskRiskOverrides, buildIndexDeskRiskSettings, rupeesPerPointForInstrument } from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
import { CRUDE_EXIT_BY } from '../strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator';
import {
  resolveCrudeProfileDayLossPts,
  resolveCrudeStrategyProfile,
} from '../strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile';
import {
  resolveCrudeOilMiniFuturesToken,
  resolveNatGasMiniFuturesToken,
} from '../utils/instrument-resolver.util';
import {
  countCrudeMiniOptions,
  resolveAtmCrudeMiniOption,
  toCrudePaperOption,
} from '../utils/crude-option.util';
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
  /** Legacy single lots — used as fallback when per-book lots omitted. */
  lots?: number;
  /** Per-book lots (exchange lot × this). */
  niftyLots?: number;
  bankLots?: number;
  crudeLots?: number;
  natGasLots?: number;
  realOrders?: boolean;
  enableNifty?: boolean;
  enableBank?: boolean;
  /** Crude Oil Mini Selective parallel book on Trade Desk. Default on from UI. */
  enableCrude?: boolean;
  /** Natural Gas Mini Daily Profit NG parallel book. Default off — opt in from UI. */
  enableNatGas?: boolean;
  /** Combined strict day loss ≈ −₹2,950 (split if both index books on). */
  strictDayStop?: boolean;
  /** Combined day profit lock ≈ +₹5,000 (split if both index books on). */
  dayProfitLock?: boolean;
  /** Background Kutty scalp (not in Strat dropdown). Default on. */
  enableKutty?: boolean;
  /** Kutty only — no Trap/Strat entries. Implies enableKutty. */
  kuttyAlone?: boolean;
}

interface LiveLeg {
  instrument: TesterInstrument;
  kind: IndexOptionKind;
  candles: Candle[];
  processedThrough: number;
  resultTrades: PaperTrade[];
}

interface CrudeLiveState {
  futuresToken: number;
  futuresSymbol: string;
  candles: Candle[];
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
  private crudeLive: CrudeLiveState | null = null;
  private natGasLive: CrudeLiveState | null = null;
  /** Last index statuses kept after 15:30 while MCX books continue. */
  private lastIndexStatuses: PaperInstrumentStatus[] = [];
  private liveTrades: PaperTrade[] = [];
  private historicalCalls = 0;
  private lastRangeDays = 0;
  private realOrders = false;
  /** Fallback lots (legacy). Prefer per-book lots below. */
  private lotsMultiplier = 1;
  private niftyLots = 1;
  private bankLots = 1;
  private crudeLots = 1;
  private natGasLots = 1;
  private deskRunOptions: Required<
    Pick<
      TradeDeskRunOptions,
      | 'enableNifty'
      | 'enableBank'
      | 'enableCrude'
      | 'enableNatGas'
      | 'strictDayStop'
      | 'dayProfitLock'
      | 'enableKutty'
      | 'kuttyAlone'
    >
  > = {
    enableNifty: true,
    enableBank: true,
    enableCrude: true,
    enableNatGas: false,
    strictDayStop: false,
    dayProfitLock: false,
    enableKutty: true,
    kuttyAlone: false,
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
    const enableCrude = options?.enableCrude !== false;
    // Nat Gas is opt-in (unlike Crude) until the book is fully analyzed.
    const enableNatGas = !!options?.enableNatGas;
    if (!enableNifty && !enableBank && !enableCrude && !enableNatGas) {
      throw new Error(
        'Select at least one book: Nifty 50, Bank Nifty, Crude Oil Mini, or Natural Gas Mini.',
      );
    }
    const kuttyAlone = !!options?.kuttyAlone;
    this.deskRunOptions = {
      enableNifty,
      enableBank,
      enableCrude,
      enableNatGas,
      strictDayStop: !!options?.strictDayStop,
      dayProfitLock: !!options?.dayProfitLock,
      enableKutty: kuttyAlone || options?.enableKutty !== false,
      kuttyAlone,
    };
    const fallback = Math.max(1, Math.floor(options?.lots ?? 1) || 1);
    this.lotsMultiplier = fallback;
    this.niftyLots = Math.max(1, Math.floor(options?.niftyLots ?? fallback) || 1);
    this.bankLots = Math.max(1, Math.floor(options?.bankLots ?? fallback) || 1);
    this.crudeLots = Math.max(1, Math.floor(options?.crudeLots ?? fallback) || 1);
    this.natGasLots = Math.max(1, Math.floor(options?.natGasLots ?? fallback) || 1);
  }

  private natGasOptionResolve() {
    const a = MCX_MINI_ASSETS.natgas;
    return {
      optionPrefixes: [a.futPrefix, ...a.altFutPrefixes],
      strikeStep: a.strikeStep,
      syntheticName: a.futPrefix,
    };
  }

  private anyMcxBookEnabled(): boolean {
    return this.deskRunOptions.enableCrude || this.deskRunOptions.enableNatGas;
  }

  private isMcxInstrumentId(instrumentId: string): boolean {
    return (
      instrumentId === CRUDE_OIL_MINI_INSTRUMENT.id ||
      instrumentId === NATGAS_MINI_INSTRUMENT.id
    );
  }

  private lotsForInstrument(instrumentId: string): number {
    if (instrumentId === NIFTY_50_INSTRUMENT.id) {
      return this.niftyLots;
    }
    if (instrumentId === BANK_NIFTY_INSTRUMENT.id) {
      return this.bankLots;
    }
    if (instrumentId === CRUDE_OIL_MINI_INSTRUMENT.id) {
      return this.crudeLots;
    }
    if (instrumentId === NATGAS_MINI_INSTRUMENT.id) {
      return this.natGasLots;
    }
    return this.lotsMultiplier;
  }

  private applyBookLotsToLiveOrders(): void {
    if (this.deskRunOptions.enableNifty) {
      this.liveOrders.setLotsForInstrument(NIFTY_50_INSTRUMENT.id, this.niftyLots);
    }
    if (this.deskRunOptions.enableBank) {
      this.liveOrders.setLotsForInstrument(BANK_NIFTY_INSTRUMENT.id, this.bankLots);
    }
    if (this.deskRunOptions.enableCrude) {
      this.liveOrders.setLotsForInstrument(CRUDE_OIL_MINI_INSTRUMENT.id, this.crudeLots);
    }
    if (this.deskRunOptions.enableNatGas) {
      this.liveOrders.setLotsForInstrument(NATGAS_MINI_INSTRUMENT.id, this.natGasLots);
    }
  }

  /** Apply charge estimates with per-book lots (Nifty / Bank / Crude may differ). */
  private enrichMixedLots(trades: PaperTrade[]): PaperTrade[] {
    const byId = new Map<string, PaperTrade[]>();
    for (const t of trades) {
      const list = byId.get(t.instrumentId) ?? [];
      list.push(t);
      byId.set(t.instrumentId, list);
    }
    const out: PaperTrade[] = [];
    for (const [id, list] of byId) {
      out.push(...enrichTradesWithCharges(list, this.lotsForInstrument(id)));
    }
    return out;
  }

  private premiumEnrichMixed(
    indexTrades: PaperTrade[],
    mcxTrades: PaperTrade[],
    optionCandles: Map<number, Candle[]>,
  ): PaperTrade[] {
    const byId = new Map<string, PaperTrade[]>();
    for (const t of indexTrades) {
      const list = byId.get(t.instrumentId) ?? [];
      list.push(t);
      byId.set(t.instrumentId, list);
    }
    const enrichedIndex: PaperTrade[] = [];
    for (const [id, list] of byId) {
      enrichedIndex.push(
        ...enrichTradesWithOptionPremiums(list, optionCandles, this.lotsForInstrument(id)),
      );
    }
    const mcxById = new Map<string, PaperTrade[]>();
    for (const t of mcxTrades) {
      const list = mcxById.get(t.instrumentId) ?? [];
      list.push(t);
      mcxById.set(t.instrumentId, list);
    }
    const enrichedMcx: PaperTrade[] = [];
    for (const [id, list] of mcxById) {
      enrichedMcx.push(
        ...enrichCrudeTradesWithOptionPremiums(list, optionCandles, this.lotsForInstrument(id)),
      );
    }
    return [...enrichedIndex, ...enrichedMcx];
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

  /** Resolve Strategy Manager primary + apply desk risk to Champion and Trap/index DNA. */
  private resolveDeskStrategy(kind: IndexOptionKind, mode: 'paper' | 'live') {
    const channel = this.channelForKind(kind);
    const instrumentId = kind === 'nifty' ? NIFTY_50_INSTRUMENT.id : BANK_NIFTY_INSTRUMENT.id;
    const pdhl = this.pdhlOverridesFor(instrumentId);
    this.strategyManager.applyChampionDeskOverrides(pdhl ?? null);
    const resolved = this.strategyManager.resolve(channel, mode);
    this.strategyManager.applyIndexDeskRiskSettings(
      resolved.primary,
      buildIndexDeskRiskSettings({
        instrumentId,
        enableNifty: this.deskRunOptions.enableNifty,
        enableBank: this.deskRunOptions.enableBank,
        strictDayStop: this.deskRunOptions.strictDayStop,
        dayProfitLock: this.deskRunOptions.dayProfitLock,
      }),
    );
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
      this.deskRunOptions.enableNifty ? `Nifty×${this.niftyLots}` : null,
      this.deskRunOptions.enableBank ? `Bank×${this.bankLots}` : null,
      this.deskRunOptions.enableCrude ? `Crude×${this.crudeLots}` : null,
      this.deskRunOptions.enableNatGas ? `NG×${this.natGasLots}` : null,
    ]
      .filter(Boolean)
      .join('+');
    const risk = [
      this.deskRunOptions.strictDayStop ? 'strict −₹2950' : null,
      this.deskRunOptions.dayProfitLock ? 'profit lock +₹3000' : null,
      this.deskRunOptions.kuttyAlone
        ? 'Kutty alone'
        : this.deskRunOptions.enableKutty
          ? 'Kutty on'
          : null,
      this.deskRunOptions.enableCrude ? 'Crude Selective' : null,
      this.deskRunOptions.enableNatGas ? 'Nat Gas Daily Profit' : null,
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
      const allInstruments = await this.loadOptionInstruments({
        requireCrude: this.deskRunOptions.enableCrude,
        requireNatGas: this.deskRunOptions.enableNatGas,
      });
      this.assertActive(runId);

      const active = this.activeInstruments();
      let crudeFuture: { instrumentToken: number; tradingSymbol: string } | null = null;
      let natGasFuture: { instrumentToken: number; tradingSymbol: string } | null = null;
      if (this.deskRunOptions.enableCrude) {
        const resolvedFuture = resolveCrudeOilMiniFuturesToken(allInstruments);
        if (!resolvedFuture) {
          throw new Error('No live CRUDEOILM futures contract. Settings → Refresh Instruments.');
        }
        crudeFuture = {
          instrumentToken: resolvedFuture.instrumentToken,
          tradingSymbol: resolvedFuture.tradingSymbol,
        };
      }
      if (this.deskRunOptions.enableNatGas) {
        const resolvedFuture = resolveNatGasMiniFuturesToken(allInstruments);
        if (!resolvedFuture) {
          throw new Error(
            'No live NATGASMINI futures after refresh. Open Get Token if expired, then Settings → Refresh Instruments, and confirm badge shows v1.3.42+.',
          );
        }
        natGasFuture = {
          instrumentToken: resolvedFuture.instrumentToken,
          tradingSymbol: resolvedFuture.tradingSymbol,
        };
      }
      const crudeTradeParams = resolveCrudeStrategyProfile('selective');
      const crudeDayLossPts = resolveCrudeProfileDayLossPts(crudeTradeParams, false);
      const natGasTradeParams = resolveCrudeStrategyProfile('daily-profit-ng');
      const natGasDayLossPts = resolveCrudeProfileDayLossPts(natGasTradeParams, false);
      const natGasResolve = this.natGasOptionResolve();

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
          `Batch ${b + 1}/${batches.length}: ${batch.fromDate} → ${batch.toDate} · loading books…`,
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

        let crudeCandles: Candle[] = [];
        if (crudeFuture) {
          this.assertActive(runId);
          if (active.length > 0 || b > 0) {
            await delay(1500);
          }
          this.patchMessage(
            `Batch ${b + 1}/${batches.length}: loading ${crudeFuture.tradingSymbol} 5m…`,
          );
          crudeCandles = await this.fetch5m({
            instrumentToken: crudeFuture.instrumentToken,
            from: `${lookbackFrom} 09:00:00`,
            to: `${batch.toDate} 23:30:00`,
            authorization,
            runId,
          });
        }

        let natGasCandles: Candle[] = [];
        if (natGasFuture) {
          this.assertActive(runId);
          if (active.length > 0 || b > 0 || crudeFuture) {
            await delay(1500);
          }
          this.patchMessage(
            `Batch ${b + 1}/${batches.length}: loading ${natGasFuture.tradingSymbol} 5m…`,
          );
          natGasCandles = await this.fetch5m({
            instrumentToken: natGasFuture.instrumentToken,
            from: `${lookbackFrom} 09:00:00`,
            to: `${batch.toDate} 23:30:00`,
            authorization,
            runId,
          });
        }

        const needed = new Set<number>();
        const emptyOpt = new Map<number, Candle[]>();
        const batchIndexTrades: PaperTrade[] = [];
        let batchCrudeTrades: PaperTrade[] = [];
        let batchNatGasTrades: PaperTrade[] = [];
        /** Per-instrument entry map for shadow (full batch). */
        const primaryActionsById = new Map<string, Map<string, string>>();

        // Day-interleaved Nifty+Bank so shared Kutty margin matches Live same-day concurrency.
        const days = chunkInclusiveDateRange(batch.fromDate, batch.toDate, 1);
        for (const dayChunk of days) {
          const day = dayChunk.fromDate;
          const kuttyMargin = { usedRs: 0, trapOpenLegs: 0 };
          for (const { instrument, kind } of active) {
            const candles = candleMap.get(instrument.id) ?? [];
            const resolved = this.resolveDeskStrategy(kind, 'paper');
            const replay = replayPaperOnIndex({
              instrumentId: instrument.id,
              instrumentName: instrument.name,
              kind,
              candles,
              fromDate: day,
              toDate: day,
              instruments: allInstruments,
              optionCandlesByToken: emptyOpt,
              neededOptionTokens: needed,
              lotsMultiplier: this.lotsForInstrument(instrument.id),
              strategy: resolved.primary,
              enableKutty: this.deskRunOptions.enableKutty,
              kuttyAlone: this.deskRunOptions.kuttyAlone,
              kuttyMargin,
            });
            let primaryActions = primaryActionsById.get(instrument.id);
            if (!primaryActions) {
              primaryActions = new Map<string, string>();
              primaryActionsById.set(instrument.id, primaryActions);
            }
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
            batchIndexTrades.push(...replay.trades);

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
        }

        if (crudeFuture) {
          const crudeReplay = replayPaperOnCrude({
            instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
            instrumentName: `${CRUDE_OIL_MINI_INSTRUMENT.name} (${crudeFuture.tradingSymbol})`,
            candles: crudeCandles,
            fromDate: batch.fromDate,
            toDate: batch.toDate,
            instruments: allInstruments,
            optionCandlesByToken: emptyOpt,
            neededOptionTokens: needed,
            lotsMultiplier: this.crudeLots,
            dayLossStopPts: crudeDayLossPts,
            enableMorning: crudeTradeParams.defaultEnableMorning,
            enableEvening: crudeTradeParams.defaultEnableEvening,
            tradeParams: crudeTradeParams,
          });
          batchCrudeTrades = crudeReplay.trades;
          const prev = statusAcc.get(CRUDE_OIL_MINI_INSTRUMENT.id);
          const batchIndexNet = Object.values(crudeReplay.dayNetByDate).reduce((a, v) => a + v, 0);
          statusAcc.set(CRUDE_OIL_MINI_INSTRUMENT.id, {
            instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
            instrumentName: `${CRUDE_OIL_MINI_INSTRUMENT.name} (${crudeFuture.tradingSymbol})`,
            lastBarTime: crudeCandles.at(-1)?.date ?? prev?.lastBarTime ?? null,
            dayNetIndexPts: (prev?.dayNetIndexPts ?? 0) + batchIndexNet,
            dayNetOptionRs: prev?.dayNetOptionRs ?? 0,
            chosenOption: crudeReplay.chosenOption ?? prev?.chosenOption ?? null,
            chosenBias: crudeReplay.chosenBias ?? prev?.chosenBias ?? null,
            indexSpot: crudeReplay.indexSpot ?? prev?.indexSpot ?? null,
            chosenAsOf: crudeReplay.chosenAsOf ?? prev?.chosenAsOf ?? null,
            lastSignal: crudeReplay.lastSignal || prev?.lastSignal || 'Waiting',
            strategyId: 'crude-selective',
            strategyName: crudeTradeParams.label,
            maxTradesPerDay: crudeTradeParams.maxEveningTradesDay,
          });
        }

        if (natGasFuture) {
          const natGasReplay = replayPaperOnCrude({
            instrumentId: NATGAS_MINI_INSTRUMENT.id,
            instrumentName: `${NATGAS_MINI_INSTRUMENT.name} (${natGasFuture.tradingSymbol})`,
            candles: natGasCandles,
            fromDate: batch.fromDate,
            toDate: batch.toDate,
            instruments: allInstruments,
            optionCandlesByToken: emptyOpt,
            neededOptionTokens: needed,
            lotsMultiplier: this.natGasLots,
            dayLossStopPts: natGasDayLossPts,
            enableMorning: natGasTradeParams.defaultEnableMorning,
            enableEvening: natGasTradeParams.defaultEnableEvening,
            tradeParams: natGasTradeParams,
            ...natGasResolve,
          });
          batchNatGasTrades = natGasReplay.trades;
          const prev = statusAcc.get(NATGAS_MINI_INSTRUMENT.id);
          const batchIndexNet = Object.values(natGasReplay.dayNetByDate).reduce((a, v) => a + v, 0);
          statusAcc.set(NATGAS_MINI_INSTRUMENT.id, {
            instrumentId: NATGAS_MINI_INSTRUMENT.id,
            instrumentName: `${NATGAS_MINI_INSTRUMENT.name} (${natGasFuture.tradingSymbol})`,
            lastBarTime: natGasCandles.at(-1)?.date ?? prev?.lastBarTime ?? null,
            dayNetIndexPts: (prev?.dayNetIndexPts ?? 0) + batchIndexNet,
            dayNetOptionRs: prev?.dayNetOptionRs ?? 0,
            chosenOption: natGasReplay.chosenOption ?? prev?.chosenOption ?? null,
            chosenBias: natGasReplay.chosenBias ?? prev?.chosenBias ?? null,
            indexSpot: natGasReplay.indexSpot ?? prev?.indexSpot ?? null,
            chosenAsOf: natGasReplay.chosenAsOf ?? prev?.chosenAsOf ?? null,
            lastSignal: natGasReplay.lastSignal || prev?.lastSignal || 'Waiting',
            strategyId: 'natgas-daily-profit-ng',
            strategyName: natGasTradeParams.label,
            maxTradesPerDay: natGasTradeParams.maxEveningTradesDay,
          });
        }

        for (const { instrument, kind } of active) {
          const resolved = this.resolveDeskStrategy(kind, 'paper');
          if (!resolved.shadow) {
            continue;
          }
          this.runShadowReplay({
            channel: resolved.channel,
            mode: 'paper',
            shadow: resolved.shadow,
            primaryActions: primaryActionsById.get(instrument.id) ?? new Map(),
            instrumentId: instrument.id,
            candles: candleMap.get(instrument.id) ?? [],
            fromDate: batch.fromDate,
            toDate: batch.toDate,
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
          this.anyMcxBookEnabled() ? '23:30:00' : '15:30:00',
        );
        this.assertActive(runId);

        const enriched = this.premiumEnrichMixed(
          batchIndexTrades,
          [...batchCrudeTrades, ...batchNatGasTrades],
          optionCandles,
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

      const sorted = this.enrichMixedLots(
        allEnriched.sort((a, b) => a.entryTime.localeCompare(b.entryTime)),
      );
      this.strategyPerf.recordMany(
        sorted
          .filter((t) => !this.isMcxInstrumentId(t.instrumentId))
          .map((t) => ({
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
        message: `Testing complete · ${sorted.length} paper trade(s) · ${batches.length} batch(es) · ${this.deskOptionsLabel()} · ${this.kiteStatsLabel()}`,
        statuses,
        trades: sorted,
        totals: summarize(sorted, (id) => this.lotsForInstrument(id), this.lotsMultiplier),
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
    const active = this.activeInstruments();
    const clearIds = [
      ...active.map((i) => i.instrument.id),
      ...(this.deskRunOptions.enableCrude ? [CRUDE_OIL_MINI_INSTRUMENT.id] : []),
      ...(this.deskRunOptions.enableNatGas ? [NATGAS_MINI_INSTRUMENT.id] : []),
    ];
    // Soft clear — never wipe the other desk's open SL / adopt map.
    this.liveOrders.clearInstruments(clearIds);
    this.liveOrders.setLotsMultiplier(this.lotsMultiplier);
    this.applyBookLotsToLiveOrders();
    const today = todayIso();
    const now = istNowHhMm();
    const anyIndex = this.deskRunOptions.enableNifty || this.deskRunOptions.enableBank;
    const indexOpen = now >= '09:15' && now <= '15:30';
    const mcxOpen =
      now >= MCX_CRUDE_SESSION.marketOpen && now <= MCX_CRUDE_SESSION.marketClose;
    const canRun = (anyIndex && indexOpen) || (this.anyMcxBookEnabled() && mcxOpen);

    if (!canRun) {
      try {
        const allInstruments = await this.loadOptionInstruments({
          patchStatus: false,
          requireMinimum: false,
          requireCrude: this.deskRunOptions.enableCrude,
          requireNatGas: this.deskRunOptions.enableNatGas,
        });
        const statuses = await this.previewChosenInstruments(today, allInstruments, active, {
          includeCrude: this.deskRunOptions.enableCrude,
          includeNatGas: this.deskRunOptions.enableNatGas,
        });
        this.snapshot.set({
          ...emptySnapshot('live'),
          fromDate: today,
          toDate: today,
          marketOpen: false,
          message: `Outside hours for selected books (now ${now}). Index 09:15–15:30 · MCX ${MCX_CRUDE_SESSION.marketOpen}–${MCX_CRUDE_SESSION.marketClose}. Showing ATM picks — use Testing after hours.`,
          statuses,
          kiteStats: this.kiteStats(),
        });
      } catch (err) {
        this.snapshot.set({
          ...emptySnapshot('live'),
          fromDate: today,
          toDate: today,
          marketOpen: false,
          message: `Outside hours (now ${now}). ${formatUnknownError(err, 'Preview')}`,
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
      const allInstruments = await this.loadOptionInstruments({
        patchStatus: false,
        requireCrude: this.deskRunOptions.enableCrude,
        requireNatGas: this.deskRunOptions.enableNatGas,
      });
      // Live money needs a fresh NFO dump — stale/empty cache → synthetic options → no Kite orders.
      // Tuesday Nifty expiry rolls to next weekly — force refresh so Aug+1 week is in cache.
      if (this.realOrders && anyIndex) {
        this.patchMessage('Live money · refreshing NFO option chain for real orders…');
        try {
          await this.instrumentStore.refresh(true);
        } catch (err) {
          throw new Error(
            `Live money needs a fresh NFO option chain. ${formatUnknownError(err, 'Instruments')} ` +
              'Open Get Token if expired, then Settings → Refresh Instruments.',
          );
        }
        const fresh = this.instrumentStore.allInstruments();
        const nfoCount = this.instrumentStore.indexOptionCount();
        if (nfoCount < 50) {
          throw new Error(
            `Live money blocked — only ${nfoCount} index options in cache after refresh. ` +
              'Settings → Refresh Instruments, then restart Live money.',
          );
        }
        // Expiry Tuesday rolls to next weekly — fail fast if that contract isn't in the dump.
        const asOfDateTime = `${today}T${now.length === 5 ? now : '10:00'}:00+0530`;
        const niftyProbe = resolveAtmWeeklyOption({
          instruments: fresh,
          kind: 'nifty',
          direction: 'BUY',
          spot: 25000,
          asOfDateTime,
        });
        if (niftyProbe.source === 'synthetic') {
          throw new Error(
            `Live money blocked — Nifty next-week ATM missing after refresh (${describeOptionChainGap({
              instruments: fresh,
              kind: 'nifty',
              direction: 'BUY',
              spot: 25000,
              asOfDateTime,
            })}). On expiry Tuesday the desk trades next weekly only — Settings → Refresh Instruments, then restart.`,
          );
        }
        this.patchMessage(
          `Live money · NFO chain ready (${nfoCount} index options · Nifty ${niftyProbe.instrument.expiry.slice(0, 10)})`,
        );
      }
      if (this.realOrders) {
        this.patchMessage('Live money · reconciling open Kite positions…');
        const note = await this.liveOrders.reconcileFromBroker(authorization);
        this.patchMessage(`Live money · ${note}`);
      }
      this.assertActive(runId);
      const lookbackFrom = shiftDate(today, -12);

      this.liveLegs = [];
      this.crudeLive = null;
      this.natGasLive = null;
      this.lastIndexStatuses = [];
      this.liveTrades = [];

      if (anyIndex && indexOpen) {
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
      }

      if (this.deskRunOptions.enableCrude && mcxOpen) {
        const future = resolveCrudeOilMiniFuturesToken(allInstruments);
        if (!future) {
          throw new Error('No live CRUDEOILM futures contract.');
        }
        if (this.liveLegs.length) {
          await delay(1500);
        }
        const candles = await this.fetch5m({
          instrumentToken: future.instrumentToken,
          from: `${lookbackFrom} 09:00:00`,
          to: `${today} 23:30:00`,
          authorization,
          runId,
        });
        this.crudeLive = {
          futuresToken: future.instrumentToken,
          futuresSymbol: future.tradingSymbol,
          candles,
        };
      }

      if (this.deskRunOptions.enableNatGas && mcxOpen) {
        const future = resolveNatGasMiniFuturesToken(allInstruments);
        if (!future) {
          throw new Error(
            'No live NATGASMINI futures after refresh. Confirm badge shows v1.3.42+, then Settings → Refresh Instruments.',
          );
        }
        if (this.liveLegs.length || this.crudeLive) {
          await delay(1500);
        }
        const candles = await this.fetch5m({
          instrumentToken: future.instrumentToken,
          from: `${lookbackFrom} 09:00:00`,
          to: `${today} 23:30:00`,
          authorization,
          runId,
        });
        this.natGasLive = {
          futuresToken: future.instrumentToken,
          futuresSymbol: future.tradingSymbol,
          candles,
        };
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
    const crudeEnabled = this.deskRunOptions.enableCrude && !!this.crudeLive;
    const natGasEnabled = this.deskRunOptions.enableNatGas && !!this.natGasLive;
    const mcxEnabled = crudeEnabled || natGasEnabled;
    const anyIndexLegs = this.liveLegs.length > 0;

    if (mcxEnabled) {
      if (now > MCX_CRUDE_SESSION.marketClose) {
        this.snapshot.update((s) => ({
          ...s,
          marketOpen: false,
          running: false,
          message: `Market closed (after ${MCX_CRUDE_SESSION.marketClose}). Live desk stopped.`,
        }));
        this.stopLive();
        return;
      }
    } else if (now > '15:30') {
      this.snapshot.update((s) => ({
        ...s,
        marketOpen: false,
        running: false,
        message: 'Market closed (after 15:30). Live paper stopped.',
      }));
      this.stopLive();
      return;
    }

    const indexSessionActive = anyIndexLegs && now >= '09:15' && now <= '15:30';
    const mcxSessionActive =
      mcxEnabled &&
      now >= MCX_CRUDE_SESSION.marketOpen &&
      now <= MCX_CRUDE_SESSION.marketClose;
    const crudeSessionActive = crudeEnabled && mcxSessionActive;
    const natGasSessionActive = natGasEnabled && mcxSessionActive;

    if (!indexSessionActive && !mcxSessionActive) {
      this.snapshot.update((s) => ({
        ...s,
        marketOpen: false,
        message: `Waiting for open. Now ${now}`,
      }));
      return;
    }

    const authorization = this.requireAuth();
    let allInstruments = this.instrumentStore.allInstruments();

    if (indexSessionActive) {
      for (let i = 0; i < this.liveLegs.length; i += 1) {
        const leg = this.liveLegs[i]!;
        if (!initial && i > 0) {
          await delay(1200);
        }
        try {
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
    }

    if (crudeSessionActive && this.crudeLive && !initial) {
      try {
        if (this.liveLegs.length) {
          await delay(1200);
        }
        const todayBars = await this.fetch5m({
          instrumentToken: this.crudeLive.futuresToken,
          from: `${today} 09:00:00`,
          to: `${today} 23:30:00`,
          authorization,
        });
        const prior = this.crudeLive.candles.filter((c) => datePart(c.date) !== today);
        this.crudeLive.candles = [...prior, ...todayBars];
      } catch {
        // keep previous
      }
    }

    if (natGasSessionActive && this.natGasLive && !initial) {
      try {
        if (this.liveLegs.length || this.crudeLive) {
          await delay(1200);
        }
        const todayBars = await this.fetch5m({
          instrumentToken: this.natGasLive.futuresToken,
          from: `${today} 09:00:00`,
          to: `${today} 23:30:00`,
          authorization,
        });
        const prior = this.natGasLive.candles.filter((c) => datePart(c.date) !== today);
        this.natGasLive.candles = [...prior, ...todayBars];
      } catch {
        // keep previous
      }
    }

    const needed = new Set<number>();
    const emptyOpt = new Map<number, Candle[]>();
    const indexTrades: PaperTrade[] = [];
    let crudeTrades: PaperTrade[] = [];
    let natGasTrades: PaperTrade[] = [];
    const statuses: PaperInstrumentStatus[] = [];
    const kuttyMargin = { usedRs: 0, trapOpenLegs: 0 };

    if (indexSessionActive) {
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
          lotsMultiplier: this.lotsForInstrument(leg.instrument.id),
          strategy: resolved.primary,
          enableKutty: this.deskRunOptions.enableKutty,
          kuttyAlone: this.deskRunOptions.kuttyAlone,
          kuttyMargin,
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
        indexTrades.push(...replay.trades);
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
                  indexStop: effectiveProtectiveStop(replay.open),
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
            lastSignal:
              now >= '15:15' && !replay.open
                ? 'Index session closed (15:15) — no new entries'
                : replay.lastSignal,
            tradesToday: replay.trades.length,
            strategyId: resolved.primary.id,
            strategyName: resolved.primary.name,
            maxTradesPerDay: resolved.primary.getSettings().maxTradesPerDay,
          }),
        );
      }
      this.lastIndexStatuses = statuses.map((s) => ({ ...s }));
    } else if (anyIndexLegs && this.lastIndexStatuses.length) {
      for (const s of this.lastIndexStatuses) {
        statuses.push({
          ...s,
          openTrade: null,
          lastSignal: 'Index session closed (15:15) · MCX continues',
          livePhase: s.livePhase === 'in_trade' ? 'exited' : s.livePhase,
          livePhaseLabel:
            s.livePhase === 'in_trade' ? 'Index session closed' : s.livePhaseLabel,
        });
      }
    }

    if (crudeSessionActive && this.crudeLive) {
      const crudeTradeParams = resolveCrudeStrategyProfile('selective');
      const crudeDayLossPts = resolveCrudeProfileDayLossPts(crudeTradeParams, false);
      const replay = replayPaperOnCrude({
        instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
        instrumentName: `${CRUDE_OIL_MINI_INSTRUMENT.name} (${this.crudeLive.futuresSymbol})`,
        candles: this.crudeLive.candles,
        fromDate: today,
        toDate: today,
        instruments: allInstruments,
        optionCandlesByToken: emptyOpt,
        neededOptionTokens: needed,
        forceCloseOpen: now >= CRUDE_EXIT_BY,
        lotsMultiplier: this.crudeLots,
        dayLossStopPts: crudeDayLossPts,
        enableMorning: crudeTradeParams.defaultEnableMorning,
        enableEvening: crudeTradeParams.defaultEnableEvening,
        tradeParams: crudeTradeParams,
      });
      crudeTrades = replay.trades;
      statuses.push(
        withLiveFields({
          instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
          instrumentName: `${CRUDE_OIL_MINI_INSTRUMENT.name} (${this.crudeLive.futuresSymbol})`,
          lastBarTime: this.crudeLive.candles.at(-1)?.date ?? null,
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
          strategyId: 'crude-selective',
          strategyName: crudeTradeParams.label,
          maxTradesPerDay: crudeTradeParams.maxEveningTradesDay,
        }),
      );
    }

    if (natGasSessionActive && this.natGasLive) {
      const natGasTradeParams = resolveCrudeStrategyProfile('daily-profit-ng');
      const natGasDayLossPts = resolveCrudeProfileDayLossPts(natGasTradeParams, false);
      const natGasResolve = this.natGasOptionResolve();
      const replay = replayPaperOnCrude({
        instrumentId: NATGAS_MINI_INSTRUMENT.id,
        instrumentName: `${NATGAS_MINI_INSTRUMENT.name} (${this.natGasLive.futuresSymbol})`,
        candles: this.natGasLive.candles,
        fromDate: today,
        toDate: today,
        instruments: allInstruments,
        optionCandlesByToken: emptyOpt,
        neededOptionTokens: needed,
        forceCloseOpen: now >= CRUDE_EXIT_BY,
        lotsMultiplier: this.natGasLots,
        dayLossStopPts: natGasDayLossPts,
        enableMorning: natGasTradeParams.defaultEnableMorning,
        enableEvening: natGasTradeParams.defaultEnableEvening,
        tradeParams: natGasTradeParams,
        ...natGasResolve,
      });
      natGasTrades = replay.trades;
      statuses.push(
        withLiveFields({
          instrumentId: NATGAS_MINI_INSTRUMENT.id,
          instrumentName: `${NATGAS_MINI_INSTRUMENT.name} (${this.natGasLive.futuresSymbol})`,
          lastBarTime: this.natGasLive.candles.at(-1)?.date ?? null,
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
          strategyId: 'natgas-daily-profit-ng',
          strategyName: natGasTradeParams.label,
          maxTradesPerDay: natGasTradeParams.maxEveningTradesDay,
        }),
      );
    }

    const optionCandles = await this.fetchOptionHistories(
      [...needed],
      shiftDate(today, -5),
      today,
      authorization,
      undefined,
      mcxEnabled ? '23:30:00' : '15:30:00',
    );
    let enriched = this.enrichMixedLots(
      this.premiumEnrichMixed(indexTrades, [...crudeTrades, ...natGasTrades], optionCandles),
    );

    for (const s of statuses) {
      const mine = enriched.filter((t) => t.instrumentId === s.instrumentId);
      s.dayNetOptionRs = mine.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
      s.tradesToday = mine.length;
      applyLivePhase(s, mine, true);
    }

    if (this.realOrders) {
      allInstruments = this.instrumentStore.allInstruments();
      for (const s of statuses) {
        if (s.openTrade && !this.isMcxInstrumentId(s.instrumentId)) {
          const kind: IndexOptionKind =
            s.instrumentId === NIFTY_50_INSTRUMENT.id ? 'nifty' : 'banknifty';
          let resolved = resolveAtmWeeklyOption({
            instruments: allInstruments,
            kind,
            direction: s.openTrade.direction,
            spot: s.openTrade.indexEntry,
            asOfDateTime: s.openTrade.entryTime,
          });
          if (resolved.source === 'synthetic') {
            try {
              await this.instrumentStore.refresh(true);
              allInstruments = this.instrumentStore.allInstruments();
            } catch {
              // keep synthetic; SKIP path will explain
            }
            resolved = resolveAtmWeeklyOption({
              instruments: allInstruments,
              kind,
              direction: s.openTrade.direction,
              spot: s.openTrade.indexEntry,
              asOfDateTime: s.openTrade.entryTime,
            });
          }
          const fresh = toOptionContract(resolved.instrument, resolved.source);
          s.openTrade = { ...s.openTrade, option: fresh };
          s.chosenOption = fresh;
          s.chosenBias = s.openTrade.direction;
        } else if (s.openTrade && s.instrumentId === CRUDE_OIL_MINI_INSTRUMENT.id) {
          const resolved = resolveAtmCrudeMiniOption({
            instruments: allInstruments,
            direction: s.openTrade.direction,
            spot: s.openTrade.indexEntry,
            asOfDateTime: s.openTrade.entryTime,
          });
          const fresh = toCrudePaperOption(resolved.instrument, resolved.source);
          s.openTrade = { ...s.openTrade, option: fresh };
          s.chosenOption = fresh;
          s.chosenBias = s.openTrade.direction;
        } else if (s.openTrade && s.instrumentId === NATGAS_MINI_INSTRUMENT.id) {
          const ng = this.natGasOptionResolve();
          const resolved = resolveAtmCrudeMiniOption({
            instruments: allInstruments,
            direction: s.openTrade.direction,
            spot: s.openTrade.indexEntry,
            asOfDateTime: s.openTrade.entryTime,
            prefixes: ng.optionPrefixes,
            strikeStep: ng.strikeStep,
            syntheticName: ng.syntheticName,
          });
          const fresh = toCrudePaperOption(resolved.instrument, resolved.source);
          s.openTrade = { ...s.openTrade, option: fresh };
          s.chosenOption = fresh;
          s.chosenBias = s.openTrade.direction;
        }

        await this.liveOrders.syncInstrument({
          authorization,
          instrumentId: s.instrumentId,
          instrumentName: s.instrumentName,
          lots: this.lotsForInstrument(s.instrumentId),
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
          if (!this.isMcxInstrumentId(s.instrumentId)) {
            const kind: IndexOptionKind =
              s.instrumentId === NIFTY_50_INSTRUMENT.id ? 'nifty' : 'banknifty';
            const chainGap =
              s.openTrade.option?.source === 'synthetic'
                ? describeOptionChainGap({
                    instruments: allInstruments,
                    kind,
                    direction: s.openTrade.direction,
                    spot: s.openTrade.indexEntry,
                    asOfDateTime: s.openTrade.entryTime,
                  })
                : null;
            s.kiteBlockReason =
              this.liveOrders.getLastBlockReason(s.instrumentId) ??
              (chainGap
                ? `Synthetic/missing NFO option — ${chainGap}`
                : 'Kite entry not confirmed — see Event log');
          } else {
            s.kiteBlockReason =
              this.liveOrders.getLastBlockReason(s.instrumentId) ??
              'Kite entry not confirmed — see Event log';
          }
          s.livePhaseLabel = `Signal only · not on Kite`;
        } else {
          s.kiteBlockReason = null;
        }
        if (pos?.status === 'flat' && s.lastExitReason?.toLowerCase().includes('target')) {
          s.livePhase = 'target_hit';
          s.livePhaseLabel = 'Target achieved';
        }
        if (s.openTrade && pos?.entryPremium != null && pos.entryPremium > 0) {
          s.openTrade = { ...s.openTrade, optionEntryPremium: pos.entryPremium };
        }
      }

      enriched = applyKiteFillPnl(enriched, this.liveOrders.getOrderSummary());
      enriched = this.enrichMixedLots(enriched);
      for (const s of statuses) {
        const mine = enriched.filter((t) => t.instrumentId === s.instrumentId);
        s.dayNetOptionRs = mine.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
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
    const inTrade = statuses.filter(
      (s) => s.openTrade && (!this.realOrders || !!s.brokerEntryOrderId),
    ).length;
    const blocked = statuses.filter(
      (s) => !!s.kiteBlockReason && !!s.openTrade && !s.brokerEntryOrderId,
    ).length;
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
    const openMsg = openBits.length ? ` · ON KITE: ${openBits.join(' · ')}` : '';
    const blockedMsg = blockedBits.length
      ? ` · NOT ON KITE (${blocked}): ${blockedBits.join(' · ')}`
      : '';
    const clockMsg =
      mcxEnabled && now >= '15:15'
        ? ' · Index closed · MCX continues'
        : mcxEnabled
          ? ' · Index→15:15 · MCX→23:10'
          : '';
    this.snapshot.set({
      mode: 'live',
      running: true,
      fromDate: today,
      toDate: today,
      marketOpen: true,
      realOrders: this.realOrders,
      lastTickAt: new Date().toISOString(),
      message: `${moneyTag} · alive ${now}${clockMsg} · waiting ${waiting} · in trade ${inTrade}${targets ? ` · target hit ${targets}` : ''}${openMsg}${blockedMsg} · ${this.kiteStatsLabel()}`,
      statuses,
      trades: enriched.sort((a, b) => b.entryTime.localeCompare(a.entryTime)),
      totals: summarize(enriched, (id) => this.lotsForInstrument(id), this.lotsMultiplier),
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
    opts: { includeCrude?: boolean; includeNatGas?: boolean } | boolean = {},
  ): Promise<PaperInstrumentStatus[]> {
    const includeCrude = typeof opts === 'boolean' ? opts : !!opts.includeCrude;
    const includeNatGas = typeof opts === 'boolean' ? false : !!opts.includeNatGas;
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

    if (includeCrude) {
      const future = resolveCrudeOilMiniFuturesToken(allInstruments);
      let spot: number | null = null;
      let asOf = `${today} 15:15:00`;
      let symbol = CRUDE_OIL_MINI_INSTRUMENT.tradingSymbol;
      if (future && authorization) {
        symbol = future.tradingSymbol;
        try {
          if (activeRows.length) {
            await delay(1200);
          }
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
      statuses.push(
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
          lastSignal:
            spot != null
              ? `Preview ATM @ ${spot.toFixed(1)} · Selective`
              : 'Preview ATM (spot fallback) · Selective',
          tradesToday: 0,
          strategyId: 'crude-selective',
          strategyName: 'Selective (≤2/day · SL20/TP40)',
        }),
      );
    }

    if (includeNatGas) {
      const future = resolveNatGasMiniFuturesToken(allInstruments);
      let spot: number | null = null;
      let asOf = `${today} 15:15:00`;
      let symbol = NATGAS_MINI_INSTRUMENT.tradingSymbol;
      if (future && authorization) {
        symbol = future.tradingSymbol;
        try {
          if (activeRows.length || includeCrude) {
            await delay(1200);
          }
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
      const ng = this.natGasOptionResolve();
      const resolved = resolveAtmCrudeMiniOption({
        instruments: allInstruments,
        direction: 'BUY',
        spot: spot ?? 250,
        asOfDateTime: asOf,
        prefixes: ng.optionPrefixes,
        strikeStep: ng.strikeStep,
        syntheticName: ng.syntheticName,
      });
      const chosenOption = toCrudePaperOption(resolved.instrument, resolved.source);
      statuses.push(
        withLiveFields({
          instrumentId: NATGAS_MINI_INSTRUMENT.id,
          instrumentName: `${NATGAS_MINI_INSTRUMENT.name} (${symbol})`,
          lastBarTime: asOf,
          dayNetIndexPts: 0,
          dayNetOptionRs: 0,
          openTrade: null,
          chosenOption,
          chosenBias: 'BUY',
          indexSpot: spot ?? chosenOption.strike,
          chosenAsOf: asOf,
          lastSignal:
            spot != null
              ? `Preview ATM @ ${spot.toFixed(1)} · Daily Profit (NG)`
              : 'Preview ATM (spot fallback) · Daily Profit (NG)',
          tradesToday: 0,
          strategyId: 'natgas-daily-profit-ng',
          strategyName: 'Daily Profit (NG)',
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
    endTime: string = '15:30:00',
  ): Promise<Map<number, Candle[]>> {
    const map = new Map<number, Candle[]>();
    // Most-traded tokens first so busy books (Trap) get real OHLC before the cap.
    // Cap raised from 24 — old limit left most Trap weeks on est. premium (Index ₹ proxy).
    const unique = rankTokensByFrequency(tokens).slice(0, MAX_OPTION_HISTORY_TOKENS);
    for (let i = 0; i < unique.length; i += 1) {
      if (runId != null) {
        this.assertActive(runId);
      }
      const token = unique[i]!;
      if (i > 0) {
        await delay(500);
      }
      try {
        const candles = await this.fetch5m({
          instrumentToken: token,
          from: `${fromDate} 09:00:00`,
          to: `${toDate} ${endTime}`,
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
    requireCrude?: boolean;
    requireNatGas?: boolean;
  }): Promise<Instrument[]> {
    const patchStatus = options?.patchStatus !== false;
    const requireMinimum = options?.requireMinimum !== false;
    const requireCrude = !!options?.requireCrude;
    const requireNatGas = !!options?.requireNatGas;
    const natGasPrefixes = this.natGasOptionResolve().optionPrefixes;
    const needIndex =
      this.deskRunOptions.enableNifty ||
      this.deskRunOptions.enableBank ||
      (!requireCrude && !requireNatGas);

    await this.instrumentStore.ensureLoaded();
    let allInstruments = this.instrumentStore.allInstruments();

    if (needIndex && countIndexOptions(allInstruments) < 100) {
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

    if (requireCrude && countCrudeMiniOptions(allInstruments) < 20) {
      if (patchStatus) {
        this.patchMessage('Refreshing MCX crude instruments…');
      }
      const refreshed = await this.instrumentStore.refreshBestEffort(true);
      allInstruments = this.instrumentStore.allInstruments();
      if (!refreshed && requireMinimum && countCrudeMiniOptions(allInstruments) < 5) {
        throw new Error(
          'Could not load MCX crude options. Check internet, then Settings → Refresh Instruments.',
        );
      }
    }

    const natGasFutMissing = requireNatGas && !resolveNatGasMiniFuturesToken(allInstruments);
    if (
      requireNatGas &&
      (natGasFutMissing || countCrudeMiniOptions(allInstruments, natGasPrefixes) < 20)
    ) {
      if (patchStatus) {
        this.patchMessage(
          natGasFutMissing
            ? 'Nat Gas futures missing from cache — refreshing instruments…'
            : 'Refreshing MCX Nat Gas instruments…',
        );
      }
      const refreshed = await this.instrumentStore.refreshBestEffort(true);
      allInstruments = this.instrumentStore.allInstruments();
      if (
        !refreshed &&
        requireMinimum &&
        (countCrudeMiniOptions(allInstruments, natGasPrefixes) < 5 ||
          !resolveNatGasMiniFuturesToken(allInstruments))
      ) {
        throw new Error(
          'Could not load MCX Nat Gas instruments. Check internet / Get Token, then Settings → Refresh Instruments.',
        );
      }
    }

    if (patchStatus) {
      const bits = [
        needIndex ? `${countIndexOptions(allInstruments)} index options` : null,
        requireCrude ? `${countCrudeMiniOptions(allInstruments)} crude options` : null,
        requireNatGas
          ? `${countCrudeMiniOptions(allInstruments, natGasPrefixes)} natgas options`
          : null,
      ].filter(Boolean);
      this.patchMessage(`Instruments ready · ${bits.join(' · ')}`);
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
    totals: {
      trades: 0,
      wins: 0,
      losses: 0,
      indexNetPts: 0,
      optionNetRs: 0,
      lotsUsed: 1,
      pointsMoneyRs: 0,
      premiumEstimatedCount: 0,
    },
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
  lotsUsedOrResolver: number | ((instrumentId: string) => number) = 1,
  rupeesPerPoint: number = PDHL_RUPEES_PER_POINT,
): PaperDeskSnapshot['totals'] {
  const lotsFor =
    typeof lotsUsedOrResolver === 'function'
      ? lotsUsedOrResolver
      : () => Math.max(1, Math.floor(lotsUsedOrResolver) || 1);
  const displayLots =
    typeof lotsUsedOrResolver === 'function'
      ? Math.max(1, ...trades.map((t) => lotsFor(t.instrumentId)), 1)
      : Math.max(1, Math.floor(lotsUsedOrResolver) || 1);
  const indexNetPts = trades.reduce((a, t) => a + t.indexPoints, 0);
  const optionNetRs = trades.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
  const optionChargesRs = trades.reduce((a, t) => a + (t.chargesRs ?? 0), 0);
  // Prefer per-instrument ₹/pt (Nifty 65 / Bank 30 / Crude 10) × per-book lots.
  const pointsMoneyRs = trades.reduce((a, t) => {
    const rpp = rupeesPerPointForInstrument(t.instrumentId) || rupeesPerPoint;
    return a + t.indexPoints * rpp * lotsFor(t.instrumentId);
  }, 0);
  const pointsFallback =
    trades.length === 0 ? 0 : pointsMoneyRs || indexNetPts * rupeesPerPoint * displayLots;
  return {
    trades: trades.length,
    wins: trades.filter((t) => t.outcome === 'WIN').length,
    losses: trades.filter((t) => t.outcome === 'LOSS').length,
    indexNetPts,
    optionNetRs,
    lotsUsed: displayLots,
    pointsMoneyRs: pointsFallback,
    optionChargesRs,
    optionNetAfterChargesRs: Math.round((optionNetRs - optionChargesRs) * 100) / 100,
    premiumEstimatedCount: trades.filter((t) => t.premiumEstimated).length,
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


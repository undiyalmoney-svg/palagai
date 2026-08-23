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
import { deskLegHasKiteEntry, syncTradesToKiteFills } from './apply-kite-fill-pnl';
import {
  isStaleStartSignal,
  nowIstStamp,
  staleStartReason,
} from '../live-desk/live-start-guard.util';
import { INDEX_SESSION_EXIT_HHMM } from '../live-desk/live-drain-hold.util';
import { dropFormingBars } from './forming-bar.util';
import {
  missedRoundTripReason,
  splitCompletedRoundTrips,
} from './completed-round-trip.util';
import { repriceTradesToExecutableFills } from './executable-fill.util';
import {
  combinedOptionDayNetRs,
  isOptionDayLossBreached,
  optionDayLossLegKey,
  optionDayLossReason,
} from './option-day-loss.util';
import { researchLockedNetRs } from './research-locked-pnl.util';
import { enrichTradesWithCharges } from './trade-charges.util';
import { buildPaperDeskDayStats, emptyPaperDeskDayStats } from './paper-desk-day-stats';
import { MAX_OPTION_HISTORY_TOKENS, rankTokensByFrequency } from './option-history-tokens.util';
import {
  PDHL_RUPEES_PER_POINT,
  buildDeskRiskOverrides,
  buildIndexDeskRiskSettings,
  deskDayProfitLockMoneyRs,
  deskStrictDayLossMoneyRs,
  rupeesPerPointForInstrument,
} from '../strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator';
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
  /**
   * @deprecated Ignored — Trade Desk is Nifty+Bank only.
   * Kept so callers (UI preset) still type-check.
   */
  crudeLots?: number;
  /**
   * @deprecated Ignored — Trade Desk is Nifty+Bank only.
   */
  natGasLots?: number;
  realOrders?: boolean;
  enableNifty?: boolean;
  enableBank?: boolean;
  /**
   * @deprecated Always forced false — Trade Desk is Nifty+Bank only.
   * Kept so callers (UI) still type-check.
   */
  enableCrude?: boolean;
  /**
   * @deprecated Always forced false — Trade Desk is Nifty+Bank only.
   */
  enableNatGas?: boolean;
  /** Combined strict day loss ≈ −₹2,950 (split if both index books on). */
  strictDayStop?: boolean;
  /** Combined day profit lock ≈ +₹3,000 (split if both index books on). */
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
  /** Live money: only hook placeEntry/Exit for bars after this candle time. */
  lastLiveEventAt: string | null;
}

type IndexLiveBrokerEvent =
  | {
      kind: 'open';
      instrumentId: string;
      instrumentName: string;
      open: {
        direction: 'BUY' | 'SELL';
        entryTime: string;
        indexEntry: number;
        indexStop: number;
        option: PaperTrade['option'];
        optionEntryPremium: number | null;
      };
    }
  | {
      kind: 'close';
      instrumentId: string;
      instrumentName: string;
      entryTime: string;
      /** Paper exit reason — Live may hold option when index drained but option red. */
      exitReason?: string;
    };

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
  /** Prevent overlapping tickLive polls (15s tick can outrun itself). */
  private liveTickInFlight = false;
  private liveLegs: LiveLeg[] = [];
  private liveTrades: PaperTrade[] = [];
  /** Dedup Event log for desk-only legs (never on Kite). */
  private loggedDeskOnlyTradeIds = new Set<string>();
  private historicalCalls = 0;
  private lastRangeDays = 0;
  private realOrders = false;
  /** IST stamp of the Start press — signals older than this are not chased. */
  private liveStartedAt: string | null = null;
  /** Instruments already reported as "signal predates Start" (log once). */
  private readonly staleStartLogged = new Set<string>();
  /** Round trips already reported as finished-before-we-saw-them (log once). */
  private readonly missedRoundTripLogged = new Set<string>();
  /** Fallback lots (legacy). Prefer per-book lots below. */
  private lotsMultiplier = 1;
  private niftyLots = 1;
  private bankLots = 1;
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
    enableCrude: false,
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
    void this.stopLive({ flatten: this.snapshot().realOrders });
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
    // Trade Desk is Nifty+Bank only — ignore caller enableCrude / enableNatGas.
    const enableCrude = false;
    const enableNatGas = false;
    if (!enableNifty && !enableBank) {
      throw new Error('Select at least one book: Nifty 50 or Bank Nifty.');
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
  }

  private lotsForInstrument(instrumentId: string): number {
    if (instrumentId === NIFTY_50_INSTRUMENT.id) {
      return this.niftyLots;
    }
    if (instrumentId === BANK_NIFTY_INSTRUMENT.id) {
      return this.bankLots;
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
  }

  /** Apply charge estimates with per-book lots (Nifty / Bank may differ). */
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

  private premiumEnrichIndex(
    indexTrades: PaperTrade[],
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
    return enrichedIndex;
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
  /**
   * Paper and Live must resolve the same strategy module + DNA.
   * Mode only selects which assignment slot is read; Trade Desk hands-off
   * forces paper≡live Trap via `forceTrapDefaultsForDaily3k`.
   */
  private resolveDeskStrategy(kind: IndexOptionKind, mode: 'paper' | 'live') {
    const channel = this.channelForKind(kind);
    const instrumentId = kind === 'nifty' ? NIFTY_50_INSTRUMENT.id : BANK_NIFTY_INSTRUMENT.id;
    const pdhl = this.pdhlOverridesFor(instrumentId);
    this.strategyManager.applyChampionDeskOverrides(pdhl ?? null);
    const resolved = this.strategyManager.resolve(channel, mode);
    /**
     * Research Locked months (Jul ₹65,041) use a *post-hoc* ₹3k day cap on index
     * proxy — they do NOT stop entries mid-day. In-strategy dayProfitLockPts is
     * Live capital protection only. Testing keeps dayProfitLockPts=0 so the
     * Locked side meter can still match the published table; Profit ₹ is option money.
     */
    this.strategyManager.applyIndexDeskRiskSettings(
      resolved.primary,
      buildIndexDeskRiskSettings({
        instrumentId,
        enableNifty: this.deskRunOptions.enableNifty,
        enableBank: this.deskRunOptions.enableBank,
        strictDayStop: this.deskRunOptions.strictDayStop,
        dayProfitLock: mode === 'live' ? this.deskRunOptions.dayProfitLock : false,
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
    ]
      .filter(Boolean)
      .join('+');
    const lockLots = this.deskRunOptions.enableNifty
      ? this.niftyLots
      : this.deskRunOptions.enableBank
        ? this.bankLots
        : this.niftyLots;
    const risk = [
      this.deskRunOptions.strictDayStop
        ? `strict −₹${deskStrictDayLossMoneyRs(lockLots)}`
        : null,
      this.deskRunOptions.dayProfitLock
        ? `profit lock +₹${deskDayProfitLockMoneyRs(lockLots)}`
        : null,
      this.deskRunOptions.kuttyAlone
        ? 'Kutty alone'
        : this.deskRunOptions.enableKutty
          ? 'Kutty on'
          : null,
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
      const allInstruments = await this.loadOptionInstruments();
      this.assertActive(runId);

      const active = this.activeInstruments();

      const allEnriched: PaperTrade[] = [];
      /** Index-only trades (no option-MFE gate) for published Locked ₹ side meter. */
      const allLockedIndexTrades: PaperTrade[] = [];
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
          // Same closed-bar series Live uses — never replay a forming 5m bar.
          candleMap.set(instrument.id, dropFormingBars(candles));
        }

        const needed = new Set<number>();
        const emptyOpt = new Map<number, Candle[]>();
        /** Per-instrument entry map for shadow (full batch). */
        const primaryActionsById = new Map<string, Map<string, string>>();
        const days = chunkInclusiveDateRange(batch.fromDate, batch.toDate, 1);

        // Pass 1 — index-only (no option OHLC): discover ATM tokens + Locked meter trades.
        for (const dayChunk of days) {
          const day = dayChunk.fromDate;
          for (const { instrument, kind } of active) {
            const candles = candleMap.get(instrument.id) ?? [];
            const resolved = this.resolveDeskStrategy(kind, 'paper');
            const discover = replayPaperOnIndex({
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
              enableKutty: false,
              kuttyAlone: false,
            });
            allLockedIndexTrades.push(...discover.trades);
          }
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
          '15:30:00',
        );
        this.assertActive(runId);

        // Pass 2 — same DNA with option OHLC so peak-trail option-MFE gate = Live.
        const batchIndexTrades: PaperTrade[] = [];
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
              optionCandlesByToken: optionCandles,
              neededOptionTokens: new Set(),
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

        // Testing Profit ₹ = option money (same executable path as Live paper).
        const enriched = repriceTradesToExecutableFills(
          this.premiumEnrichIndex(batchIndexTrades, optionCandles),
          candleMap,
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
      const totals = summarize(sorted, (id) => this.lotsForInstrument(id), this.lotsMultiplier);
      // Locked ₹ from index-only pass (published Jul ₹65,041) — not option-gated trades.
      const lockedRs = researchLockedNetRs(allLockedIndexTrades, {
        lotsForInstrument: (id) => this.lotsForInstrument(id),
      });
      totals.researchLockedNetRs = lockedRs;

      this.snapshot.set({
        mode: 'testing',
        running: false,
        fromDate,
        toDate,
        marketOpen: true,
        realOrders: false,
        lastTickAt: null,
        message: `Testing complete · ${sorted.length} paper trade(s) · Profit ₹${Math.round(totals.optionNetAfterChargesRs ?? totals.optionNetRs).toLocaleString('en-IN')} · Locked ₹${Math.round(lockedRs).toLocaleString('en-IN')} · ${batches.length} batch(es) · ${this.deskOptionsLabel()} · ${this.kiteStatsLabel()}`,
        statuses,
        trades: sorted,
        totals,
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
    const clearIds = active.map((i) => i.instrument.id);
    // Soft clear — never wipe the other desk's open SL / adopt map.
    this.liveOrders.clearInstruments(clearIds);
    this.liveOrders.setLotsMultiplier(this.lotsMultiplier);
    this.applyBookLotsToLiveOrders();
    const today = todayIso();
    const now = istNowHhMm();
    const anyIndex = this.deskRunOptions.enableNifty || this.deskRunOptions.enableBank;
    const indexOpen = now >= '09:15' && now <= '15:30';
    const sessionOpenNow = anyIndex && indexOpen;
    // Allow Start any morning time — selected books arm automatically at their open.
    const canDeferStart = anyIndex;

    if (!sessionOpenNow && !canDeferStart) {
      try {
        const allInstruments = await this.loadOptionInstruments({
          patchStatus: false,
          requireMinimum: false,
        });
        const statuses = await this.previewChosenInstruments(today, allInstruments, active);
        this.snapshot.set({
          ...emptySnapshot('live'),
          fromDate: today,
          toDate: today,
          marketOpen: false,
          message: `Outside hours for selected books (now ${now}). Index 09:15–15:30. Showing ATM picks — use Testing after hours.`,
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
      marketOpen: sessionOpenNow,
      realOrders: this.realOrders,
      message: !sessionOpenNow
        ? `Live armed — waiting for open (now ${now}). Index 09:15. Selected books auto-join.`
        : this.realOrders
          ? `Starting LIVE MONEY desk (${this.deskOptionsLabel()})…`
          : `Starting live paper (${this.deskOptionsLabel()})…`,
      kiteStats: this.kiteStats(),
    });

    try {
      this.assertActive(runId);
      const authorization = this.requireAuth();
      await this.loadOptionInstruments({
        patchStatus: false,
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
      this.liveTrades = [];
      this.loggedDeskOnlyTradeIds.clear();
      this.staleStartLogged.clear();
      this.missedRoundTripLogged.clear();
      // Start anytime: the replay rebuilds the whole day, so remember when the
      // user actually pressed Start and only take signals from here on.
      this.liveStartedAt = nowIstStamp();

      // Always register selected index books — fetch lookback even before 09:15 so they
      // auto-join the tick loop when the cash session opens (any morning Start time).
      if (anyIndex) {
        for (let i = 0; i < active.length; i += 1) {
          this.assertActive(runId);
          const row = active[i]!;
          if (i > 0) {
            await delay(1500);
          }
          let candles: Candle[] = [];
          try {
            candles = dropFormingBars(
              await this.fetch5m({
                instrumentToken: row.instrument.instrumentToken,
                from: `${lookbackFrom} 09:00:00`,
                to: `${today} 15:30:00`,
                authorization,
                runId,
              }),
            );
          } catch {
            candles = [];
          }
          this.liveLegs.push({
            instrument: row.instrument,
            kind: row.kind,
            candles,
            processedThrough: -1,
            resultTrades: [],
            // Watermark = last *closed* bar so the next completed bar still hooks once.
            lastLiveEventAt: candles.at(-1)?.date ?? null,
          });
        }
      }

      await this.tickLive(true);
      this.assertActive(runId);

      // Live money: poll faster so open→SL inside one bar still hits Kite.
      const tickMs =
        this.realOrders &&
        (this.deskRunOptions.enableNifty || this.deskRunOptions.enableBank)
          ? 15_000
          : 60_000;
      this.liveTimer = setInterval(() => {
        void this.tickLive(false);
      }, tickMs);
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
      void this.stopLive({ flatten: false });
      throw err;
    } finally {
      if (runId === this.runGeneration) {
        this.busy.set(false);
      }
    }
  }

  /**
   * Stop polling. On Live money, MARKET-flatten any open MIS first
   * (owner Stop after 15:15 must square off — never leave drain-HOLD legs).
   */
  async stopLive(opts?: { flatten?: boolean; reason?: string }): Promise<void> {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    const cur = this.snapshot();
    let flattenBit = '';
    const doFlatten = opts?.flatten !== false && cur.mode === 'live' && cur.realOrders;
    if (doFlatten) {
      try {
        const authorization = this.kiteSession.getAuthorizationHeader();
        if (authorization && this.liveOrders.hasOpenPositions()) {
          const r = await this.liveOrders.flattenAllOpen(
            authorization,
            opts?.reason ?? 'Stop — flatten open MIS',
          );
          flattenBit =
            r.attempted > 0
              ? ` · flattened ${r.flat}/${r.attempted}`
              : ' · no open MIS';
        } else if (authorization) {
          flattenBit = ' · no open MIS';
        }
      } catch (err) {
        flattenBit = ` · flatten failed: ${formatUnknownError(err, 'flatten')}`;
      }
    }
    if (cur.mode === 'live' && (cur.running || flattenBit)) {
      const base = cur.message.includes('complete')
        ? cur.message
        : cur.realOrders
          ? `Live money stopped${flattenBit}`
          : 'Live paper stopped';
      this.snapshot.set({
        ...cur,
        running: false,
        message: base,
        orderEvents: this.liveOrders.getEvents(),
        orderSummary: this.liveOrders.getOrderSummary(),
      });
    }
  }

  private async tickLive(initial: boolean): Promise<void> {
    if (this.liveTickInFlight) {
      return;
    }
    this.liveTickInFlight = true;
    try {
      await this.tickLiveBody(initial);
    } catch (err) {
      // Hands-off: never let a dead token / transient Kite error kill the poll
      // loop silently. Surface the fault; next 15s tick retries (or owner Get Token).
      const msg = formatUnknownError(err, 'Live tick');
      this.snapshot.update((s) => ({
        ...s,
        message: `Live tick error — retrying: ${msg}`,
      }));
    } finally {
      this.liveTickInFlight = false;
    }
  }

  private async tickLiveBody(initial: boolean): Promise<void> {
    const today = todayIso();
    const now = istNowHhMm();
    const anyIndexLegs = this.liveLegs.length > 0;

    // Backup stop after broker square-off window; primary EOD is 15:15 flatten below.
    if (now > '15:30') {
      await this.stopLive({
        flatten: true,
        reason: 'Market closed (after 15:30) — flatten open MIS',
      });
      this.snapshot.update((s) => ({
        ...s,
        marketOpen: false,
        running: false,
        message: s.realOrders
          ? 'Market closed (after 15:30). Live money stopped — MIS flattened.'
          : 'Market closed (after 15:30). Live paper stopped.',
      }));
      return;
    }

    const indexSessionActive = anyIndexLegs && now >= '09:15' && now <= '15:30';
    const sessionClosed = now >= INDEX_SESSION_EXIT_HHMM;

    if (!indexSessionActive) {
      this.snapshot.update((s) => ({
        ...s,
        marketOpen: false,
        message: `Waiting for open. Now ${now} · Index 09:15`,
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
            leg.candles = dropFormingBars(
              await this.fetch5m({
                instrumentToken: leg.instrument.instrumentToken,
                from: `${shiftDate(today, -12)} 09:00:00`,
                to: `${today} 15:30:00`,
                authorization,
              }),
            );
          } else {
            const todayBars = await this.fetch5m({
              instrumentToken: leg.instrument.instrumentToken,
              from: `${today} 09:00:00`,
              to: `${today} 15:30:00`,
              authorization,
            });
            const prior = leg.candles.filter((c) => datePart(c.date) !== today);
            // Forming bar repaints between 15s ticks — that churned three Bank
            // round trips inside one candle on 2026-08-07.
            leg.candles = dropFormingBars([...prior, ...todayBars]);
          }
        } catch {
          // keep previous candles
        }
      }
    }

    const needed = new Set<number>();
    const emptyOpt = new Map<number, Candle[]>();
    const indexTrades: PaperTrade[] = [];
    const statuses: PaperInstrumentStatus[] = [];
    const kuttyMargin = { usedRs: 0, trapOpenLegs: 0 };
    let optionCandles = new Map<number, Candle[]>();

    const indexBrokerEvents: IndexLiveBrokerEvent[] = [];

    if (indexSessionActive) {
      // Pass 1 — discover ATM tokens (no broker hook; Kutty off).
      for (const leg of this.liveLegs) {
        const resolved = this.resolveDeskStrategy(leg.kind, 'live');
        replayPaperOnIndex({
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
          enableKutty: false,
          kuttyAlone: false,
        });
      }

      // Same lookback as Testing — feed option OHLC into exit DNA (MFE trail gate).
      optionCandles = await this.fetchOptionHistories(
        [...needed],
        shiftDate(today, -12),
        today,
        authorization,
        undefined,
        '15:30:00',
      );

      for (const leg of this.liveLegs) {
        const resolved = this.resolveDeskStrategy(leg.kind, 'live');
        const primaryActions = new Map<string, string>();
        const liveHook =
          this.realOrders && !initial
            ? {
                afterBarTime: leg.lastLiveEventAt,
                onOpen: (o: {
                  direction: 'BUY' | 'SELL';
                  entryTime: string;
                  indexEntry: number;
                  indexStop: number;
                  option: PaperTrade['option'];
                  optionEntryPremium: number | null;
                }) => {
                  indexBrokerEvents.push({
                    kind: 'open',
                    instrumentId: leg.instrument.id,
                    instrumentName: leg.instrument.name,
                    open: o,
                  });
                },
                onClose: (entryTime: string, exitReason?: string) => {
                  indexBrokerEvents.push({
                    kind: 'close',
                    instrumentId: leg.instrument.id,
                    instrumentName: leg.instrument.name,
                    entryTime,
                    exitReason,
                  });
                },
              }
            : undefined;
        const replay = replayPaperOnIndex({
          instrumentId: leg.instrument.id,
          instrumentName: leg.instrument.name,
          kind: leg.kind,
          candles: leg.candles,
          fromDate: today,
          toDate: today,
          instruments: allInstruments,
          optionCandlesByToken: optionCandles,
          neededOptionTokens: new Set(),
          forceCloseOpen: now >= '15:15',
          lotsMultiplier: this.lotsForInstrument(leg.instrument.id),
          strategy: resolved.primary,
          enableKutty: this.deskRunOptions.enableKutty,
          kuttyAlone: this.deskRunOptions.kuttyAlone,
          kuttyMargin,
          liveHook,
        });
        // Advance watermark after warm tick and after each live poll.
        leg.lastLiveEventAt = leg.candles.at(-1)?.date ?? leg.lastLiveEventAt;
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
    }

    // Paper ≡ Live signal money: executable fills (next-bar open), then charges.
    // Enrich BEFORE broker flush so option-₹ stand-down sees this tick's closes
    // (Bank −309 + Nifty open in one batch must block the open — doc 51).
    const seriesForFills = new Map<string, Candle[]>();
    for (const leg of this.liveLegs) {
      seriesForFills.set(leg.instrument.id, leg.candles);
    }
    let enriched = this.enrichMixedLots(
      repriceTradesToExecutableFills(
        this.premiumEnrichIndex(indexTrades, optionCandles),
        seriesForFills,
      ),
    );

    for (const s of statuses) {
      const mine = enriched.filter((t) => t.instrumentId === s.instrumentId);
      s.dayNetOptionRs = mine.reduce(
        (a, t) => a + (t.netOptionPnlRs ?? t.optionPnlRs ?? 0),
        0,
      );
      s.tradesToday = mine.length;
      applyLivePhase(s, mine, true);
    }

    if (indexSessionActive && this.realOrders && indexBrokerEvents.length) {
      await this.flushIndexLiveBrokerEvents(
        authorization,
        indexBrokerEvents,
        allInstruments,
        enriched,
      );
      allInstruments = this.instrumentStore.allInstruments();
    }

    if (this.realOrders) {
      allInstruments = this.instrumentStore.allInstruments();
      /** instrumentId → why a pre-Start signal was not sent to Kite. */
      const staleStartIds = new Map<string, string>();
      for (const s of statuses) {
        if (s.openTrade) {
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
        }

        // Start anytime: never send a leg the strategy opened before Start as a
        // fresh MARKET entry — that chases an edge that is hours old. Legs Kite
        // already holds keep being managed (SL amend / exit) as normal.
        // At/after 15:15: never new MARKET entry — only flatten.
        const stale = sessionClosed
          ? true
          : isStaleStartSignal({
              signalEntryTime: s.openTrade?.entryTime,
              deskStartedAt: this.liveStartedAt,
              hasBrokerPosition: this.liveOrders.hasOpenPositionFor(
                s.instrumentId,
                s.openTrade?.option?.tradingSymbol,
              ),
              // Judge on price vs stop, not only the clock.
              signalEntryPrice: s.openTrade?.indexEntry,
              signalStopPrice: s.openTrade?.indexStop,
              currentPrice: s.indexSpot,
              direction: s.openTrade?.direction,
            });
        if (stale && s.openTrade && !sessionClosed) {
          staleStartIds.set(
            s.instrumentId,
            staleStartReason(s.openTrade.entryTime, this.liveStartedAt),
          );
          if (!this.staleStartLogged.has(s.instrumentId)) {
            this.staleStartLogged.add(s.instrumentId);
            this.liveOrders.pushDeskSkipEvent({
              instrumentId: s.instrumentId,
              instrumentName: s.instrumentName,
              detail: staleStartReason(s.openTrade.entryTime, this.liveStartedAt),
              tradingSymbol: s.openTrade.option?.tradingSymbol,
            });
          }
        }

        // Pass last exit reason so profit-drained HOLD is not MARKET-dumped on the
        // status sync that follows flush (paper already booked the candle exit).
        // At 15:15+ force EOD closeReason so drain latch cannot block flatten.
        const lastExit = enriched
          .filter((t) => t.instrumentId === s.instrumentId)
          .sort((a, b) => a.exitTime.localeCompare(b.exitTime))
          .at(-1);
        const combinedOptionNet = statuses.reduce(
          (a, row) => a + (row.dayNetOptionRs ?? 0),
          0,
        );
        const riskLots = Math.max(this.niftyLots, this.bankLots, 1);
        const optionDayLoss = isOptionDayLossBreached(combinedOptionNet, riskLots);
        const alreadyOnBroker = this.liveOrders.hasOpenPositionFor(
          s.instrumentId,
          s.openTrade?.option?.tradingSymbol,
        );
        // Stand-down blocks new entries only — never flatten a leg already on Kite.
        const blockNewDueToOptionLoss = optionDayLoss && !alreadyOnBroker;
        if (blockNewDueToOptionLoss && s.openTrade && !stale && !sessionClosed) {
          const key = `opt-day-loss:${s.instrumentId}`;
          if (!this.staleStartLogged.has(key)) {
            this.staleStartLogged.add(key);
            this.liveOrders.pushDeskSkipEvent({
              instrumentId: s.instrumentId,
              instrumentName: s.instrumentName,
              detail: optionDayLossReason(combinedOptionNet, riskLots),
              tradingSymbol: s.openTrade.option?.tradingSymbol,
            });
          }
        }
        const allowNewEntry =
          !!s.openTrade && !stale && !sessionClosed && !blockNewDueToOptionLoss;
        await this.liveOrders.syncInstrument({
          authorization,
          instrumentId: s.instrumentId,
          instrumentName: s.instrumentName,
          lots: this.lotsForInstrument(s.instrumentId),
          open: allowNewEntry
            ? {
                direction: s.openTrade!.direction,
                entryTime: s.openTrade!.entryTime,
                indexEntry: s.openTrade!.indexEntry,
                indexStop: s.openTrade!.indexStop,
                option: s.openTrade!.option,
                optionEntryPremium: s.openTrade!.optionEntryPremium,
              }
            : null,
          closeReason: sessionClosed
            ? 'EOD / session exit'
            : allowNewEntry
              ? undefined
              : (lastExit?.exitReason ?? undefined),
        });
        await delay(350);
      }
      // Restart orphans with no matching paper signal must exit (cancel SL → MARKET).
      const openSymbols = new Set(
        statuses
          .filter((s) => !!s.openTrade?.option?.tradingSymbol && !staleStartIds.has(s.instrumentId))
          .map((s) => s.openTrade!.option!.tradingSymbol.toUpperCase()),
      );
      await this.liveOrders.exitUnmappedOrphans(authorization, openSymbols);

      // 15:15+: square off every remaining MIS (including drain-HOLD latches).
      if (sessionClosed) {
        await this.liveOrders.flattenAllOpen(authorization, 'EOD / session exit 15:15');
      }
      for (const s of statuses) {
        const pos =
          this.liveOrders.getPositions().find((p) => p.instrumentId === s.instrumentId) ??
          this.liveOrders.getPositions().find(
            (p) =>
              !!s.openTrade?.option?.tradingSymbol &&
              p.tradingSymbol.toUpperCase() === s.openTrade.option.tradingSymbol.toUpperCase() &&
              (p.status === 'open' || p.status === 'exiting'),
          );
        s.brokerSlTrigger = pos?.slTrigger ?? null;
        s.brokerSlOrderId = pos?.slOrderId ?? null;
        s.brokerEntryOrderId = pos?.entryOrderId ?? null;
        const staleReason = staleStartIds.get(s.instrumentId);
        s.preStartSignal = !!staleReason;
        if (staleReason) {
          // Pre-Start signal: deliberately not on Kite, so don't call it a block.
          s.kiteBlockReason = staleReason;
          s.livePhaseLabel = 'Pre-Start signal · waiting for a fresh one';
        } else if (s.openTrade && !s.brokerEntryOrderId) {
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

      const nameById = new Map(statuses.map((s) => [s.instrumentId, s.instrumentName] as const));
      // Read today's fills back from Kite — session memory alone loses legs on refresh.
      try {
        await this.liveOrders.importFillsFromBroker(authorization);
      } catch {
        // Keep session rows; Profit ₹ still shows what we know.
      }
      // Kite fill pairs are Profit ₹ truth — including CE wins desk replay never built.
      enriched = syncTradesToKiteFills(
        enriched,
        this.liveOrders.getOrderSummary(),
        nameById,
      );
      enriched = this.enrichMixedLots(enriched);
      this.logDeskOnlyLegsNotOnKite(enriched);
      for (const s of statuses) {
        // Live money card ₹ = Kite-matched closed legs only (not desk-only replay).
        const mine = enriched.filter((t) => t.instrumentId === s.instrumentId && t.onKite);
        s.dayNetOptionRs = mine.reduce((a, t) => a + (t.optionPnlRs ?? 0), 0);
      }
    } else {
      for (const s of statuses) {
        s.kiteBlockReason = s.openTrade
          ? 'Live paper only — tick Real Orders + confirm to send MIS to Kite'
          : null;
      }
    }

    // Live money: Profit ₹ + trade list = Kite fills only. Desk replay can invent
    // legs that never got placeEntry (blocked / opened&closed between ticks).
    const deskSignalCount = enriched.length;
    const displayTrades = this.realOrders
      ? enriched.filter((t) => t.onKite)
      : enriched;
    const deskOnlyCount = this.realOrders
      ? Math.max(0, deskSignalCount - displayTrades.length)
      : 0;

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
    const deskOnlyMsg =
      deskOnlyCount > 0
        ? ` · ${deskOnlyCount} desk signal(s) NOT on Kite (hidden from Profit ₹)`
        : '';
    const brokerStillOpen = this.realOrders && this.liveOrders.hasOpenPositions();
    // After 15:15: keep polling only while MIS still open (retry flatten); else stop.
    const keepRunning = !sessionClosed || brokerStillOpen;
    const eodMsg = sessionClosed
      ? brokerStillOpen
        ? `${moneyTag} · ${now} · EOD 15:15 — flattening remaining MIS…`
        : `${moneyTag} · Session complete 15:15 — all flat. Live stopped.`
      : `${moneyTag} · alive ${now} · waiting ${waiting} · in trade ${inTrade}${targets ? ` · target hit ${targets}` : ''}${openMsg}${blockedMsg}${deskOnlyMsg} · ${this.kiteStatsLabel()}`;
    this.snapshot.set({
      mode: 'live',
      running: keepRunning,
      fromDate: today,
      toDate: today,
      marketOpen: !sessionClosed,
      realOrders: this.realOrders,
      lastTickAt: new Date().toISOString(),
      message: eodMsg,
      statuses,
      trades: displayTrades.sort((a, b) => b.entryTime.localeCompare(a.entryTime)),
      totals: summarize(displayTrades, (id) => this.lotsForInstrument(id), this.lotsMultiplier),
      dayStats: buildPaperDeskDayStats(displayTrades),
      kiteStats: this.kiteStats(),
      orderEvents: this.liveOrders.getEvents(),
      orderSummary: this.liveOrders.getOrderSummary(),
    });
    if (sessionClosed && !brokerStillOpen && this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
  }

  /**
   * Live money: apply Trap open/close from newly seen bars.
   *
   * Round trips that already finished are reported, not placed — buying and
   * selling them now captures the spread, never the modelled move.
   */
  private async flushIndexLiveBrokerEvents(
    authorization: string,
    events: IndexLiveBrokerEvent[],
    instruments: Instrument[],
    enrichedTrades: PaperTrade[] = [],
  ): Promise<void> {
    let allInstruments = instruments;
    const { actionable, missed } = splitCompletedRoundTrips(events);
    for (const m of missed) {
      const key = `${m.instrumentId}:${m.entryTime}`;
      if (this.missedRoundTripLogged.has(key)) {
        continue;
      }
      this.missedRoundTripLogged.add(key);
      this.liveOrders.pushDeskSkipEvent({
        instrumentId: m.instrumentId,
        instrumentName: m.instrumentName,
        detail: missedRoundTripReason(m.entryTime, m.exitReason),
      });
    }
    // Missed same-batch round trips never hit Kite — exclude from stand-down math.
    const missedKeys = new Set(
      missed.map((m) => optionDayLossLegKey(m.instrumentId, m.entryTime)),
    );
    // Current-tick enriched option ₹ (includes this tick's closes). Do NOT use the
    // prior snapshot — Bank −309 + Nifty open in one flush must stand down.
    const riskLots = Math.max(this.niftyLots, this.bankLots, 1);
    const combinedOptionNet = combinedOptionDayNetRs(enrichedTrades, missedKeys);
    const optionDayLoss = isOptionDayLossBreached(combinedOptionNet, riskLots);

    for (const ev of actionable) {
      if (ev.kind === 'open') {
        // Defense in depth: bar hooks only fire for new bars, but never let a
        // pre-Start bar reach placeEntry if the watermark is ever missing.
        if (
          isStaleStartSignal({
            signalEntryTime: ev.open.entryTime,
            deskStartedAt: this.liveStartedAt,
            hasBrokerPosition: this.liveOrders.hasOpenPositionFor(
              ev.instrumentId,
              ev.open.option?.tradingSymbol,
            ),
          })
        ) {
          this.liveOrders.pushDeskSkipEvent({
            instrumentId: ev.instrumentId,
            instrumentName: ev.instrumentName,
            detail: staleStartReason(ev.open.entryTime, this.liveStartedAt),
            tradingSymbol: ev.open.option?.tradingSymbol,
          });
          continue;
        }
        if (optionDayLoss) {
          this.liveOrders.pushDeskSkipEvent({
            instrumentId: ev.instrumentId,
            instrumentName: ev.instrumentName,
            detail: optionDayLossReason(combinedOptionNet, riskLots),
            tradingSymbol: ev.open.option?.tradingSymbol,
          });
          continue;
        }
        let option = ev.open.option;
        if (!option || option.source === 'synthetic' || option.instrumentToken <= 0) {
          const kind: IndexOptionKind =
            ev.instrumentId === NIFTY_50_INSTRUMENT.id ? 'nifty' : 'banknifty';
          let resolved = resolveAtmWeeklyOption({
            instruments: allInstruments,
            kind,
            direction: ev.open.direction,
            spot: ev.open.indexEntry,
            asOfDateTime: ev.open.entryTime,
          });
          if (resolved.source === 'synthetic') {
            try {
              await this.instrumentStore.refresh(true);
              allInstruments = this.instrumentStore.allInstruments();
            } catch {
              // SKIP path inside placeEntry
            }
            resolved = resolveAtmWeeklyOption({
              instruments: allInstruments,
              kind,
              direction: ev.open.direction,
              spot: ev.open.indexEntry,
              asOfDateTime: ev.open.entryTime,
            });
          }
          option = toOptionContract(resolved.instrument, resolved.source);
        }
        await this.liveOrders.syncInstrument({
          authorization,
          instrumentId: ev.instrumentId,
          instrumentName: ev.instrumentName,
          lots: this.lotsForInstrument(ev.instrumentId),
          open: {
            direction: ev.open.direction,
            entryTime: ev.open.entryTime,
            indexEntry: ev.open.indexEntry,
            indexStop: ev.open.indexStop,
            option,
            optionEntryPremium: ev.open.optionEntryPremium,
          },
        });
      } else {
        await this.liveOrders.syncInstrument({
          authorization,
          instrumentId: ev.instrumentId,
          instrumentName: ev.instrumentName,
          lots: this.lotsForInstrument(ev.instrumentId),
          open: null,
          closeReason: ev.exitReason,
        });
      }
      await delay(300);
    }
  }

  /**
   * Event-log desk closed legs that never got a Kite ENTRY fill.
   * Dedup by instrument+entryTime+symbol (not trade.id — replay mints a new id each tick).
   * Do not SKIP when order book already has COMPLETE ENTRY for that symbol
   * (onKite needs ENTRY+EXIT pair for Profit ₹; entry-only is not a miss).
   */
  private logDeskOnlyLegsNotOnKite(trades: PaperTrade[]): void {
    if (!this.realOrders) {
      return;
    }
    const orderSummary = this.liveOrders.getOrderSummary();
    for (const t of trades) {
      if (t.onKite) {
        continue;
      }
      const symbol = t.option?.tradingSymbol ?? '';
      // Stable across full-day replays; trade.id is pt-${seq}-${exit} and changes every poll.
      const key = `desk-only:${t.instrumentId}|${t.entryTime}|${t.direction}|${symbol}`;
      if (this.loggedDeskOnlyTradeIds.has(key)) {
        continue;
      }
      if (deskLegHasKiteEntry(t, orderSummary)) {
        // Entry reached Kite; exit fill not paired yet (or still open). Not a miss.
        this.loggedDeskOnlyTradeIds.add(key);
        continue;
      }
      this.loggedDeskOnlyTradeIds.add(key);
      this.liveOrders.pushDeskSkipEvent({
        instrumentId: t.instrumentId,
        instrumentName: t.instrumentName,
        detail:
          `Desk signal ${t.direction} ${symbol || 'ATM'} ` +
          `${t.entryTime.slice(11, 16)}→${t.exitTime.slice(11, 16)} never reached Kite ` +
          `(blocked, late Start after bar, or miss). Not counted in Profit ₹.`,
        tradingSymbol: t.option?.tradingSymbol,
      });
    }
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
  }): Promise<Instrument[]> {
    const patchStatus = options?.patchStatus !== false;
    const requireMinimum = options?.requireMinimum !== false;
    const needIndex = this.deskRunOptions.enableNifty || this.deskRunOptions.enableBank;

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

    if (patchStatus) {
      this.patchMessage(
        `Instruments ready · ${countIndexOptions(allInstruments)} index options`,
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

/** Prefer option/Kite ₹ sign for W/L when available. */
function tradeMoneyOutcome(t: {
  netOptionPnlRs?: number | null;
  optionPnlRs?: number | null;
  moneyOutcome?: 'WIN' | 'LOSS' | 'FLAT';
  outcome: 'WIN' | 'LOSS' | 'FLAT';
  premiumEstimated?: boolean;
}): 'WIN' | 'LOSS' | 'FLAT' {
  if (t.moneyOutcome) {
    return t.moneyOutcome;
  }
  const money = t.netOptionPnlRs ?? t.optionPnlRs;
  if (money != null) {
    return money > 0 ? 'WIN' : money < 0 ? 'LOSS' : 'FLAT';
  }
  // Estimated fut-proxy legs have no money — don't count Index SL as a loss.
  if (t.premiumEstimated) {
    return 'FLAT';
  }
  return t.outcome;
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
  // Prefer per-instrument ₹/pt (Nifty 65 / Bank 30) × per-book lots.
  const pointsMoneyRs = trades.reduce((a, t) => {
    const rpp = rupeesPerPointForInstrument(t.instrumentId) || rupeesPerPoint;
    return a + t.indexPoints * rpp * lotsFor(t.instrumentId);
  }, 0);
  const pointsFallback =
    trades.length === 0 ? 0 : pointsMoneyRs || indexNetPts * rupeesPerPoint * displayLots;
  return {
    trades: trades.length,
    wins: trades.filter((t) => tradeMoneyOutcome(t) === 'WIN').length,
    losses: trades.filter((t) => tradeMoneyOutcome(t) === 'LOSS').length,
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

/** IST HH:mm — always zero-padded with colon (never locale `15.15`). */
function istNowHhMm(): string {
  return nowIstStamp().slice(11, 16);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


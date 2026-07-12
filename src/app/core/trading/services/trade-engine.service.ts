import { Injectable, inject } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { HistoricalTrade, TradeDirection } from '../../models/historical-test.model';
import {
  StrategySignal,
  ExitResult,
  TradeExecutionSnapshot,
  isLongSignal,
  isShortSignal,
  isTradeableSignal,
} from '../../strategy-engine/models/module-result.model';
import { OpenTrade } from '../../strategy-engine/models/open-trade.model';
import { TradeCoordinatorService } from '../../strategy-engine/services/trade-coordinator.service';
import { IStrategyPlugin } from '../../strategies/interfaces/strategy-plugin.interface';
import { ExitPolicy } from '../models/exit-policy.model';
import { exitPolicyConfig } from '../models/exit-policy.model';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { extractHhMm, resolveSessionFromContext } from '../../strategy-engine/utils/market-session.util';
import { extractTradeDate } from '../../utils/trade-date.util';
import { MarketRegime } from '../../strategy-engine/utils/market-regime.util';
import { buildSignalDebug } from '../../strategy-engine/utils/signal-debug.util';
import { NSE_SESSION, InstrumentSessionConfig } from '../../config/session.config';
import { STRATEGY_IDS } from '../../config/strategy-ids.config';

export interface ProcessSignalRequest {
  plugin: IStrategyPlugin;
  signal: StrategySignal;
  candle: Candle;
  testId: string;
  ctx: StrategyContext;
}

export interface ProcessCandleSignalsRequest {
  plugins: IStrategyPlugin[];
  signals: StrategySignal[];
  candle: Candle;
  testId: string;
  ctx: StrategyContext;
}

/** NSE default last-entry cutoff — use session.lastEntryTime when context is available. */
export const GLOBAL_LAST_ENTRY_TIME = NSE_SESSION.lastEntryTime;

interface GlobalTradeState {
  activeStrategyId: string | null;
  lastClosedDirection: TradeDirection | null;
  lastClosedStrategyId: string | null;
  lastClosedTradingDate: string | null;
  currentTradingDate: string | null;
}

/**
 * Trade Engine — single authority for trade execution.
 * Strategies emit signals only; this engine decides whether trades can open.
 */
@Injectable({ providedIn: 'root' })
export class TradeEngineService {
  private readonly coordinator = inject(TradeCoordinatorService);
  private readonly globalState: GlobalTradeState = {
    activeStrategyId: null,
    lastClosedDirection: null,
    lastClosedStrategyId: null,
    lastClosedTradingDate: null,
    currentTradingDate: null,
  };

  reset(strategyIds: string[]): void {
    this.coordinator.reset(strategyIds);
    this.globalState.activeStrategyId = null;
    this.globalState.lastClosedDirection = null;
    this.globalState.lastClosedStrategyId = null;
    this.globalState.lastClosedTradingDate = null;
    this.globalState.currentTradingDate = null;
  }

  getOpenTrade(strategyId: string): OpenTrade | null {
    return this.coordinator.getOpenTrade(strategyId);
  }

  getGlobalActiveStrategyId(): string | null {
    return this.globalState.activeStrategyId;
  }

  /** Process all strategy signals for one candle with global execution rules. */
  processCandleSignals(request: ProcessCandleSignalsRequest): TradeExecutionSnapshot[] {
    const { plugins, signals, candle, testId, ctx } = request;
    const tradingDate = extractTradeDate(candle.date);
    if (this.globalState.currentTradingDate !== tradingDate) {
      this.globalState.currentTradingDate = tradingDate;
      this.globalState.lastClosedDirection = null;
      this.globalState.lastClosedStrategyId = null;
      this.globalState.lastClosedTradingDate = null;
    }

    const snapshots: TradeExecutionSnapshot[] = [];

    for (let i = 0; i < plugins.length; i += 1) {
      const plugin = plugins[i]!;
      let signal = signals[i]!;

      const openTrade = this.coordinator.getOpenTrade(plugin.id);
      const anotherStrategyActive =
        this.globalState.activeStrategyId !== null &&
        this.globalState.activeStrategyId !== plugin.id;

      if (anotherStrategyActive && !openTrade) {
        signal = this.blockSignal(signal, 'Another strategy has an active trade', 'SKIPPED');
      } else if (!openTrade && this.isEntryIntent(signal)) {
        const gate = this.evaluateGlobalEntryGate(signal, candle, ctx, plugin.id);
        if (!gate.allowed) {
          signal = this.blockSignal(signal, gate.reason, 'WAITING');
        }
      }

      const snapshot = this.processSignal({ plugin, signal, candle, testId, ctx });
      snapshots.push(snapshot);

      if (snapshot.tradeJustOpened) {
        this.globalState.activeStrategyId = plugin.id;
      }
      if (snapshot.tradeJustClosed && snapshot.closedTrade) {
        this.globalState.activeStrategyId = null;
        this.globalState.lastClosedDirection = snapshot.closedTrade.direction;
        this.globalState.lastClosedStrategyId = plugin.id;
        this.globalState.lastClosedTradingDate = extractTradeDate(candle.date);
      }
    }

    return snapshots;
  }

  processSignal(request: ProcessSignalRequest): TradeExecutionSnapshot {
    const { plugin, signal, candle, testId, ctx } = request;
    const openTrade = this.coordinator.getOpenTrade(plugin.id);
    const earlyExit =
      openTrade && plugin.checkEarlyExit ? plugin.checkEarlyExit(ctx, openTrade) : null;

    const exitMode = this.toExitMode(plugin.exitPolicy);
    const marketRegime = ctx.marketRegime;
    const session = resolveSessionFromContext(ctx);
    const snapshot = this.coordinator.processSignal({
      signal,
      candle,
      testId,
      earlyExit,
      exitMode,
      marketRegime,
      session,
    });

    if (snapshot.tradeJustOpened && openTrade === null) {
      const opened = this.coordinator.getOpenTrade(plugin.id);
      if (opened && plugin.onTradeOpened) {
        plugin.onTradeOpened(opened, ctx);
      }
    }

    if (snapshot.tradeJustClosed && snapshot.closedTrade && plugin.onTradeClosed) {
      plugin.onTradeClosed(snapshot.closedTrade, ctx);
    }

    return snapshot;
  }

  forceCloseOpenTrades(params: {
    plugins: IStrategyPlugin[];
    candle: Candle;
    testId: string;
    reason: string;
    session?: InstrumentSessionConfig;
  }): void {
    const session = params.session ?? NSE_SESSION;
    for (const plugin of params.plugins) {
      const config = exitPolicyConfig(plugin.exitPolicy);
      if (!config.forceCloseAtEnd) {
        continue;
      }
      const snapshot = this.coordinator.forceCloseOpenTrade({
        strategyId: plugin.id,
        strategyName: plugin.name,
        candle: params.candle,
        testId: params.testId,
        reason: params.reason,
        exitMode: this.toExitMode(plugin.exitPolicy),
        session,
      });
      if (snapshot?.tradeJustClosed) {
        this.globalState.activeStrategyId = null;
        if (snapshot.closedTrade) {
          this.globalState.lastClosedDirection = snapshot.closedTrade.direction;
          this.globalState.lastClosedStrategyId = plugin.id;
          this.globalState.lastClosedTradingDate = extractTradeDate(params.candle.date);
        }
      }
    }
  }

  getStatistics(strategyId: string, strategyName: string) {
    return this.coordinator.getStatistics(strategyId, strategyName);
  }

  getAllTrades(): HistoricalTrade[] {
    return this.coordinator.getAllTrades();
  }

  private evaluateGlobalEntryGate(
    signal: StrategySignal,
    candle: Candle,
    ctx: StrategyContext,
    strategyId: string,
  ): { allowed: boolean; reason: string } {
    const session = resolveSessionFromContext(ctx);
    const time = extractHhMm(candle.date, session.timezone);
    // Hunt DNA whole-day window ends 15:10; other strategies keep session lastEntryTime.
    const lastEntry =
      strategyId === STRATEGY_IDS.PDHL_OPENING_RANGE ? '15:10' : session.lastEntryTime;
    if (time > lastEntry) {
      return { allowed: false, reason: `No new entries after ${lastEntry}` };
    }

    if (this.globalState.activeStrategyId !== null) {
      return { allowed: false, reason: 'Maximum one open trade at a time' };
    }

    // OR Swing Breakout: multi-entry until day lock +30 / stop −45.

    if (!signal.allConditionsMet || !isTradeableSignal(signal.signalType)) {
      return { allowed: false, reason: 'Signal conditions not fully met' };
    }

    return { allowed: true, reason: '' };
  }

  private isEntryIntent(signal: StrategySignal): boolean {
    return isTradeableSignal(signal.signalType) && signal.allConditionsMet;
  }

  private blockSignal(
    signal: StrategySignal,
    reason: string,
    blockedType: 'WAITING' | 'SKIPPED',
  ): StrategySignal {
    const debug = buildSignalDebug({
      marketRegime: String(signal.analysis['marketRegime'] ?? 'UNKNOWN'),
      strategyStatus: blockedType,
      currentStep: 'Trade Engine',
      blockingRule: reason,
      expectedValue: 'Trade allowed',
      actualValue: 'Blocked',
      nextConditionRequired:
        blockedType === 'SKIPPED' ? 'Wait for active trade to close' : reason,
    });

    return {
      ...signal,
      signalType: blockedType,
      allConditionsMet: false,
      reasons: [...signal.reasons, reason],
      analysis: {
        ...signal.analysis,
        finalDecision: blockedType,
        tradeEngineBlock: reason,
        debug,
      },
    };
  }

  private toExitMode(policy: ExitPolicy): 'default' | 'strategy3_research' {
    return policy === 'stop_loss_session_close' ? 'strategy3_research' : 'default';
  }
}

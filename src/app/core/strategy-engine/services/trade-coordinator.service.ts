import { Injectable, inject } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { HistoricalTrade, TradeDirection } from '../../models/historical-test.model';
import {
  StrategySignal,
  TradeExecutionSnapshot,
  TradeStatusLabel,
  ExitResult,
  emptyModule,
  isLongSignal,
  isShortSignal,
  isTradeableSignal,
} from '../models/module-result.model';
import { TradingStrategy } from '../interfaces/trading-strategy.interface';
import { OpenTrade } from '../models/open-trade.model';
import { StatisticsTracker } from './statistics-tracker';
import { TradeManagerService } from './trade-manager.service';
import { StrategyEventLogService } from './strategy-event-log.service';
import { MarketRegime } from '../utils/market-regime.util';
import { InstrumentSessionConfig, NSE_SESSION, isSessionCloseExitReason } from '../../config/session.config';
import { STRATEGY_IDS } from '../../config/strategy-ids.config';
import {
  clampStopLoss,
  PDHL_MAX_STOP_LOSS_PTS,
} from '../strategies/pdhl-opening-range/pdhl-opening-range.evaluator';

interface StrategyTradeState {
  openTrade: OpenTrade | null;
  tradeStatus: TradeStatusLabel;
  currentProfitLoss: number;
  exitReason: string;
  tracker: StatisticsTracker;
}

@Injectable({ providedIn: 'root' })
export class TradeCoordinatorService {
  private readonly tradeManager = inject(TradeManagerService);
  private readonly eventLog = inject(StrategyEventLogService);

  private readonly states = new Map<string, StrategyTradeState>();

  reset(strategyIds: string[]): void {
    this.states.clear();
    for (const id of strategyIds) {
      this.states.set(id, {
        openTrade: null,
        tradeStatus: 'Waiting',
        currentProfitLoss: 0,
        exitReason: '',
        tracker: new StatisticsTracker(),
      });
    }
  }

  getOpenTrade(strategyId: string): OpenTrade | null {
    return this.states.get(strategyId)?.openTrade ?? null;
  }

  processSignal(params: {
    signal: StrategySignal;
    candle: Candle;
    testId: string;
    earlyExit?: ExitResult | null;
    exitMode?: 'default' | 'strategy3_research';
    marketRegime?: MarketRegime;
    session?: InstrumentSessionConfig;
  }): TradeExecutionSnapshot {
    const state = this.states.get(params.signal.strategyId);
    if (!state) {
      throw new Error(`No trade state for strategy ${params.signal.strategyId}`);
    }

    const {
      signal,
      candle,
      testId,
      earlyExit,
      exitMode = 'default',
      marketRegime,
      session = NSE_SESSION,
    } = params;
    this.recordModuleStats(state, signal);

    if (state.openTrade) {
      return this.manageOpenTrade(state, signal, candle, testId, earlyExit ?? null, exitMode, session);
    }

    if (isTradeableSignal(signal.signalType) && signal.allConditionsMet) {
      const direction: TradeDirection = isShortSignal(signal.signalType) ? 'SELL' : 'BUY';
      const stopLoss = clampStopForStrategy(
        signal.strategyId,
        signal.entryPrice,
        direction,
        signal.stopLoss,
      );
      state.openTrade = this.tradeManager.createOpenTrade({
        entryTime: candle.date,
        entryPrice: signal.entryPrice,
        stopLoss,
        targetPrice: signal.targetPrice,
        entryReason: `${signal.signalType}: ${signal.reasons.join('; ')}`,
        confidence: signal.confidence,
        riskRewardRatio: signal.riskRewardRatio,
        direction,
        marketRegime,
      });
      state.tradeStatus = 'Open';
      state.currentProfitLoss = 0;
      state.exitReason = '';
      signal.timelinePhase = 'Trade';
      signal.stopLoss = stopLoss;
      this.eventLog.log({
        timestamp: candle.date,
        strategyName: signal.strategyName,
        eventType: 'TRADE_OPENED',
        message: `${direction} @ ${signal.entryPrice.toFixed(2)} | SL ${signal.stopLoss.toFixed(2)} | Target ${signal.targetPrice.toFixed(2)}`,
      });

      return this.toSnapshot(state, signal, { tradeJustOpened: true });
    } else {
      state.tradeStatus = 'Waiting';
      state.currentProfitLoss = 0;
      this.eventLog.log({
        timestamp: candle.date,
        strategyName: signal.strategyName,
        eventType: 'WAIT_SIGNAL',
        message: `${signal.signalType} — ${String(signal.analysis['finalDecision'] ?? 'No trade')}`,
      });
    }

    return this.toSnapshot(state, signal);
  }

  forceCloseOpenTrade(params: {
    strategyId: string;
    strategyName: string;
    candle: Candle;
    testId: string;
    reason: string;
    exitMode?: 'default' | 'strategy3_research';
    session?: InstrumentSessionConfig;
  }): TradeExecutionSnapshot | null {
    const state = this.states.get(params.strategyId);
    if (!state?.openTrade) {
      return null;
    }

    const session = params.session ?? NSE_SESSION;
    const exit: ExitResult =
      params.exitMode === 'strategy3_research'
        ? this.tradeManager.checkStrategy3ResearchExit(params.candle, state.openTrade, session)
        : {
            shouldExit: true,
            exitPrice: params.candle.close,
            exitReason: params.reason,
            outcome:
              this.tradeManager.runningPnl(params.candle, state.openTrade) > 0 ? 'WIN' : 'LOSS',
          };

    const fallbackExit: ExitResult = {
      shouldExit: true,
      exitPrice: params.candle.close,
      exitReason: params.reason,
      outcome:
        this.tradeManager.runningPnl(params.candle, state.openTrade) > 0 ? 'WIN' : 'LOSS',
    };

    const finalExit: ExitResult = exit.shouldExit ? exit : fallbackExit;

    const closed = this.tradeManager.closeTrade({
      trade: state.openTrade,
      exit: finalExit,
      exitTime: params.candle.date,
      testId: params.testId,
      strategyId: params.strategyId,
      strategyName: params.strategyName,
    });

    state.tracker.recordTrade(closed);
    state.openTrade = null;
    state.tradeStatus = 'Closed';
    state.exitReason = finalExit.exitReason;
    state.currentProfitLoss = closed.points;

    return {
      strategyId: params.strategyId,
      strategyName: params.strategyName,
      signal: {
        strategyId: params.strategyId,
        strategyName: params.strategyName,
        signalType: 'NO_TRADE',
        confidence: 0,
        entryPrice: params.candle.close,
        stopLoss: params.candle.close,
        targetPrice: params.candle.close,
        riskRewardRatio: 0,
        trend: emptyModule('Force close'),
        structure: emptyModule('Force close'),
        pullback: emptyModule('Force close'),
        entry: {
          passed: false,
          action: 'NO_TRADE',
          entryPrice: params.candle.close,
          confidence: 0,
          reason: params.reason,
          checks: [],
        },
        volume: emptyModule('Force close'),
        momentum: emptyModule('Force close'),
        allConditionsMet: false,
        timelinePhase: 'Exit',
        reasons: [params.reason],
        analysis: {},
      },
      tradeStatus: 'Closed',
      currentProfitLoss: closed.points,
      exitReason: finalExit.exitReason,
      tradeOpen: false,
      tradeJustOpened: false,
      tradeJustClosed: true,
      closedTrade: closed,
    };
  }

  getTrades(strategyId: string): HistoricalTrade[] {
    return this.states.get(strategyId)?.tracker.getTrades() ?? [];
  }

  getStatistics(strategyId: string, strategyName: string) {
    return this.states.get(strategyId)?.tracker.buildResult(strategyId, strategyName);
  }

  getAllTrades(): HistoricalTrade[] {
    return [...this.states.values()].flatMap((s) => s.tracker.getTrades());
  }

  private manageOpenTrade(
    state: StrategyTradeState,
    signal: StrategySignal,
    candle: Candle,
    testId: string,
    earlyExit: ExitResult | null,
    exitMode: 'default' | 'strategy3_research',
    session: InstrumentSessionConfig,
  ): TradeExecutionSnapshot {
    const trade = state.openTrade!;
    state.currentProfitLoss = this.tradeManager.runningPnl(candle, trade);
    signal.timelinePhase = 'Trade';

    // SL / ATR target / session before EMA early exit.
    const structuralExit =
      exitMode === 'strategy3_research'
        ? this.tradeManager.checkStrategy3ResearchExit(candle, trade, session)
        : this.tradeManager.checkExit(candle, trade);

    const exit =
      structuralExit.shouldExit
        ? structuralExit
        : earlyExit?.shouldExit === true
          ? earlyExit
          : structuralExit;
    if (exit.shouldExit) {
      const closed = this.tradeManager.closeTrade({
        trade,
        exit,
        exitTime: candle.date,
        testId,
        strategyId: signal.strategyId,
        strategyName: signal.strategyName,
      });

      state.tracker.recordTrade(closed);
      state.openTrade = null;
      state.tradeStatus = 'Closed';
      state.exitReason = exit.exitReason;
      state.currentProfitLoss = closed.points;
      signal.timelinePhase = 'Exit';

      const eventType =
        exit.exitReason === 'Stop loss hit'
          ? 'STOP_LOSS_HIT'
          : isSessionCloseExitReason(exit.exitReason)
            ? 'TRADE_CLOSED'
            : exit.outcome === 'WIN'
              ? 'TARGET_HIT'
              : 'STOP_LOSS_HIT';

      this.eventLog.log({
        timestamp: candle.date,
        strategyName: signal.strategyName,
        eventType,
        message: `${exit.exitReason} @ ${exit.exitPrice.toFixed(2)} | ${closed.outcome} | ${closed.points > 0 ? '+' : ''}${closed.points.toFixed(2)} pts`,
      });
      this.eventLog.log({
        timestamp: candle.date,
        strategyName: signal.strategyName,
        eventType: 'TRADE_CLOSED',
        message: `Closed after ${closed.holdingMinutes} min`,
      });

      return this.toSnapshot(state, signal, { tradeJustClosed: true, closedTrade: closed });
    }

    return this.toSnapshot(state, signal);
  }

  private recordModuleStats(state: StrategyTradeState, signal: StrategySignal): void {
    state.tracker.recordModuleResult('Trend', signal.trend.passed, signal.trend.checks);
    state.tracker.recordModuleResult('Structure', signal.structure.passed, signal.structure.checks);
    state.tracker.recordModuleResult('Entry', signal.entry.passed, signal.entry.checks);
    if (signal.signalType !== 'NO_TRADE' && signal.signalType !== 'WAIT' && signal.signalType !== 'WAITING' && signal.signalType !== 'SKIPPED') {
      state.tracker.recordModuleResult('Signal', signal.allConditionsMet, [
        { name: signal.signalType, passed: signal.allConditionsMet },
      ]);
    }
  }

  private toSnapshot(
    state: StrategyTradeState,
    signal: StrategySignal,
    flags?: {
      tradeJustOpened?: boolean;
      tradeJustClosed?: boolean;
      closedTrade?: HistoricalTrade;
    },
  ): TradeExecutionSnapshot {
    return {
      strategyId: signal.strategyId,
      strategyName: signal.strategyName,
      signal,
      tradeStatus: state.tradeStatus,
      currentProfitLoss: state.currentProfitLoss,
      exitReason: state.exitReason,
      tradeOpen: state.openTrade !== null,
      tradeJustOpened: flags?.tradeJustOpened ?? false,
      tradeJustClosed: flags?.tradeJustClosed ?? false,
      closedTrade: flags?.closedTrade,
    };
  }
}

function clampStopForStrategy(
  strategyId: string,
  entry: number,
  direction: TradeDirection,
  proposedStop: number,
): number {
  if (strategyId !== STRATEGY_IDS.PDHL_OPENING_RANGE) {
    return proposedStop;
  }
  return clampStopLoss(entry, direction, proposedStop, PDHL_MAX_STOP_LOSS_PTS);
}

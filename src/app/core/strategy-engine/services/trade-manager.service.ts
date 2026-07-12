import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';
import { HistoricalTrade, TradeDirection } from '../../models/historical-test.model';
import { createId } from '../../utils/id.util';
import { ExitResult } from '../models/module-result.model';
import { OpenTrade } from '../models/open-trade.model';
import { isSessionCloseCandle } from '../utils/market-session.util';
import {
  InstrumentSessionConfig,
  NSE_SESSION,
  isSessionCloseExitReason,
} from '../../config/session.config';

@Injectable({ providedIn: 'root' })
export class TradeManagerService {
  /** Session-close policy: SL → ATR target → session close (EMA handled separately). */
  checkStrategy3ResearchExit(
    candle: Candle,
    trade: OpenTrade,
    session: InstrumentSessionConfig = NSE_SESSION,
  ): ExitResult {
    const stopLossExit = this.checkStopLossOnly(candle, trade);
    if (stopLossExit.shouldExit) {
      return stopLossExit;
    }

    const targetExit = this.checkTargetOnly(candle, trade);
    if (targetExit.shouldExit) {
      return targetExit;
    }

    if (isSessionCloseCandle(candle.date, session)) {
      const exitPrice = candle.close;
      const points =
        trade.direction === 'BUY'
          ? exitPrice - trade.entryPrice
          : trade.entryPrice - exitPrice;

      return {
        shouldExit: true,
        exitPrice,
        exitReason: session.sessionCloseLabel,
        outcome: points > 0 ? 'WIN' : 'LOSS',
      };
    }

    return {
      shouldExit: false,
      exitPrice: candle.close,
      exitReason: '',
      outcome: 'LOSS',
    };
  }

  checkExit(candle: Candle, trade: OpenTrade): ExitResult {
    if (trade.direction === 'BUY') {
      if (candle.low <= trade.stopLoss) {
        return {
          shouldExit: true,
          exitPrice: trade.stopLoss,
          exitReason: 'Stop loss hit',
          outcome: 'LOSS',
        };
      }
      if (candle.high >= trade.targetPrice) {
        return {
          shouldExit: true,
          exitPrice: trade.targetPrice,
          exitReason: 'Target hit',
          outcome: 'WIN',
        };
      }
    } else {
      if (candle.high >= trade.stopLoss) {
        return {
          shouldExit: true,
          exitPrice: trade.stopLoss,
          exitReason: 'Stop loss hit',
          outcome: 'LOSS',
        };
      }
      if (candle.low <= trade.targetPrice) {
        return {
          shouldExit: true,
          exitPrice: trade.targetPrice,
          exitReason: 'Target hit',
          outcome: 'WIN',
        };
      }
    }

    return {
      shouldExit: false,
      exitPrice: candle.close,
      exitReason: '',
      outcome: 'LOSS',
    };
  }

  private checkStopLossOnly(candle: Candle, trade: OpenTrade): ExitResult {
    if (trade.direction === 'BUY') {
      if (candle.low <= trade.stopLoss) {
        return {
          shouldExit: true,
          exitPrice: trade.stopLoss,
          exitReason: 'Stop loss hit',
          outcome: 'LOSS',
        };
      }
    } else if (candle.high >= trade.stopLoss) {
      return {
        shouldExit: true,
        exitPrice: trade.stopLoss,
        exitReason: 'Stop loss hit',
        outcome: 'LOSS',
      };
    }

    return {
      shouldExit: false,
      exitPrice: candle.close,
      exitReason: '',
      outcome: 'LOSS',
    };
  }

  private checkTargetOnly(candle: Candle, trade: OpenTrade): ExitResult {
    // No-op when target equals entry (legacy "no target" trades)
    if (Math.abs(trade.targetPrice - trade.entryPrice) < 0.01) {
      return {
        shouldExit: false,
        exitPrice: candle.close,
        exitReason: '',
        outcome: 'LOSS',
      };
    }

    if (trade.direction === 'BUY') {
      if (candle.high >= trade.targetPrice) {
        return {
          shouldExit: true,
          exitPrice: trade.targetPrice,
          exitReason: 'Target hit',
          outcome: 'WIN',
        };
      }
    } else if (candle.low <= trade.targetPrice) {
      return {
        shouldExit: true,
        exitPrice: trade.targetPrice,
        exitReason: 'Target hit',
        outcome: 'WIN',
      };
    }

    return {
      shouldExit: false,
      exitPrice: candle.close,
      exitReason: '',
      outcome: 'LOSS',
    };
  }

  createOpenTrade(params: {
    entryTime: string;
    entryPrice: number;
    stopLoss: number;
    targetPrice: number;
    entryReason: string;
    confidence: number;
    riskRewardRatio: number;
    direction: TradeDirection;
    marketRegime?: import('../utils/market-regime.util').MarketRegime;
  }): OpenTrade {
    return {
      entryTime: params.entryTime,
      entryPrice: params.entryPrice,
      direction: params.direction,
      stopLoss: params.stopLoss,
      targetPrice: params.targetPrice,
      entryReason: params.entryReason,
      confidence: params.confidence,
      riskRewardRatio: params.riskRewardRatio,
      marketRegime: params.marketRegime,
    };
  }

  runningPnl(candle: Candle, trade: OpenTrade): number {
    return trade.direction === 'BUY'
      ? candle.close - trade.entryPrice
      : trade.entryPrice - candle.close;
  }

  closeTrade(params: {
    trade: OpenTrade;
    exit: ExitResult;
    exitTime: string;
    testId: string;
    strategyId: string;
    strategyName: string;
  }): HistoricalTrade {
    const points =
      params.trade.direction === 'BUY'
        ? params.exit.exitPrice - params.trade.entryPrice
        : params.trade.entryPrice - params.exit.exitPrice;
    const holdingMinutes = this.holdingMinutes(params.trade.entryTime, params.exitTime);

    return {
      id: createId('trade'),
      testId: params.testId,
      strategyId: params.strategyId,
      strategyName: params.strategyName,
      entryTime: params.trade.entryTime,
      exitTime: params.exitTime,
      entryPrice: params.trade.entryPrice,
      exitPrice: params.exit.exitPrice,
      stopLoss: params.trade.stopLoss,
      targetPrice: params.trade.targetPrice,
      direction: params.trade.direction,
      points,
      profitLoss: points,
      confidence: params.trade.confidence,
      entryReason: params.trade.entryReason,
      exitReason: params.exit.exitReason,
      holdingMinutes,
      status:
        isSessionCloseExitReason(params.exit.exitReason)
          ? 'closed'
          : params.exit.outcome === 'WIN'
            ? 'target_hit'
            : 'stopped',
      outcome: params.exit.outcome,
      marketRegime: params.trade.marketRegime,
    };
  }

  private holdingMinutes(from: string, to: string): number {
    const diff = new Date(to).getTime() - new Date(from).getTime();
    return Math.max(0, Math.round(diff / 60000));
  }
}

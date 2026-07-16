import { Injectable } from '@angular/core';
import { StrategyContext } from '../../models/strategy-context.model';
import {
  ExitResult,
  StrategySignal,
  emptyModule,
  moduleFromCheck,
} from '../../models/module-result.model';
import { TradingStrategy } from '../../interfaces/trading-strategy.interface';
import { HistoricalTrade } from '../../../models/historical-test.model';
import { OpenTrade } from '../../models/open-trade.model';
import { STRATEGY_IDS } from '../../../config/strategy-ids.config';
import {
  PDHL_EMA_EXIT_PERIOD,
  PDHL_NIFTY_PARAMS,
  PDHL_RUPEES_PER_POINT,
  PdhlOrParams,
  createPdhlOrState,
  emaLast,
  recordPdhlTradeClosed,
  resolvePdhlOrParams,
  runPdhlOpeningRange,
} from './pdhl-opening-range.evaluator';

@Injectable({ providedIn: 'root' })
export class PdhlOpeningRangeStrategy implements TradingStrategy {
  readonly id = STRATEGY_IDS.PDHL_OPENING_RANGE;
  readonly name = 'OR Swing Breakout';
  enabled = true;

  private readonly state = createPdhlOrState();
  private lastParams: PdhlOrParams = PDHL_NIFTY_PARAMS;

  evaluate(ctx: StrategyContext): StrategySignal {
    this.lastParams = resolvePdhlOrParams(ctx.instrumentId);
    const result = runPdhlOpeningRange(ctx, this.state);
    const tradeable = result.action === 'BUY' || result.action === 'SELL';
    const debug = result.analysis['debug'] as Record<string, unknown> | undefined;
    const targetRs = Number(result.analysis['targetRs'] ?? 0);
    const confidence = tradeable ? 88 : 0;
    const lock = Number(result.analysis['dailyProfitLock'] ?? this.lastParams.dailyProfitLockPts);
    const dayStop = Number(result.analysis['dailyMaxLoss'] ?? this.lastParams.dailyMaxLossPts);
    const budgetLabel =
      lock > 0
        ? `Net ${Number(result.analysis['dayNetPts'] ?? 0).toFixed(1)} pts (lock +${lock} / stop -${dayStop})`
        : `Net ${Number(result.analysis['dayNetPts'] ?? 0).toFixed(1)} pts (no day lock / stop -${dayStop})`;

    return {
      strategyId: this.id,
      strategyName: this.name,
      signalType: result.action,
      confidence,
      entryPrice: tradeable ? result.entryPrice : ctx.candle5m.close,
      stopLoss: tradeable ? result.stopLoss : ctx.candle5m.close,
      targetPrice: tradeable ? result.target : ctx.candle5m.close,
      riskRewardRatio: result.riskRewardRatio,
      trend: moduleFromCheck('Day Budget', true, budgetLabel),
      structure: moduleFromCheck(
        'OR + Swing',
        result.analysis['orHigh'] != null,
        result.analysis['swingHigh'] != null
          ? `Swing ${Number(result.analysis['swingLow']).toFixed(1)}–${Number(result.analysis['swingHigh']).toFixed(1)}`
          : result.analysis['orHigh'] != null
            ? `OR ${Number(result.analysis['orLow']).toFixed(1)}–${Number(result.analysis['orHigh']).toFixed(1)}`
            : 'Waiting',
      ),
      pullback: emptyModule('N/A'),
      entry: {
        passed: tradeable,
        action: result.action,
        entryPrice: tradeable ? result.entryPrice : ctx.candle5m.close,
        confidence,
        reason: result.reason,
        checks: [
          {
            name: String(debug?.['currentStep'] ?? result.action),
            passed: tradeable,
            reason: result.reason,
            value: tradeable
              ? `₹${targetRs.toFixed(0)} @ ₹${PDHL_RUPEES_PER_POINT}/pt`
              : String(result.action),
          },
        ],
      },
      volume: emptyModule('OHLC only'),
      momentum: emptyModule('Swing breakout + EMA-20 exit'),
      allConditionsMet: tradeable,
      timelinePhase: tradeable ? 'Entry' : 'Trend',
      reasons: [result.reason],
      analysis: result.analysis,
    };
  }

  checkEarlyExit(ctx: StrategyContext, trade: OpenTrade): ExitResult | null {
    const closes = [...ctx.previous5m, ctx.candle5m].map((c) => c.close);
    const ema20 = emaLast(closes, PDHL_EMA_EXIT_PERIOD);
    if (ema20 == null) {
      return null;
    }
    const close = ctx.candle5m.close;
    const shouldExit =
      (trade.direction === 'BUY' && close < ema20) ||
      (trade.direction === 'SELL' && close > ema20);
    if (!shouldExit) {
      return null;
    }
    const points =
      trade.direction === 'BUY' ? close - trade.entryPrice : trade.entryPrice - close;
    return {
      shouldExit: true,
      exitPrice: close,
      exitReason: 'EMA-20 exit',
      outcome: points >= 0 ? 'WIN' : 'LOSS',
    };
  }

  onTradeClosed(trade: HistoricalTrade): void {
    recordPdhlTradeClosed(this.state, trade.points, this.lastParams);
  }

  reset(): void {
    Object.assign(this.state, createPdhlOrState());
    this.lastParams = PDHL_NIFTY_PARAMS;
  }
}

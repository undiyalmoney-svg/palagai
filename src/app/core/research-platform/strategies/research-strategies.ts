import { Injectable } from '@angular/core';
import { StrategyContext } from '../../strategy-engine/models/strategy-context.model';
import { StrategySignal } from '../../strategy-engine/models/module-result.model';
import {
  RESEARCH_STRATEGY_IDS,
  ResearchStrategy,
} from '../interfaces/research-strategy.interface';
import {
  OneTradePerDayGate,
  extractTradingDate,
  noTradeResult,
  toStrategySignal,
} from '../shared/research-signal.util';
import { buildResearchStrategyDebug } from '../shared/research-strategy-debug.util';
import { runTrendlineBreakoutRetest } from './trendline-breakout-retest/trendline-breakout-retest.evaluator';
import { runMultiTimeframePullback } from './multi-timeframe-pullback/multi-timeframe-pullback.evaluator';
import {
  createHourBreakoutState,
  runHourBreakout,
} from './hour-breakout/hour-breakout.evaluator';

function createResearchStrategy(params: {
  id: string;
  name: string;
  run: (ctx: StrategyContext) => ReturnType<typeof runTrendlineBreakoutRetest>;
}): ResearchStrategy {
  const gate = new OneTradePerDayGate();

  return {
    id: params.id,
    name: params.name,
    version: 1,
    enabled: true,
    reset: () => gate.reset(),
    runStrategy: (ctx) => params.run(ctx),
    evaluate(ctx) {
      const tradingDate = extractTradingDate(ctx.candle5m.date);
      if (!gate.canTrade(tradingDate)) {
      return toStrategySignal({
        strategyId: params.id,
        strategyName: params.name,
        candle: ctx.candle5m,
        result: noTradeResult(ctx.candle5m, 'One trade per day limit reached', {
          tradingDate,
          strategyDebug: buildResearchStrategyDebug(params.id, ctx),
        }),
      });
      }

      const result = params.run(ctx);
      const tradeable = result.action === 'BUY' || result.action === 'SELL';
      if (tradeable) {
        gate.markTraded(tradingDate);
      }

      return toStrategySignal({
        strategyId: params.id,
        strategyName: params.name,
        candle: ctx.candle5m,
        result: {
          ...result,
          analysis: {
            ...result.analysis,
            strategyDebug: buildResearchStrategyDebug(params.id, ctx),
          },
        },
      });
    },
  };
}

@Injectable()
export class TrendlineBreakoutRetestStrategy implements ResearchStrategy {
  private readonly inner = createResearchStrategy({
    id: RESEARCH_STRATEGY_IDS.TRENDLINE_BREAKOUT,
    name: 'Strategy 1 — Trendline Breakout + Retest',
    run: runTrendlineBreakoutRetest,
  });

  readonly id = this.inner.id;
  readonly name = this.inner.name;
  readonly version = this.inner.version;
  enabled = true;

  runStrategy(ctx: StrategyContext) {
    return this.inner.runStrategy(ctx);
  }

  evaluate(ctx: StrategyContext): StrategySignal {
    return this.inner.evaluate(ctx);
  }

  reset(): void {
    this.inner.reset();
  }
}

@Injectable()
export class MultiTimeframePullbackStrategy implements ResearchStrategy {
  private readonly inner = createResearchStrategy({
    id: RESEARCH_STRATEGY_IDS.MTF_PULLBACK,
    name: 'Strategy 2 — Multi Timeframe Pullback',
    run: runMultiTimeframePullback,
  });

  readonly id = this.inner.id;
  readonly name = this.inner.name;
  readonly version = this.inner.version;
  enabled = true;

  runStrategy(ctx: StrategyContext) {
    return this.inner.runStrategy(ctx);
  }

  evaluate(ctx: StrategyContext): StrategySignal {
    return this.inner.evaluate(ctx);
  }

  reset(): void {
    this.inner.reset();
  }
}

@Injectable()
export class HourBreakoutStrategy implements ResearchStrategy {
  readonly id = RESEARCH_STRATEGY_IDS.HOUR_BREAKOUT;
  readonly name = 'Strategy 3 — 1 Hour Breakout';
  readonly version = 1;
  enabled = true;

  private readonly gate = new OneTradePerDayGate();
  private readonly hourState = createHourBreakoutState();

  runStrategy(ctx: StrategyContext) {
    return runHourBreakout(ctx, this.hourState);
  }

  evaluate(ctx: StrategyContext): StrategySignal {
    const tradingDate = extractTradingDate(ctx.candle5m.date);
    if (!this.gate.canTrade(tradingDate)) {
      return toStrategySignal({
        strategyId: this.id,
        strategyName: this.name,
        candle: ctx.candle5m,
        result: noTradeResult(ctx.candle5m, 'One trade per day limit reached', {
          tradingDate,
          strategyDebug: buildResearchStrategyDebug(this.id, ctx, this.hourState),
        }),
      });
    }

    const result = runHourBreakout(ctx, this.hourState);
    const tradeable = result.action === 'BUY' || result.action === 'SELL';
    if (tradeable) {
      this.gate.markTraded(tradingDate);
    }

    return toStrategySignal({
      strategyId: this.id,
      strategyName: this.name,
      candle: ctx.candle5m,
      result: {
        ...result,
        analysis: {
          ...result.analysis,
          strategyDebug: buildResearchStrategyDebug(this.id, ctx, this.hourState),
        },
      },
    });
  }

  reset(): void {
    this.gate.reset();
    Object.assign(this.hourState, createHourBreakoutState());
  }
}

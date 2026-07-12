import { Candle } from '../../models/candle.model';
import { OpenTrade } from '../models/open-trade.model';
import { ExitResult } from '../models/module-result.model';
import { MomentumScoreResult } from './momentum-score.util';

export interface EarlyExitTradeContext {
  direction: OpenTrade['direction'];
  peakDirectionalScore: number;
  previousDirectionalScore: number;
  seenBullishFive: boolean;
  seenBullishFourAfterFive: boolean;
  seenCounterZero: boolean;
  previousCounterScore: number;
  referenceHigherLow: number;
  referenceLowerHigh: number;
}

export interface EarlyExitEvaluation {
  shouldExit: boolean;
  status: string;
  reason: string;
}

export function createEarlyExitContext(params: {
  trade: OpenTrade;
  momentum: MomentumScoreResult;
  candles5: Candle[];
}): EarlyExitTradeContext {
  const previous = params.candles5.length >= 2 ? params.candles5[params.candles5.length - 2]! : null;
  const directional =
    params.trade.direction === 'BUY' ? params.momentum.bullishScore : params.momentum.bearishScore;

  return {
    direction: params.trade.direction,
    peakDirectionalScore: directional,
    previousDirectionalScore: directional,
    seenBullishFive: params.trade.direction === 'BUY' && params.momentum.bullishScore >= 5,
    seenBullishFourAfterFive: false,
    seenCounterZero: params.trade.direction === 'SELL' && params.momentum.bullishScore === 0,
    previousCounterScore: params.momentum.bullishScore,
    referenceHigherLow: previous?.low ?? params.candles5[params.candles5.length - 1]!.low,
    referenceLowerHigh: previous?.high ?? params.candles5[params.candles5.length - 1]!.high,
  };
}

export function evaluateEarlyExit(params: {
  context: EarlyExitTradeContext;
  momentum: MomentumScoreResult;
  candle: Candle;
  candles5: Candle[];
}): EarlyExitEvaluation {
  const { context, momentum, candle, candles5 } = params;
  const previous = candles5.length >= 2 ? candles5[candles5.length - 2]! : null;
  const directional =
    context.direction === 'BUY' ? momentum.bullishScore : momentum.bearishScore;
  const counter = momentum.bullishScore;

  context.peakDirectionalScore = Math.max(context.peakDirectionalScore, directional);

  if (context.direction === 'BUY') {
    const structureBreak = previous !== null && candle.low < context.referenceHigherLow;
    if (structureBreak) {
      return exit('EXIT — structure break', 'BUY early exit — previous Higher Low broken');
    }
    if (isBuyMomentumFade(context, directional)) {
      return exit(
        'EXIT — momentum weakened',
        `BUY early exit — momentum declined ${context.peakDirectionalScore} → ${directional}`,
      );
    }
  } else {
    const structureBreak = previous !== null && candle.high > context.referenceLowerHigh;
    if (structureBreak) {
      return exit('EXIT — structure break', 'SELL early exit — previous Lower High broken');
    }
    if (isSellCounterMomentumBuild(context, counter)) {
      return exit('EXIT — momentum weakened', 'SELL early exit — counter momentum built 0 → 1 → 2');
    }
  }

  context.previousDirectionalScore = directional;
  context.previousCounterScore = counter;
  if (context.direction === 'SELL' && counter === 0) {
    context.seenCounterZero = true;
  }

  return {
    shouldExit: false,
    status: `HOLD — ${context.direction === 'BUY' ? 'bullish' : 'bearish'} ${directional}/5`,
    reason: 'Early exit not triggered',
  };
}

export function toEarlyExitResult(
  evaluation: EarlyExitEvaluation,
  candle: Candle,
  trade: OpenTrade,
): ExitResult {
  const exitPrice = candle.close;
  const points =
    trade.direction === 'BUY' ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;

  return {
    shouldExit: true,
    exitPrice,
    exitReason: evaluation.reason,
    outcome: points >= 0 ? 'WIN' : 'LOSS',
  };
}

function isBuyMomentumFade(context: EarlyExitTradeContext, bullishScore: number): boolean {
  if (bullishScore >= 5) {
    context.seenBullishFive = true;
  }
  if (context.seenBullishFive && bullishScore === 4) {
    context.seenBullishFourAfterFive = true;
  }
  return context.seenBullishFive && context.seenBullishFourAfterFive && bullishScore <= 3;
}

function isSellCounterMomentumBuild(context: EarlyExitTradeContext, bullishScore: number): boolean {
  const trigger =
    context.seenCounterZero &&
    context.previousCounterScore === 1 &&
    bullishScore >= 2;
  context.previousCounterScore = bullishScore;
  if (bullishScore === 0) {
    context.seenCounterZero = true;
  }
  return trigger;
}

function exit(status: string, reason: string): EarlyExitEvaluation {
  return { shouldExit: true, status, reason };
}

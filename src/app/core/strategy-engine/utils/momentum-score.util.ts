import { Candle } from '../../models/candle.model';
import { averageBodySize, bodySize, midpoint } from './ohlc-candle.util';

export interface MomentumScoreResult {
  bullishScore: number;
  bearishScore: number;
  winningScore: number;
  breakdown: Record<string, string>;
}

export function calculateMomentumScore(candles: Candle[]): MomentumScoreResult | null {
  if (candles.length < 2) {
    return null;
  }

  const current = candles[candles.length - 1]!;
  const previous = candles[candles.length - 2]!;
  const prior5 = candles.slice(0, -1);

  let bullishScore = 0;
  let bearishScore = 0;
  const breakdown: Record<string, string> = {};

  if (current.high > previous.high) {
    bullishScore += 1;
    breakdown['cond1'] = 'HH → +1 Bullish';
  }
  if (current.low < previous.low) {
    bearishScore += 1;
    breakdown['cond1b'] = 'LL → +1 Bearish';
  }

  if (current.low > previous.low) {
    bullishScore += 1;
    breakdown['cond2'] = 'HL → +1 Bullish';
  }
  if (current.high < previous.high) {
    bearishScore += 1;
    breakdown['cond2b'] = 'LH → +1 Bearish';
  }

  if (current.close > current.open) {
    bullishScore += 1;
    breakdown['cond3'] = 'Bullish candle → +1 Bullish';
  } else if (current.close < current.open) {
    bearishScore += 1;
    breakdown['cond3'] = 'Bearish candle → +1 Bearish';
  }

  const mid = midpoint(current);
  if (current.close > mid) {
    bullishScore += 1;
    breakdown['cond4'] = 'Close above midpoint → +1 Bullish';
  } else if (current.close < mid) {
    bearishScore += 1;
    breakdown['cond4'] = 'Close below midpoint → +1 Bearish';
  }

  const avgBody = averageBodySize(prior5, 5);
  const curBody = bodySize(current);
  if (curBody > avgBody) {
    if (current.close > current.open) {
      bullishScore += 1;
      breakdown['cond5'] = 'Body > avg, bullish → +1 Bullish';
    } else if (current.close < current.open) {
      bearishScore += 1;
      breakdown['cond5'] = 'Body > avg, bearish → +1 Bearish';
    }
  }

  return {
    bullishScore,
    bearishScore,
    winningScore: Math.max(bullishScore, bearishScore),
    breakdown,
  };
}

export function meetsBuyMomentum(score: MomentumScoreResult): boolean {
  return score.bullishScore >= 4;
}

export function meetsSellMomentum(score: MomentumScoreResult): boolean {
  return score.bearishScore >= 4;
}

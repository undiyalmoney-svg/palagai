import { Candle } from '../../models/candle.model';

export type OhlcTrend = 'BUY' | 'SELL' | 'NEUTRAL';

export function bodySize(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

export function candleRange(candle: Candle): number {
  return candle.high - candle.low;
}

export function bodyStrengthPct(candle: Candle): number {
  const range = candleRange(candle);
  if (range <= 0) {
    return 0;
  }
  return (bodySize(candle) / range) * 100;
}

export function midpoint(candle: Candle): number {
  return (candle.high + candle.low) / 2;
}

export function isStrongBullish(candle: Candle, minPct = 70): boolean {
  return candle.close > candle.open && bodyStrengthPct(candle) >= minPct;
}

export function isStrongBearish(candle: Candle, minPct = 70): boolean {
  return candle.close < candle.open && bodyStrengthPct(candle) >= minPct;
}

export function last3HigherHighHigherLow(candles: Candle[]): boolean {
  if (candles.length < 3) {
    return false;
  }
  const [c1, c2, c3] = candles.slice(-3);
  return c2.high > c1.high && c3.high > c2.high && c2.low > c1.low && c3.low > c2.low;
}

export function last3LowerHighLowerLow(candles: Candle[]): boolean {
  if (candles.length < 3) {
    return false;
  }
  const [c1, c2, c3] = candles.slice(-3);
  return c2.high < c1.high && c3.high < c2.high && c2.low < c1.low && c3.low < c2.low;
}

export function trend60m(candles: Candle[]): {
  trend: OhlcTrend;
  higherHigh: boolean;
  higherLow: boolean;
  lowerHigh: boolean;
  lowerLow: boolean;
  reason: string;
} {
  if (candles.length < 2) {
    return {
      trend: 'NEUTRAL',
      higherHigh: false,
      higherLow: false,
      lowerHigh: false,
      lowerLow: false,
      reason: 'Insufficient 60m candles',
    };
  }

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const hh = current.high > previous.high;
  const hl = current.low > previous.low;
  const lh = current.high < previous.high;
  const ll = current.low < previous.low;

  const bullishDirect = hh && hl && current.close > previous.high;
  const bearishDirect = ll && lh && current.close < previous.low;
  const hhhl = last3HigherHighHigherLow(candles);
  const lhll = last3LowerHighLowerLow(candles);

  if (bullishDirect || hhhl) {
    return {
      trend: 'BUY',
      higherHigh: hh || hhhl,
      higherLow: hl || hhhl,
      lowerHigh: false,
      lowerLow: false,
      reason: bullishDirect
        ? '60m HH+HL with close above prior high'
        : '60m last 3 candles HH/HL structure',
    };
  }

  if (bearishDirect || lhll) {
    return {
      trend: 'SELL',
      higherHigh: false,
      higherLow: false,
      lowerHigh: lh || lhll,
      lowerLow: ll || lhll,
      reason: bearishDirect
        ? '60m LH+LL with close below prior low'
        : '60m last 3 candles LH/LL structure',
    };
  }

  return {
    trend: 'NEUTRAL',
    higherHigh: hh,
    higherLow: hl,
    lowerHigh: lh,
    lowerLow: ll,
    reason: '60m trend neutral',
  };
}

export function trend30m(candles: Candle[]): {
  trend: OhlcTrend;
  reason: string;
} {
  if (candles.length < 2) {
    return { trend: 'NEUTRAL', reason: 'Insufficient 30m candles' };
  }

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  const bullish =
    current.high > previous.high &&
    current.low > previous.low &&
    current.close > previous.high;
  const bearish =
    current.high < previous.high &&
    current.low < previous.low &&
    current.close < previous.low;

  if (bullish) {
    return { trend: 'BUY', reason: '30m bullish confirmation' };
  }
  if (bearish) {
    return { trend: 'SELL', reason: '30m bearish confirmation' };
  }
  return { trend: 'NEUTRAL', reason: '30m neutral' };
}

export function entry5mTrendFollowing(candles: Candle[]): {
  entry: OhlcTrend | 'NO_ENTRY';
  reason: string;
} {
  if (candles.length < 2) {
    return { entry: 'NO_ENTRY', reason: 'Insufficient 5m candles' };
  }

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const curBody = bodySize(current);
  const prevBody = bodySize(previous);

  const buy =
    current.close > previous.high &&
    curBody > prevBody &&
    current.low > previous.low;
  const sell =
    current.close < previous.low &&
    curBody > prevBody &&
    current.high < previous.high;

  if (buy) {
    return { entry: 'BUY', reason: '5m bullish entry confirmation' };
  }
  if (sell) {
    return { entry: 'SELL', reason: '5m bearish entry confirmation' };
  }
  return { entry: 'NO_ENTRY', reason: '5m no entry' };
}

export function highestHigh(candles: Candle[], lookback: number): number {
  const window = candles.slice(-lookback);
  return window.length ? Math.max(...window.map((c) => c.high)) : 0;
}

export function lowestLow(candles: Candle[], lookback: number): number {
  const window = candles.slice(-lookback);
  return window.length ? Math.min(...window.map((c) => c.low)) : 0;
}

export function averageBodySize(candles: Candle[], lookback = 5): number {
  const window = candles.slice(-lookback);
  if (!window.length) {
    return 0;
  }
  return window.reduce((sum, c) => sum + bodySize(c), 0) / window.length;
}

export function calcLongLevels(entry: number, stopLoss: number, rr = 2): {
  stopLoss: number;
  targetPrice: number;
  riskRewardRatio: number;
} {
  const risk = entry - stopLoss;
  const targetPrice = entry + risk * rr;
  return {
    stopLoss,
    targetPrice,
    riskRewardRatio: risk > 0 ? rr : 0,
  };
}

export function calcShortLevels(entry: number, stopLoss: number, rr = 2): {
  stopLoss: number;
  targetPrice: number;
  riskRewardRatio: number;
} {
  const risk = stopLoss - entry;
  const targetPrice = entry - risk * rr;
  return {
    stopLoss,
    targetPrice,
    riskRewardRatio: risk > 0 ? rr : 0,
  };
}

export function toOhlcSummary(candle: Candle) {
  return {
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    bodySize: bodySize(candle),
  };
}

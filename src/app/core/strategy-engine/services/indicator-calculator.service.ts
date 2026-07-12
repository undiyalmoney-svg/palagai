import { Injectable } from '@angular/core';
import { Candle } from '../../models/candle.model';

@Injectable({ providedIn: 'root' })
export class IndicatorCalculatorService {
  ema(values: number[], period: number): number {
    if (!values.length) {
      return 0;
    }
    const k = 2 / (period + 1);
    return values.reduce((prev, curr, index) => (index === 0 ? curr : curr * k + prev * (1 - k)), 0);
  }

  rsi(values: number[], period = 14): number {
    if (values.length <= period) {
      return 50;
    }
    let gains = 0;
    let losses = 0;
    for (let i = values.length - period; i < values.length; i += 1) {
      const diff = values[i] - values[i - 1];
      if (diff >= 0) {
        gains += diff;
      } else {
        losses += Math.abs(diff);
      }
    }
    if (losses === 0) {
      return 100;
    }
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  atr(candles: Candle[], period = 14): number {
    if (candles.length < 2) {
      return 0;
    }
    const start = Math.max(1, candles.length - period);
    let total = 0;
    let count = 0;
    for (let i = start; i < candles.length; i += 1) {
      const current = candles[i];
      const previous = candles[i - 1];
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      );
      total += tr;
      count += 1;
    }
    return count ? total / count : 0;
  }

  swingHigh(candles: Candle[], lookback = 10): number {
    const window = candles.slice(-lookback);
    return window.length ? Math.max(...window.map((c) => c.high)) : 0;
  }

  swingLow(candles: Candle[], lookback = 10): number {
    const window = candles.slice(-lookback);
    return window.length ? Math.min(...window.map((c) => c.low)) : 0;
  }

  averageVolume(candles: Candle[], lookback = 20): number {
    const window = candles.slice(-lookback);
    if (!window.length) {
      return 0;
    }
    return window.reduce((sum, c) => sum + c.volume, 0) / window.length;
  }

  isBullishEngulfing(current: Candle, previous: Candle): boolean {
    return (
      previous.close < previous.open &&
      current.close > current.open &&
      current.open <= previous.close &&
      current.close >= previous.open
    );
  }

  isHammer(candle: Candle): boolean {
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    return lowerWick >= body * 2 && upperWick <= body * 0.5 && candle.close > candle.open;
  }

  isStrongBullishCandle(candle: Candle): boolean {
    const body = candle.close - candle.open;
    const range = candle.high - candle.low;
    return body > 0 && range > 0 && body / range >= 0.65;
  }

  isMomentumCandle(candle: Candle, candles: Candle[]): boolean {
    const avgBody =
      candles.slice(-10).reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) /
      Math.max(candles.slice(-10).length, 1);
    return candle.close > candle.open && candle.close - candle.open > avgBody * 1.2;
  }

  isBullishRejection(candle: Candle): boolean {
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const range = candle.high - candle.low;
    return range > 0 && lowerWick / range >= 0.55 && candle.close >= candle.open;
  }

  hasHigherHighHigherLow(candles: Candle[], lookback = 5): boolean {
    if (candles.length < lookback + 1) {
      return false;
    }
    const recent = candles.slice(-lookback);
    const prior = candles.slice(-lookback * 2, -lookback);
    if (!prior.length) {
      return false;
    }
    const recentHigh = Math.max(...recent.map((c) => c.high));
    const priorHigh = Math.max(...prior.map((c) => c.high));
    const recentLow = Math.min(...recent.map((c) => c.low));
    const priorLow = Math.min(...prior.map((c) => c.low));
    return recentHigh > priorHigh && recentLow > priorLow;
  }

  isSideways(candles: Candle[], lookback = 20): boolean {
    const window = candles.slice(-lookback);
    if (window.length < lookback) {
      return true;
    }
    const high = Math.max(...window.map((c) => c.high));
    const low = Math.min(...window.map((c) => c.low));
    const mid = (high + low) / 2;
    const rangePct = mid > 0 ? ((high - low) / mid) * 100 : 0;
    return rangePct < 0.35;
  }

  marketBias(candles: Candle[], fastPeriod = 20, slowPeriod = 50): 'bullish' | 'bearish' | 'sideways' {
    if (this.isSideways(candles)) {
      return 'sideways';
    }
    const closes = candles.map((c) => c.close);
    if (closes.length < slowPeriod) {
      return 'sideways';
    }
    const fast = this.ema(closes, fastPeriod);
    const slow = this.ema(closes, slowPeriod);
    if (fast > slow) {
      return 'bullish';
    }
    if (fast < slow) {
      return 'bearish';
    }
    return 'sideways';
  }
}

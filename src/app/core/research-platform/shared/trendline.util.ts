import { Candle } from '../../models/candle.model';
import { SwingPoint } from '../../strategy-engine/utils/swing-level.util';

const MIN_TICK = 0.05;

export interface Trendline {
  type: 'support' | 'resistance';
  pointA: SwingPoint;
  pointB: SwingPoint;
  slope: number;
  intercept: number;
}

export function buildSupportTrendline(swingLows: SwingPoint[]): Trendline | null {
  if (swingLows.length < 2) {
    return null;
  }
  const pointA = swingLows[swingLows.length - 2]!;
  const pointB = swingLows[swingLows.length - 1]!;
  if (pointB.price <= pointA.price) {
    return null;
  }
  return buildTrendline('support', pointA, pointB);
}

export function buildResistanceTrendline(swingHighs: SwingPoint[]): Trendline | null {
  if (swingHighs.length < 2) {
    return null;
  }
  const pointA = swingHighs[swingHighs.length - 2]!;
  const pointB = swingHighs[swingHighs.length - 1]!;
  if (pointB.price >= pointA.price) {
    return null;
  }
  return buildTrendline('resistance', pointA, pointB);
}

export function trendlinePriceAtIndex(line: Trendline, index: number): number {
  return line.slope * index + line.intercept;
}

export function detectTrendlineBreakout(
  candle: Candle,
  candleIndex: number,
  line: Trendline,
): boolean {
  const linePrice = trendlinePriceAtIndex(line, candleIndex);
  if (line.type === 'support') {
    return candle.close > linePrice;
  }
  return candle.close < linePrice;
}

export function detectTrendlineRetest(
  candle: Candle,
  candleIndex: number,
  line: Trendline,
  tolerancePct = 0.002,
): boolean {
  const linePrice = trendlinePriceAtIndex(line, candleIndex);
  const dist = Math.abs(candle.low - linePrice) / linePrice;
  if (line.type === 'support') {
    return dist <= tolerancePct && candle.close >= linePrice;
  }
  const distHigh = Math.abs(candle.high - linePrice) / linePrice;
  return distHigh <= tolerancePct && candle.close <= linePrice;
}

export function entryAboveHigh(candle: Candle): number {
  return candle.high + MIN_TICK;
}

export function entryBelowLow(candle: Candle): number {
  return candle.low - MIN_TICK;
}

function buildTrendline(type: 'support' | 'resistance', pointA: SwingPoint, pointB: SwingPoint): Trendline {
  const slope = (pointB.price - pointA.price) / (pointB.index - pointA.index);
  const intercept = pointA.price - slope * pointA.index;
  return { type, pointA, pointB, slope, intercept };
}

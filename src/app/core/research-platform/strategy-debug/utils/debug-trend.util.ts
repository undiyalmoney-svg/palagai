import { Candle } from '../../../models/candle.model';
import {
  StructureTrend,
  SwingPoint,
  detectStructureTrend,
  detectSwingHighs,
  detectSwingLows,
} from '../../../strategy-engine/utils/swing-level.util';
import { TrendModuleDebug } from '../models/strategy-research-debug.model';

export function analyzeTrendFromCandles(
  candles: Candle[],
  timeframeLabel: string,
  requiredTrend?: 'Bullish' | 'Bearish',
): TrendModuleDebug {
  const swingHighs = detectSwingHighs(candles);
  const swingLows = detectSwingLows(candles);
  const detectedTrend = detectStructureTrend(swingHighs, swingLows);

  const hhCount = countHigherHighs(swingHighs);
  const hlCount = countHigherLows(swingLows);
  const lhCount = countLowerHighs(swingHighs);
  const llCount = countLowerLows(swingLows);

  const requiredCondition = requiredTrend
    ? `${requiredTrend} trend required on ${timeframeLabel}`
    : `Directional trend required on ${timeframeLabel} (not Sideways)`;

  let passed = detectedTrend !== 'Sideways';
  if (requiredTrend) {
    passed = detectedTrend === requiredTrend;
  }

  const actualResult = `Trend=${detectedTrend}, HH=${hhCount}, HL=${hlCount}, LH=${lhCount}, LL=${llCount}`;

  let reason = `${timeframeLabel} trend is ${detectedTrend}`;
  if (!passed && requiredTrend) {
    reason = `${timeframeLabel} requires ${requiredTrend} but detected ${detectedTrend}`;
  } else if (!passed) {
    reason = `${timeframeLabel} trend is Sideways`;
  }

  return {
    passed,
    detectedTrend,
    requiredCondition,
    actualResult,
    reason,
    latestSwingHighs: swingHighs.slice(-5).map((s) => s.price),
    latestSwingLows: swingLows.slice(-5).map((s) => s.price),
    higherHighCount: hhCount,
    higherLowCount: hlCount,
    lowerHighCount: lhCount,
    lowerLowCount: llCount,
    checks: [
      {
        name: `${timeframeLabel} Trend`,
        passed,
        reason,
        expected: requiredTrend ?? 'Bullish or Bearish',
        actual: detectedTrend,
      },
      {
        name: 'Higher High Count',
        passed: hhCount >= 2,
        reason: `Higher High count = ${hhCount}`,
        expected: '>= 2 for bullish structure',
        actual: String(hhCount),
      },
      {
        name: 'Higher Low Count',
        passed: hlCount >= 2,
        reason: `Higher Low count = ${hlCount}`,
        expected: '>= 2 for bullish structure',
        actual: String(hlCount),
      },
    ],
  };
}

function countHigherHighs(swings: SwingPoint[]): number {
  let count = 0;
  for (let i = 1; i < swings.length; i += 1) {
    if (swings[i]!.price > swings[i - 1]!.price) {
      count += 1;
    }
  }
  return count;
}

function countHigherLows(swings: SwingPoint[]): number {
  let count = 0;
  for (let i = 1; i < swings.length; i += 1) {
    if (swings[i]!.price > swings[i - 1]!.price) {
      count += 1;
    }
  }
  return count;
}

function countLowerHighs(swings: SwingPoint[]): number {
  let count = 0;
  for (let i = 1; i < swings.length; i += 1) {
    if (swings[i]!.price < swings[i - 1]!.price) {
      count += 1;
    }
  }
  return count;
}

function countLowerLows(swings: SwingPoint[]): number {
  let count = 0;
  for (let i = 1; i < swings.length; i += 1) {
    if (swings[i]!.price < swings[i - 1]!.price) {
      count += 1;
    }
  }
  return count;
}

export function emptyTrendDebug(reason: string): TrendModuleDebug {
  return {
    passed: false,
    detectedTrend: 'Sideways',
    requiredCondition: 'Insufficient data',
    actualResult: reason,
    reason,
    latestSwingHighs: [],
    latestSwingLows: [],
    higherHighCount: 0,
    higherLowCount: 0,
    lowerHighCount: 0,
    lowerLowCount: 0,
    checks: [{ name: '60 Minute Trend', passed: false, reason }],
  };
}

export function trendLabel(t: StructureTrend): string {
  return t;
}

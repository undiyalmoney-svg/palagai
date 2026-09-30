/**
 * Higher-timeframe trend filter.
 *
 * The HTF series runs through the same structure tracker as the entry
 * timeframe. A HTF bar only becomes visible to an entry bar once it has
 * CLOSED at or before that entry bar's own close — an hourly bar still being
 * built at 10:00 cannot colour a 15-minute signal at 10:00.
 */
import { Candle } from '../../models/candle.model';
import { aggregateCandles } from '../candle-aggregate.util';
import { SmcConfig } from './smc.config';
import { SmcTrend } from './smc.types';
import { StructureTracker } from './smc-structure';
import { candleTs } from './smc-utils';

export interface HtfTimeline {
  /** Trend as of `ts`, or null before the first HTF bar has closed. */
  trendAt(ts: number): SmcTrend | null;
  readonly length: number;
}

export function buildHtfTimeline(
  htfBars: Candle[],
  htfMinutes: number,
  config: SmcConfig,
): HtfTimeline {
  const tracker = new StructureTracker(
    {
      swingLength: config.swingLengthHtf,
      atrPeriod: config.atrPeriod,
      eqTolAtr: config.eqTolAtr,
      eqLookbackSwings: config.eqLookbackSwings,
      breakBufferAtr: config.breakBufferAtr,
      rangeSwings: config.rangeSwings,
      sidewaysRangeAtr: config.sidewaysRangeAtr,
    },
    'h',
  );
  const closeTs: number[] = [];
  const trends: SmcTrend[] = [];
  const span = htfMinutes * 60_000;
  for (const bar of htfBars) {
    tracker.step(bar);
    closeTs.push(candleTs(bar.date) + span);
    trends.push(tracker.trend);
  }
  return {
    length: htfBars.length,
    trendAt(ts: number): SmcTrend | null {
      let lo = 0;
      let hi = closeTs.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (closeTs[mid]! <= ts) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return found >= 0 ? trends[found]! : null;
    },
  };
}

/**
 * Fold the entry-timeframe bars into the higher timeframe when no separate
 * HTF feed exists. Null when the HTF is not a whole multiple of the entry TF.
 */
export function deriveHtfBars(
  ltfBars: Candle[],
  ltfMinutes: number,
  htfMinutes: number,
): Candle[] | null {
  if (ltfMinutes <= 0 || htfMinutes < ltfMinutes) return null;
  const ratio = htfMinutes / ltfMinutes;
  if (!Number.isInteger(ratio)) return null;
  return aggregateCandles(ltfBars, ratio);
}

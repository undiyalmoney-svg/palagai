/**
 * When the charts card may say the trend will continue.
 *
 * The line is for the next 30 to 45 minutes, so it is withheld until that
 * same trend has already stood for 45 minutes on the entry timeframe and,
 * when a higher timeframe is in use, on that timeframe too. A break against
 * the trend inside the window keeps the card on wait.
 */
import { SmcAnalysis, SmcDir, SmcTrend } from './smc/smc.types';

/** Minutes of unbroken trend required before a continuation call. */
export const TREND_HOLD_MINUTES = 45;

export type TrendHoldCall = 'continue' | 'wait' | 'reading';

type HoldInput = Pick<
  SmcAnalysis,
  'snapshot' | 'trendAt' | 'htfTrendAt' | 'structure' | 'htfAvailable'
>;

export function trendHoldCall(
  smc: HoldInput | null | undefined,
  ltfMinutes: number,
  htfMinutes = ltfMinutes,
): TrendHoldCall {
  if (!smc) return 'reading';
  const trend = smc.snapshot.trend;
  if (trend !== 'bullish' && trend !== 'bearish') return 'wait';
  if (smc.snapshot.ltfTrend !== trend) return 'wait';

  const bars = barsForHold(ltfMinutes);
  if (!stableFor(smc.trendAt, trend, bars)) return 'wait';

  const htfSeparate = htfMinutes > ltfMinutes;
  if (htfSeparate) {
    if (!smc.htfAvailable || smc.snapshot.htfTrend !== trend) return 'wait';
    if (!stableFor(smc.htfTrendAt, trend, bars)) return 'wait';
  }

  if (opposingBreakInWindow(smc.structure, trend, smc.trendAt.length, bars)) return 'wait';
  return 'continue';
}

function barsForHold(ltfMinutes: number): number {
  const minutes = Number.isFinite(ltfMinutes) && ltfMinutes > 0 ? ltfMinutes : 1;
  return Math.max(1, Math.ceil(TREND_HOLD_MINUTES / minutes));
}

function stableFor(series: readonly (SmcTrend | null)[], trend: SmcTrend, bars: number): boolean {
  if (series.length < bars) return false;
  const start = series.length - bars;
  for (let i = start; i < series.length; i += 1) {
    if (series[i] !== trend) return false;
  }
  return true;
}

function opposingBreakInWindow(
  events: SmcAnalysis['structure'],
  trend: 'bullish' | 'bearish',
  barCount: number,
  bars: number,
): boolean {
  const from = barCount - bars;
  const against: SmcDir = trend === 'bullish' ? 'bear' : 'bull';
  return events.some((event) => event.index >= from && event.dir === against);
}

/**
 * How many minutes the charts card may say the trend continues.
 *
 * Earlier runs of the same trend on this chart set the usual length. The
 * minutes left are that length minus how long the current run has already
 * lasted, rounded down to 5 minutes. Under 15 minutes left, or a trend that
 * has not yet lasted 15 minutes, stays on wait. The longest call is 2 hours.
 */
import { SmcAnalysis, SmcDir, SmcTrend } from './smc/smc.types';

/** A continuation shorter than this is treated as a possible change. */
export const MIN_CONTINUE_MINUTES = 15;
/** The current run must already have lasted this long before it is called. */
export const MIN_CURRENT_MINUTES = 15;
/** Do not claim a hold longer than this. */
export const MAX_CONTINUE_MINUTES = 120;
const ROUND_MINUTES = 5;
const RECENT_RUNS = 6;

export type TrendContinue =
  | { call: 'reading' }
  | { call: 'wait' }
  | { call: 'continue'; minutes: number };

type HoldInput = Pick<
  SmcAnalysis,
  'snapshot' | 'trendAt' | 'htfTrendAt' | 'structure' | 'htfAvailable'
>;

interface TrendRun {
  trend: SmcTrend;
  bars: number;
  minutes: number;
  endIndex: number;
}

export function trendContinue(
  smc: HoldInput | null | undefined,
  ltfMinutes: number,
  htfMinutes = ltfMinutes,
): TrendContinue {
  if (!smc) return { call: 'reading' };
  const trend = smc.snapshot.trend;
  if (trend !== 'bullish' && trend !== 'bearish') return { call: 'wait' };
  if (smc.snapshot.ltfTrend !== trend) return { call: 'wait' };

  const barMinutes = Number.isFinite(ltfMinutes) && ltfMinutes > 0 ? ltfMinutes : 1;
  const runs = splitRuns(smc.trendAt, barMinutes);
  const current = runs[runs.length - 1];
  if (!current || current.trend !== trend || current.minutes < MIN_CURRENT_MINUTES) {
    return { call: 'wait' };
  }

  const htfSeparate = htfMinutes > barMinutes;
  if (htfSeparate) {
    if (!smc.htfAvailable || smc.snapshot.htfTrend !== trend) return { call: 'wait' };
    if (!agrees(smc.htfTrendAt, trend, current.bars)) return { call: 'wait' };
  }

  const from = smc.trendAt.length - current.bars;
  if (opposingBreakSince(smc.structure, trend, from)) return { call: 'wait' };

  const completed = runs.slice(0, -1).filter((run) => run.trend === 'bullish' || run.trend === 'bearish');
  const same = completed.filter((run) => run.trend === trend);
  const sample = (same.length >= 2 ? same : completed).slice(-RECENT_RUNS);
  if (sample.length < 2) return { call: 'wait' };

  const usual = lowerMedian(sample.map((run) => run.minutes));
  const rounded = Math.floor((usual - current.minutes) / ROUND_MINUTES) * ROUND_MINUTES;
  if (rounded < MIN_CONTINUE_MINUTES) return { call: 'wait' };
  return { call: 'continue', minutes: Math.min(rounded, MAX_CONTINUE_MINUTES) };
}

function splitRuns(trendAt: readonly (SmcTrend | null)[], barMinutes: number): TrendRun[] {
  const runs: TrendRun[] = [];
  trendAt.forEach((value, index) => {
    const trend = value ?? 'sideways';
    const last = runs[runs.length - 1];
    if (last && last.trend === trend) {
      last.bars += 1;
      last.minutes += barMinutes;
      last.endIndex = index;
      return;
    }
    runs.push({ trend, bars: 1, minutes: barMinutes, endIndex: index });
  });
  return runs;
}

function agrees(series: readonly (SmcTrend | null)[], trend: SmcTrend, bars: number): boolean {
  if (series.length < bars) return false;
  for (let i = series.length - bars; i < series.length; i += 1) {
    if (series[i] !== trend) return false;
  }
  return true;
}

function opposingBreakSince(
  events: SmcAnalysis['structure'],
  trend: 'bullish' | 'bearish',
  fromIndex: number,
): boolean {
  const against: SmcDir = trend === 'bullish' ? 'bear' : 'bull';
  return events.some((event) => event.index >= fromIndex && event.dir === against);
}

/** Lower of the two middle values, so an even sample does not overstate the hold. */
function lowerMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

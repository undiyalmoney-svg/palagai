/**
 * How many minutes the charts card may say the trend continues.
 *
 * The count follows the same trend the card prints. A one-minute wiggle does
 * not cancel a downtrend that is already on the card. The minutes are how
 * long that trend has already held, or how much of the usual run is still
 * left when earlier runs of it are on the chart. Under 15 minutes, or a
 * lower timeframe that has turned the other way for 15 minutes, stays on wait.
 */
import { SmcAnalysis, SmcTrend } from './smc/smc.types';

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
  minutes: number;
}

export function trendContinue(
  smc: HoldInput | null | undefined,
  ltfMinutes: number,
  htfMinutes = ltfMinutes,
): TrendContinue {
  if (!smc) return { call: 'reading' };
  const trend = smc.snapshot.trend;
  if (trend !== 'bullish' && trend !== 'bearish') return { call: 'wait' };

  const barMinutes = Number.isFinite(ltfMinutes) && ltfMinutes > 0 ? ltfMinutes : 1;
  const usingHigher = htfMinutes > barMinutes && smc.htfAvailable && smc.snapshot.htfTrend === trend;
  const series = usingHigher ? smc.htfTrendAt : smc.trendAt;
  const age = runMinutes(series, trend, barMinutes);
  if (age < MIN_CURRENT_MINUTES) return { call: 'wait' };
  if (lowerTimeframeTurning(smc.trendAt, trend, barMinutes)) return { call: 'wait' };

  const minutes = minutesLeft(splitRuns(series, barMinutes), trend, age);
  if (minutes < MIN_CONTINUE_MINUTES) return { call: 'wait' };
  return { call: 'continue', minutes };
}

/** Minutes the displayed trend has already held. A short sideways gap does not reset it. */
function runMinutes(
  series: readonly (SmcTrend | null)[],
  trend: SmcTrend,
  barMinutes: number,
): number {
  // One or two one-minute sideways prints do not wipe a trend that is still on the card.
  const maxGap = barMinutes >= MIN_CONTINUE_MINUTES ? 0 : 2;
  let bars = 0;
  let gap = 0;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i] ?? 'sideways';
    if (value === trend) {
      bars += gap + 1;
      gap = 0;
      continue;
    }
    if (value === 'sideways' && gap < maxGap) {
      gap += 1;
      continue;
    }
    break;
  }
  return bars * barMinutes;
}

function lowerTimeframeTurning(
  trendAt: readonly (SmcTrend | null)[],
  trend: 'bullish' | 'bearish',
  barMinutes: number,
): boolean {
  const bars = Math.max(1, Math.ceil(MIN_CURRENT_MINUTES / barMinutes));
  if (trendAt.length < bars) return false;
  const opposite: SmcTrend = trend === 'bullish' ? 'bearish' : 'bullish';
  for (let i = trendAt.length - bars; i < trendAt.length; i += 1) {
    if (trendAt[i] !== opposite) return false;
  }
  return true;
}

function minutesLeft(runs: TrendRun[], trend: SmcTrend, age: number): number {
  const completed = runs.slice(0, -1).filter((run) => run.trend === trend);
  const sample = completed.slice(-RECENT_RUNS);
  let raw = age;
  if (sample.length >= 2) {
    const remaining = lowerMedian(sample.map((run) => run.minutes)) - age;
    if (remaining >= MIN_CONTINUE_MINUTES) raw = remaining;
  }
  const rounded = Math.floor(raw / ROUND_MINUTES) * ROUND_MINUTES;
  return Math.min(rounded, MAX_CONTINUE_MINUTES);
}

function splitRuns(series: readonly (SmcTrend | null)[], barMinutes: number): TrendRun[] {
  const runs: TrendRun[] = [];
  series.forEach((value) => {
    const trend = value ?? 'sideways';
    const last = runs[runs.length - 1];
    if (last && last.trend === trend) {
      last.minutes += barMinutes;
      return;
    }
    runs.push({ trend, minutes: barMinutes });
  });
  return runs;
}

/** Lower of the two middle values, so an even sample does not overstate the hold. */
function lowerMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

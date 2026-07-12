import type { StrategyDna } from './types.ts';
import {
  ENTRY_IDS,
  EXIT_IDS,
  SR_IDS,
  STOP_IDS,
  TARGET_IDS,
  TIME_IDS,
  TREND_IDS,
} from './modules.ts';

function dnaId(d: Omit<StrategyDna, 'id'>): string {
  return [d.trend, d.sr, d.entry, d.stop, d.target, d.time, d.exit].join('|');
}

/** Full theoretical search space size. */
export function fullSearchSpaceSize(): number {
  return (
    TREND_IDS.length *
    SR_IDS.length *
    ENTRY_IDS.length *
    STOP_IDS.length *
    TARGET_IDS.length *
    TIME_IDS.length *
    EXIT_IDS.length
  );
}

/**
 * Generate strategy combinations.
 * - mode=full: entire cartesian product (millions — for distributed runs)
 * - mode=grid: stratified high-coverage grid (default thousands)
 * - mode=sample: random sample of N from full space
 */
export function generateStrategies(opts?: {
  mode?: 'full' | 'grid' | 'sample';
  limit?: number;
  seed?: number;
}): StrategyDna[] {
  const mode = opts?.mode ?? 'grid';
  const limit = opts?.limit ?? 4000;
  const seed = opts?.seed ?? 42;

  if (mode === 'full') {
    const all: StrategyDna[] = [];
    for (const trend of TREND_IDS) {
      for (const sr of SR_IDS) {
        for (const entry of ENTRY_IDS) {
          for (const stop of STOP_IDS) {
            for (const target of TARGET_IDS) {
              for (const time of TIME_IDS) {
                for (const exit of EXIT_IDS) {
                  const base = { trend, sr, entry, stop, target, time, exit };
                  all.push({ id: dnaId(base), ...base });
                }
              }
            }
          }
        }
      }
    }
    return all;
  }

  if (mode === 'sample') {
    const rng = mulberry32(seed);
    const seen = new Set<string>();
    const out: StrategyDna[] = [];
    while (out.length < limit) {
      const base = {
        trend: TREND_IDS[Math.floor(rng() * TREND_IDS.length)]!,
        sr: SR_IDS[Math.floor(rng() * SR_IDS.length)]!,
        entry: ENTRY_IDS[Math.floor(rng() * ENTRY_IDS.length)]!,
        stop: STOP_IDS[Math.floor(rng() * STOP_IDS.length)]!,
        target: TARGET_IDS[Math.floor(rng() * TARGET_IDS.length)]!,
        time: TIME_IDS[Math.floor(rng() * TIME_IDS.length)]!,
        exit: EXIT_IDS[Math.floor(rng() * EXIT_IDS.length)]!,
      };
      const id = dnaId(base);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, ...base });
    }
    return out;
  }

  // Stratified grid: prioritize PDHL + proven axes, then fill coverage
  const priorityTrends = ['opening_range', 'supertrend', 'ema50', 'prev_day_trend', 'hh_hl', 'none', 'vwap'] as const;
  const prioritySr = ['pdhl', 'swing', 'pivot', 'session_hl', 'dynamic_sr'] as const;
  const priorityEntry = [
    'breakout',
    'break_retest',
    'pullback',
    'liquidity_sweep',
    'bullish_engulfing',
    'bearish_engulfing',
    'inside_bar_break',
    'trendline_break',
  ] as const;
  const priorityStop = ['atr', 'prev_swing', 'fixed_points', 'candle_hl', 'zone_based'] as const;
  const priorityTarget = ['r_1_5', 'r_2', 'r_2_5', 'r_3', 'atr_target', 'next_resistance'] as const;
  const priorityTime = ['0920_1030', '1030_1200', 'one_trade_day', 'max_two_trades', 'whole_day'] as const;
  const priorityExit = ['fixed_rr', 'end_of_day', 'ema_exit', 'opposite_signal'] as const;

  const out: StrategyDna[] = [];
  const seen = new Set<string>();
  const push = (base: Omit<StrategyDna, 'id'>) => {
    const id = dnaId(base);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, ...base });
  };

  // Dense core around PDHL / OR / breakout (research favorite axes)
  for (const trend of priorityTrends) {
    for (const sr of prioritySr) {
      for (const entry of priorityEntry) {
        for (const stop of priorityStop) {
          for (const target of priorityTarget) {
            for (const time of priorityTime) {
              for (const exit of priorityExit) {
                push({ trend, sr, entry, stop, target, time, exit });
                if (out.length >= limit) return out;
              }
            }
          }
        }
      }
    }
  }

  // Fill remaining with random uncovered combos
  const rng = mulberry32(seed + 7);
  while (out.length < limit) {
    push({
      trend: TREND_IDS[Math.floor(rng() * TREND_IDS.length)]!,
      sr: SR_IDS[Math.floor(rng() * SR_IDS.length)]!,
      entry: ENTRY_IDS[Math.floor(rng() * ENTRY_IDS.length)]!,
      stop: STOP_IDS[Math.floor(rng() * STOP_IDS.length)]!,
      target: TARGET_IDS[Math.floor(rng() * TARGET_IDS.length)]!,
      time: TIME_IDS[Math.floor(rng() * TIME_IDS.length)]!,
      exit: EXIT_IDS[Math.floor(rng() * EXIT_IDS.length)]!,
    });
  }
  return out;
}

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

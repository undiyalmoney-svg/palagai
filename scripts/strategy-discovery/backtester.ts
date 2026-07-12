import type { BarFeatures, ClosedTrade, StrategyDna } from './types.ts';
import {
  computeStop,
  computeTarget,
  entrySignal,
  inTimeWindow,
  maxTradesPerDay,
  shouldExitByRule,
  srLevels,
  trendBias,
} from './modules.ts';

export function backtestStrategy(features: BarFeatures[], dna: StrategyDna): ClosedTrade[] {
  const trades: ClosedTrade[] = [];
  let open: {
    direction: 'BUY' | 'SELL';
    entryTime: string;
    entry: number;
    stop: number;
    target: number;
    risk: number;
    trail: boolean;
  } | null = null;

  let dayTrades = 0;
  let currentDay = '';

  for (let i = 30; i < features.length; i += 1) {
    const f = features[i]!;
    const prev = features[i - 1] ?? null;

    if (f.day !== currentDay) {
      currentDay = f.day;
      dayTrades = 0;
    }

    if (open) {
      // trailing stop update
      if (dna.target === 'trailing_stop' || dna.exit === 'trailing_swing') {
        if (open.direction === 'BUY') {
          open.stop = Math.max(open.stop, f.swingLow, f.close - f.atr);
        } else {
          open.stop = Math.min(open.stop, f.swingHigh, f.close + f.atr);
        }
      }

      let exitPrice: number | null = null;
      let points = 0;

      if (open.direction === 'BUY') {
        if (f.low <= open.stop) {
          exitPrice = open.stop;
          points = exitPrice - open.entry;
        } else if (dna.exit === 'fixed_rr' || dna.target !== 'trailing_stop') {
          if (f.high >= open.target) {
            exitPrice = open.target;
            points = exitPrice - open.entry;
          }
        }
      } else {
        if (f.high >= open.stop) {
          exitPrice = open.stop;
          points = open.entry - exitPrice;
        } else if (dna.exit === 'fixed_rr' || dna.target !== 'trailing_stop') {
          if (f.low <= open.target) {
            exitPrice = open.target;
            points = open.entry - exitPrice;
          }
        }
      }

      const bias = trendBias(f, dna.trend);
      const opposite =
        (open.direction === 'BUY' && bias === 'SELL') ||
        (open.direction === 'SELL' && bias === 'BUY');

      if (exitPrice === null && shouldExitByRule(f, open.direction, dna.exit, opposite)) {
        exitPrice = f.close;
        points = open.direction === 'BUY' ? exitPrice - open.entry : open.entry - exitPrice;
      }

      if (exitPrice === null && f.hhmm >= '15:15') {
        exitPrice = f.close;
        points = open.direction === 'BUY' ? exitPrice - open.entry : open.entry - exitPrice;
      }

      if (exitPrice !== null) {
        trades.push({
          entryTime: open.entryTime,
          exitTime: f.date,
          direction: open.direction,
          entry: open.entry,
          exit: exitPrice,
          stop: open.stop,
          target: open.target,
          points,
          rMultiple: points / open.risk,
          outcome: points > 0 ? 'WIN' : 'LOSS',
          month: f.day.slice(0, 7),
          year: f.day.slice(0, 4),
        });
        open = null;
      }
      continue;
    }

    if (dayTrades >= maxTradesPerDay(dna.time)) continue;
    if (!inTimeWindow(f.hhmm, dna.time)) continue;

    const bias = trendBias(f, dna.trend);
    const levels = srLevels(f, dna.sr);
    const signal = entrySignal(f, prev, dna.entry, bias, levels);
    if (!signal) continue;

    const entry = f.close;
    const stop = computeStop(f, signal, entry, dna.stop, levels);
    const risk = Math.abs(entry - stop);
    if (risk < 5 || risk > 250) continue;
    const target = computeTarget(f, signal, entry, stop, dna.target, levels);

    open = {
      direction: signal,
      entryTime: f.date,
      entry,
      stop,
      target,
      risk,
      trail: dna.target === 'trailing_stop',
    };
    dayTrades += 1;
  }

  return trades;
}

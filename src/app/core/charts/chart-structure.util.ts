/**
 * Live 1:1 measured-move box for the Charts tab.
 *
 * Same drawing the Price Action Tamil shorts use, built from the S/R zones
 * this tab already draws:
 *
 *   wall     — the band that a CLOSED candle broke
 *   pink     — adverse extreme → wall (risk / SL)
 *   teal     — wall → wall ± height (target / EXIT)
 *
 * CE (breakout) stacks teal above pink. PE (breakdown) stacks pink above teal.
 * Height is always equal, so the stop and the target are 1R.
 *
 * Chart-tab only. Does not call the desk, does not share Trade Bot DNA, and
 * does not place orders — the Charts page decides whether to buy from this.
 *
 * Pure over `Candle[]` and `SrZone[]`.
 */
import { Candle } from '../models/candle.model';
import { dropFormingBars } from '../paper-desk/forming-bar.util';
import { SrZone } from './sr-chart.util';
import { zoneRoleAt } from './sr-signals.util';
import { AtmOptionSide } from '../orders/atm-order.util';

export type ChartStructureDir = 1 | -1;
export type ChartStructureStatus = 'live' | 'hit_sl' | 'hit_exit';

export interface ChartStructureBox {
  lo: number;
  hi: number;
  fromIndex: number;
  toIndex: number;
}

export interface ChartStructure {
  dir: ChartStructureDir;
  option: AtmOptionSide;
  wall: number;
  height: number;
  /** Far edge of pink — cost-to-cost stop on the index. */
  sl: number;
  /** Broken wall. */
  entry: number;
  /** Far edge of teal — 1:1 measured move. */
  exit: number;
  pink: ChartStructureBox;
  teal: ChartStructureBox;
  breakIndex: number;
  fromIndex: number;
  toIndex: number;
  date: string;
  status: ChartStructureStatus;
  /**
   * The break is the last closed bar. Auto-trade may fire only while this is
   * true, so an old structure on screen is never sent as a late market order.
   */
  fresh: boolean;
}

export interface ChartStructureOptions {
  intervalMinutes?: number;
  now?: Date;
  /** Skip boxes shorter than this many ATRs. Tiny bands are noise, not a 1R. */
  minHeightAtr?: number;
  /** Bars before the break used to measure the adverse swing. */
  lookbackBars?: number;
}

const DEFAULTS = {
  minHeightAtr: 0.4,
  lookbackBars: 24,
};

export function detectChartStructure(
  candles: Candle[],
  zones: SrZone[],
  atr: number | null,
  options: ChartStructureOptions = {},
): ChartStructure | null {
  const minHeightAtr = options.minHeightAtr ?? DEFAULTS.minHeightAtr;
  const lookbackBars = options.lookbackBars ?? DEFAULTS.lookbackBars;
  const series =
    options.intervalMinutes != null && options.intervalMinutes > 0
      ? dropFormingBars(candles, options.now ?? new Date(), options.intervalMinutes)
      : candles;
  if (series.length < 2 || !zones.length) {
    return null;
  }

  const minHeight = atr != null && atr > 0 ? atr * minHeightAtr : 0;
  const lastClosed = series.length - 1;
  const drawTo = Math.max(lastClosed, candles.length - 1);

  for (let i = lastClosed; i >= 1; i -= 1) {
    const built = bestBreakAt(series, zones, i, lookbackBars, minHeight, drawTo);
    if (!built) continue;
    return {
      ...built,
      status: structureStatus(built, candles),
      fresh: i === lastClosed,
    };
  }
  return null;
}

/** Idempotent key so Auto Trade cannot send the same break twice. */
export function chartStructureKey(book: string, structure: ChartStructure): string {
  return `${book}|${structure.date}|${structure.dir}|${structure.wall}`;
}

export function canAutoEnter(structure: ChartStructure | null): structure is ChartStructure {
  return !!structure && structure.fresh && structure.status === 'live';
}

/**
 * Option SL trigger from the fill premium and the index box height.
 *
 * ATM delta is treated as ~0.5, so the rupee stop tracks half the index 1R,
 * floored at 20% of the fill (cost-to-cost, not zero) and always at least one
 * tick below the fill.
 */
export function optionStopTrigger(
  fillPremium: number,
  indexHeight: number,
  tickSize = 0.05,
): number | null {
  const fill = Number(fillPremium);
  const height = Number(indexHeight);
  const tick = Number(tickSize) > 0 ? Number(tickSize) : 0.05;
  if (!(fill > tick) || !(height > 0)) return null;
  const raw = fill - 0.5 * height;
  const floor = fill * 0.2;
  const trigger = Math.max(tick, Math.min(fill - tick, Math.max(floor, raw)));
  return roundToTick(trigger, tick);
}

function bestBreakAt(
  series: Candle[],
  zones: SrZone[],
  index: number,
  lookbackBars: number,
  minHeight: number,
  drawTo: number,
): Omit<ChartStructure, 'status' | 'fresh'> | null {
  const bar = series[index]!;
  const prev = series[index - 1]!;
  let best: Omit<ChartStructure, 'status' | 'fresh'> | null = null;

  for (const zone of zones) {
    if (zone.fromIndex >= index) continue;
    const candidate = structureFromBreak(series, zone, prev, bar, index, lookbackBars, drawTo);
    if (!candidate || candidate.height < minHeight) continue;
    if (!best || candidate.height > best.height) {
      best = candidate;
    }
  }
  return best;
}

function structureFromBreak(
  series: Candle[],
  zone: SrZone,
  prev: Candle,
  bar: Candle,
  index: number,
  lookbackBars: number,
  drawTo: number,
): Omit<ChartStructure, 'status' | 'fresh'> | null {
  const role = zoneRoleAt(prev, zone);
  const fromIndex = Math.max(0, zone.fromIndex, index - lookbackBars);
  if (role === 'resistance' && prev.close <= zone.hi && bar.close > zone.hi) {
    const wall = round2(zone.hi);
    const adverse = minLow(series, fromIndex, index);
    const height = wall - adverse;
    if (!(height > 0)) return null;
    const measured = round2(wall + height);
    const sl = round2(adverse);
    return boxOf({
      dir: 1,
      option: 'CE',
      wall,
      height: round2(height),
      sl,
      exit: measured,
      fromIndex,
      breakIndex: index,
      drawTo,
      date: bar.date,
    });
  }
  if (role === 'support' && prev.close >= zone.lo && bar.close < zone.lo) {
    const wall = round2(zone.lo);
    const adverse = maxHigh(series, fromIndex, index);
    const height = adverse - wall;
    if (!(height > 0)) return null;
    const measured = round2(wall - height);
    const sl = round2(adverse);
    return boxOf({
      dir: -1,
      option: 'PE',
      wall,
      height: round2(height),
      sl,
      exit: measured,
      fromIndex,
      breakIndex: index,
      drawTo,
      date: bar.date,
    });
  }
  return null;
}

function boxOf(args: {
  dir: ChartStructureDir;
  option: AtmOptionSide;
  wall: number;
  height: number;
  sl: number;
  exit: number;
  fromIndex: number;
  breakIndex: number;
  drawTo: number;
  date: string;
}): Omit<ChartStructure, 'status' | 'fresh'> {
  const { dir, wall, sl, exit, fromIndex, drawTo } = args;
  return {
    dir,
    option: args.option,
    wall,
    height: args.height,
    sl,
    entry: wall,
    exit,
    pink: {
      lo: round2(dir > 0 ? sl : wall),
      hi: round2(dir > 0 ? wall : sl),
      fromIndex,
      toIndex: drawTo,
    },
    teal: {
      lo: round2(dir > 0 ? wall : exit),
      hi: round2(dir > 0 ? exit : wall),
      fromIndex,
      toIndex: drawTo,
    },
    breakIndex: args.breakIndex,
    fromIndex,
    toIndex: drawTo,
    date: args.date,
  };
}

function structureStatus(
  box: { dir: ChartStructureDir; sl: number; exit: number; breakIndex: number },
  candles: Candle[],
): ChartStructureStatus {
  // The stop is the extreme of the range that MADE the wall, including the
  // break bar — so that bar always tags SL if we scored it. Only bars after
  // the break can hit the stop. The target may print on the break bar itself.
  for (let i = box.breakIndex; i < candles.length; i += 1) {
    const bar = candles[i]!;
    if (i > box.breakIndex) {
      if (box.dir > 0 ? bar.low <= box.sl : bar.high >= box.sl) {
        return 'hit_sl';
      }
    }
    if (box.dir > 0 ? bar.high >= box.exit : bar.low <= box.exit) {
      return 'hit_exit';
    }
  }
  return 'live';
}

function minLow(series: Candle[], from: number, to: number): number {
  let lo = Infinity;
  for (let i = from; i <= to; i += 1) {
    lo = Math.min(lo, series[i]!.low);
  }
  return lo;
}

function maxHigh(series: Candle[], from: number, to: number): number {
  let hi = -Infinity;
  for (let i = from; i <= to; i += 1) {
    hi = Math.max(hi, series[i]!.high);
  }
  return hi;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function roundToTick(value: number, tick: number): number {
  return Math.round(value / tick) * tick;
}

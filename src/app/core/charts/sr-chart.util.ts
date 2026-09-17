/**
 * Support / resistance model for the live chart tab.
 *
 * Produces the three things a TradingView-style S/R chart draws: swing pivots,
 * price ZONES (boxes, not bare lines — a level that has been touched at slightly
 * different prices is a band), and the CONNECTION LINES that join consecutive
 * pivots so the structure trend is visible.
 *
 * Pure functions over `Candle[]` — no Kite, no DOM, no signals — so the same
 * model can be unit tested and reused for any instrument or interval.
 *
 * Tolerances are ATR-derived rather than a fixed rupee band: Nifty (~24,000),
 * Bank Nifty (~55,000) and Crude Oil Mini (~9,500) have very different tick
 * scales, and a band that suits one would be noise or the whole range on another.
 */
import { Candle } from '../models/candle.model';

export type SrZoneKind = 'support' | 'resistance';
export type SrPivotKind = 'high' | 'low';

export interface SrPivot {
  index: number;
  price: number;
  date: string;
  kind: SrPivotKind;
}

export interface SrZone {
  lo: number;
  hi: number;
  mid: number;
  kind: SrZoneKind;
  /** Pivots that landed in this band — the level's strength. */
  touches: number;
  /** Bar the zone was first formed at; the box is drawn from here to the right edge. */
  fromIndex: number;
}

/** A straight segment joining two consecutive pivots of the same kind. */
export interface SrLink {
  kind: SrPivotKind;
  fromIndex: number;
  fromPrice: number;
  toIndex: number;
  toPrice: number;
}

export interface SrChartModel {
  pivots: SrPivot[];
  zones: SrZone[];
  links: SrLink[];
  last: { index: number; price: number; date: string } | null;
  /** Change against the previous session's close (falls back to the first open). */
  changeAbs: number | null;
  changePct: number | null;
  atr: number | null;
}

export interface SrChartOptions {
  /** Bars either side that a pivot must exceed. 2 matches the strategy engine's fractal. */
  pivotStrength?: number;
  /** Cap on drawn zones, nearest to price first. */
  maxZones?: number;
  /** Half-height of a zone as a multiple of ATR. */
  zoneAtrMult?: number;
  /** Pivots per side to join with connection lines. */
  maxLinkPivots?: number;
  /** ATR lookback. */
  atrPeriod?: number;
}

const DEFAULTS: Required<SrChartOptions> = {
  pivotStrength: 2,
  maxZones: 6,
  zoneAtrMult: 0.45,
  maxLinkPivots: 4,
  atrPeriod: 14,
};

/** Fallback band when ATR cannot be computed (too few bars): 0.15% of price. */
const FALLBACK_TOLERANCE_PCT = 0.0015;

/** Hard ceiling on a merged zone, in tolerance bands. Stops cluster drift. */
const MAX_CLUSTER_BANDS = 1.5;

export function averageTrueRange(candles: Candle[], period = DEFAULTS.atrPeriod): number | null {
  if (candles.length < 2) {
    return null;
  }
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const window = trs.slice(-Math.max(1, period));
  if (!window.length) {
    return null;
  }
  return window.reduce((sum, tr) => sum + tr, 0) / window.length;
}

/**
 * Fractal pivots in one pass. At `strength` 2 this is the same 2-bar fractal the
 * strategy engine's detectSwingHighs / detectSwingLows use — asserted by spec so
 * the chart cannot quietly disagree with the engine about where a swing is.
 */
export function detectPivots(candles: Candle[], strength = DEFAULTS.pivotStrength): SrPivot[] {
  const s = Math.max(1, Math.floor(strength) || 1);
  const pivots: SrPivot[] = [];
  for (let i = s; i < candles.length - s; i += 1) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= s; k += 1) {
      const before = candles[i - k]!;
      const after = candles[i + k]!;
      if (!(c.high > before.high && c.high > after.high)) {
        isHigh = false;
      }
      if (!(c.low < before.low && c.low < after.low)) {
        isLow = false;
      }
      if (!isHigh && !isLow) {
        break;
      }
    }
    if (isHigh) {
      pivots.push({ index: i, price: c.high, date: c.date, kind: 'high' });
    }
    // A single bar can be both the local high and the local low of an inside range.
    if (isLow) {
      pivots.push({ index: i, price: c.low, date: c.date, kind: 'low' });
    }
  }
  return pivots;
}

/**
 * Cluster pivots that sit within `tolerance` of each other into zones.
 *
 * Greedy from the strongest anchor outward: pivots are visited nearest-to-price
 * first so the bands that matter for the current trade are the ones that keep
 * their shape, and weaker far-away pivots merge into whatever is already there.
 */
export function clusterZones(
  pivots: SrPivot[],
  lastPrice: number,
  tolerance: number,
): SrZone[] {
  const band = Math.max(tolerance, 1e-9);
  const ordered = [...pivots].sort(
    (a, b) => Math.abs(a.price - lastPrice) - Math.abs(b.price - lastPrice),
  );

  const clusters: { members: SrPivot[]; lo: number; hi: number }[] = [];
  for (const pivot of ordered) {
    const hit = clusters.find((c) => {
      if (Math.abs(midOf(c) - pivot.price) > band) {
        return false;
      }
      // The midpoint moves as touches join, so membership alone would let a
      // chain of pivots walk a zone arbitrarily wide. Cap the span too.
      const lo = Math.min(c.lo, pivot.price);
      const hi = Math.max(c.hi, pivot.price);
      return hi - lo <= band * MAX_CLUSTER_BANDS;
    });
    if (hit) {
      hit.members.push(pivot);
      hit.lo = Math.min(hit.lo, pivot.price);
      hit.hi = Math.max(hit.hi, pivot.price);
    } else {
      clusters.push({ members: [pivot], lo: pivot.price, hi: pivot.price });
    }
  }

  return clusters.map((c) => {
    // A single-touch level is a line, so give it the full band to stay visible.
    const pad = c.hi - c.lo < band ? (band - (c.hi - c.lo)) / 2 : 0;
    const lo = c.lo - pad;
    const hi = c.hi + pad;
    return {
      lo,
      hi,
      mid: (lo + hi) / 2,
      kind: (lo + hi) / 2 >= lastPrice ? 'resistance' : 'support',
      touches: c.members.length,
      fromIndex: Math.min(...c.members.map((m) => m.index)),
    } satisfies SrZone;
  });
}

/** Join consecutive same-kind pivots so structure direction is drawn, not inferred. */
export function buildLinks(pivots: SrPivot[], maxPivots = DEFAULTS.maxLinkPivots): SrLink[] {
  const links: SrLink[] = [];
  for (const kind of ['high', 'low'] as const) {
    const side = pivots
      .filter((p) => p.kind === kind)
      .sort((a, b) => a.index - b.index)
      .slice(-Math.max(2, maxPivots));
    for (let i = 1; i < side.length; i += 1) {
      const from = side[i - 1]!;
      const to = side[i]!;
      links.push({
        kind,
        fromIndex: from.index,
        fromPrice: from.price,
        toIndex: to.index,
        toPrice: to.price,
      });
    }
  }
  return links;
}

export function buildSrChartModel(
  candles: Candle[],
  options: SrChartOptions = {},
): SrChartModel {
  const opts = { ...DEFAULTS, ...options };
  if (!candles.length) {
    return { pivots: [], zones: [], links: [], last: null, changeAbs: null, changePct: null, atr: null };
  }

  const lastIndex = candles.length - 1;
  const lastCandle = candles[lastIndex]!;
  const atr = averageTrueRange(candles, opts.atrPeriod);
  const tolerance = atr != null && atr > 0
    ? atr * opts.zoneAtrMult
    : Math.abs(lastCandle.close) * FALLBACK_TOLERANCE_PCT;

  const pivots = detectPivots(candles, opts.pivotStrength);
  const zones = clusterZones(pivots, lastCandle.close, tolerance)
    .sort((a, b) => {
      // Strength first, then proximity — a thrice-touched level outranks a
      // closer one-touch wick.
      if (b.touches !== a.touches) {
        return b.touches - a.touches;
      }
      return Math.abs(a.mid - lastCandle.close) - Math.abs(b.mid - lastCandle.close);
    })
    .slice(0, Math.max(0, opts.maxZones));

  const reference = previousSessionClose(candles);
  const changeAbs = reference != null ? lastCandle.close - reference : null;
  const changePct =
    reference != null && reference !== 0 ? ((lastCandle.close - reference) / reference) * 100 : null;

  return {
    pivots,
    zones,
    links: buildLinks(pivots, opts.maxLinkPivots),
    last: { index: lastIndex, price: lastCandle.close, date: lastCandle.date },
    changeAbs,
    changePct,
    atr,
  };
}

/** Day session key (`YYYY-MM-DD`) of a Kite candle timestamp. */
export function sessionKey(date: string): string {
  return String(date).slice(0, 10);
}

/**
 * Close of the last bar belonging to an earlier session, which is what an
 * exchange quotes the day change against. Falls back to the first bar's open
 * when the series holds a single session.
 */
export function previousSessionClose(candles: Candle[]): number | null {
  if (!candles.length) {
    return null;
  }
  const today = sessionKey(candles[candles.length - 1]!.date);
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    if (sessionKey(candles[i]!.date) !== today) {
      return candles[i]!.close;
    }
  }
  return candles[0]!.open;
}

function midOf(cluster: { lo: number; hi: number }): number {
  return (cluster.lo + cluster.hi) / 2;
}

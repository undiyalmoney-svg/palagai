/**
 * Buy / sell markers for the live chart tab.
 *
 * These read the SAME support and resistance zones the chart draws, so a marker
 * always has a visible reason sitting under it: a bar either turned at a band or
 * closed through one. Four patterns, which is all the structure a zone offers:
 *
 *   BUY  bounce     — dipped into support and closed back above it
 *   BUY  breakout   — closed clear above a resistance band it was under
 *   SELL rejection  — pushed into resistance and closed back below it
 *   SELL breakdown  — closed clear below a support band it was over
 *
 * This is a CHART ANNOTATION, deliberately independent of the live trading
 * engine: it has no regime filter, no risk sizing and no cost model, so it must
 * never be presented as what the bot would do. It exists to make the structure
 * on screen readable, and the UI labels it as such.
 *
 * Pure over `Candle[]` and `SrZone[]` — no DOM, no signals, no Kite.
 */
import { Candle } from '../models/candle.model';
import { SrZone } from './sr-chart.util';

export type SrSignalSide = 'BUY' | 'SELL';
export type SrSignalKind = 'bounce' | 'breakout' | 'rejection' | 'breakdown';

export interface SrSignal {
  index: number;
  date: string;
  side: SrSignalSide;
  kind: SrSignalKind;
  /** Bar extreme the marker points at: the low for a BUY, the high for a SELL. */
  price: number;
  /** Close that triggered it, for the tooltip and the legend. */
  close: number;
  /** Middle of the zone that produced the signal. */
  zoneMid: number;
  /** Touch count of that zone — how well tested the level was. */
  strength: number;
  /** Short caption drawn next to the marker. */
  label: string;
}

export interface SrSignalOptions {
  /** Bars that must pass before another signal on the same side is allowed. */
  cooldownBars?: number;
  /** Newest-first cap, so a long series does not bury the chart in arrows. */
  maxSignals?: number;
  /**
   * Smallest high-to-low range, as a multiple of ATR, that counts as the level
   * having been tested. Filters the flat bars that idle against a band without
   * ever doing anything with it.
   *
   * Range rather than body: the clearest support test of all is a pin bar,
   * which has a long wick and almost no body.
   */
  minRangeAtr?: number;
}

const DEFAULTS: Required<SrSignalOptions> = {
  cooldownBars: 3,
  maxSignals: 12,
  minRangeAtr: 0.25,
};

const LABELS: Record<SrSignalKind, string> = {
  bounce: 'Bounce',
  breakout: 'Breakout',
  rejection: 'Rejection',
  breakdown: 'Breakdown',
};

export function detectSrSignals(
  candles: Candle[],
  zones: SrZone[],
  atr: number | null,
  options: SrSignalOptions = {},
): SrSignal[] {
  const opts = { ...DEFAULTS, ...options };
  if (candles.length < 2 || !zones.length) {
    return [];
  }
  // Without ATR every bar clears the filter, which is the safe direction: a
  // short series should still annotate rather than silently draw nothing.
  const minRange = atr != null && atr > 0 ? atr * opts.minRangeAtr : 0;

  const found: SrSignal[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const bar = candles[i]!;
    const prev = candles[i - 1]!;
    if (bar.high - bar.low < minRange) {
      continue;
    }
    const best = bestSignalAt(bar, prev, i, zones);
    if (best) {
      found.push(best);
    }
  }

  return capAndSpace(found, opts.cooldownBars, opts.maxSignals);
}

/**
 * Strongest pattern on one bar. A bar can sit against several bands at once —
 * take the best tested one rather than drawing a pile of arrows on one candle.
 */
function bestSignalAt(
  bar: Candle,
  prev: Candle,
  index: number,
  zones: SrZone[],
): SrSignal | null {
  let best: SrSignal | null = null;
  for (const zone of zones) {
    // A level cannot have acted before the swing that formed it existed.
    if (zone.fromIndex >= index) {
      continue;
    }
    const kind = patternAt(bar, prev, zone);
    if (!kind) {
      continue;
    }
    const side: SrSignalSide = kind === 'bounce' || kind === 'breakout' ? 'BUY' : 'SELL';
    const candidate: SrSignal = {
      index,
      date: bar.date,
      side,
      kind,
      price: side === 'BUY' ? bar.low : bar.high,
      close: bar.close,
      zoneMid: zone.mid,
      strength: zone.touches,
      label: LABELS[kind],
    };
    if (!best || candidate.strength > best.strength) {
      best = candidate;
    }
  }
  return best;
}

function patternAt(bar: Candle, prev: Candle, zone: SrZone): SrSignalKind | null {
  if (zone.kind === 'support') {
    // Traded into the band and closed back above it, finishing in the upper
    // half of its own range. A red bar with a long tail is still a rejection,
    // so the close is judged against the bar's range rather than its open.
    if (
      bar.low <= zone.hi &&
      bar.close > zone.hi &&
      closedHigh(bar) &&
      prev.close > zone.lo
    ) {
      return 'bounce';
    }
    // Was holding above the band on the last close, and gave it up on this one.
    if (prev.close >= zone.lo && bar.close < zone.lo) {
      return 'breakdown';
    }
    return null;
  }

  if (
    bar.high >= zone.lo &&
    bar.close < zone.lo &&
    !closedHigh(bar) &&
    prev.close < zone.hi
  ) {
    return 'rejection';
  }
  if (prev.close <= zone.hi && bar.close > zone.hi) {
    return 'breakout';
  }
  return null;
}

/** Closed in the upper half of its own range. */
function closedHigh(bar: Candle): boolean {
  return bar.close > (bar.high + bar.low) / 2;
}

/**
 * Thin the list out newest-first: the recent structure is what a reader cares
 * about, and a cooldown stops one choppy stretch against a band from stamping
 * the same arrow onto five bars in a row.
 */
function capAndSpace(signals: SrSignal[], cooldownBars: number, maxSignals: number): SrSignal[] {
  const gap = Math.max(0, Math.floor(cooldownBars));
  const kept: SrSignal[] = [];
  const lastIndexBySide = new Map<SrSignalSide, number>();

  for (let i = signals.length - 1; i >= 0; i -= 1) {
    const signal = signals[i]!;
    const seen = lastIndexBySide.get(signal.side);
    if (seen != null && seen - signal.index <= gap) {
      continue;
    }
    lastIndexBySide.set(signal.side, signal.index);
    kept.push(signal);
    if (kept.length >= Math.max(0, maxSignals)) {
      break;
    }
  }

  return kept.reverse();
}

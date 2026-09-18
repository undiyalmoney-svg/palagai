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
 * Each marker carries a CONFIDENCE percentage. Read the warning on
 * scoreConfidence before showing that number anywhere it could be mistaken for
 * an edge: it grades how textbook the setup looks, and nothing more.
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
export type SrSignalFactorKey = 'level' | 'close' | 'follow' | 'range' | 'volume';
export type SrConfidenceBand = 'low' | 'medium' | 'high';

/** One input to the confidence score, kept so the number can be explained. */
export interface SrSignalFactor {
  key: SrSignalFactorKey;
  /** Human name for the tooltip, e.g. `Level tested`. */
  label: string;
  /** 0–1: how well this bar met that particular test. */
  score: number;
  /** Share of the final score this factor carried; the weights sum to 1. */
  weight: number;
}

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
  /**
   * How textbook this setup is, 0–100. See scoreConfidence: it grades the
   * shape of the bar against the level, and is NOT a probability of profit.
   */
  confidence: number;
  confidenceBand: SrConfidenceBand;
  /** What made up that number, strongest contribution first. */
  factors: SrSignalFactor[];
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
  /** Drop signals scoring under this (0–100). Default 0 — draw them all. */
  minConfidence?: number;
}

const DEFAULTS: Required<SrSignalOptions> = {
  cooldownBars: 3,
  maxSignals: 12,
  minRangeAtr: 0.25,
  minConfidence: 0,
};

const LABELS: Record<SrSignalKind, string> = {
  bounce: 'Bounce',
  breakout: 'Breakout',
  rejection: 'Rejection',
  breakdown: 'Breakdown',
};

/**
 * Confidence is reported inside a band, never as 0% or 100%.
 *
 * A signal only exists because it already passed the pattern test, so the
 * floor is "the weakest setup that still qualified" rather than "no
 * confidence". The ceiling is short of 100 because no chart pattern is a
 * certainty and a round 100% would read as one.
 */
export const CONFIDENCE_FLOOR = 35;
export const CONFIDENCE_CEILING = 95;

/**
 * Touches at which a level counts as fully tested in absolute terms.
 *
 * Scoring is mostly *relative* to the other bands on the same chart, because
 * touch counts scale with the bar count and the timeframe — 200 one-minute
 * bars produce far more touches than 200 hourly ones, and a fixed number would
 * read as "every level is perfect" on one and "nothing is tested" on the
 * other. This absolute mark is the backstop: on a chart whose best band has
 * been hit twice, that band is the best available, not a well-tested level.
 */
const LEVEL_TOUCH_CAP = 4;
/** Clearing or recovering this much ATR beyond the band is a full score. */
const FOLLOW_ATR = 0.5;
/** Bars whose volume is this multiple of the local median score full. */
const VOLUME_SURGE = 1.5;
/** Bars of context for the volume baseline. */
const VOLUME_LOOKBACK = 20;

const FACTOR_LABELS: Record<SrSignalFactorKey, string> = {
  level: 'Level tested',
  close: 'Closed strong',
  follow: 'Cleared the band',
  range: 'Bar decisiveness',
  volume: 'Volume behind it',
};

/**
 * Base weights. They are renormalised per signal, because volume only counts
 * on a series that has any: Kite reports 0 volume on index candles, and
 * scoring Nifty's every bar as "no volume behind it" would drag the whole
 * book down against Crude for a reason that says nothing about the setup.
 */
const FACTOR_WEIGHTS: Record<SrSignalFactorKey, number> = {
  level: 0.3,
  close: 0.25,
  follow: 0.25,
  range: 0.2,
  volume: 0.15,
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
  const volumeBaseline = volumeBaselines(candles);
  const peerTouches = Math.max(...zones.map((z) => z.touches));

  const found: SrSignal[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const bar = candles[i]!;
    const prev = candles[i - 1]!;
    if (bar.high - bar.low < minRange) {
      continue;
    }
    const best = bestSignalAt(bar, prev, i, zones, atr, volumeBaseline[i] ?? null, peerTouches);
    if (best && best.confidence >= opts.minConfidence) {
      found.push(best);
    }
  }

  return capAndSpace(found, opts.cooldownBars, opts.maxSignals);
}

/**
 * Strongest pattern on one bar. A bar can sit against several bands at once —
 * take the best one rather than drawing a pile of arrows on one candle.
 *
 * Judged on confidence rather than touch count alone: a shallow poke at a
 * four-touch level is a worse read than a decisive close through a two-touch
 * one, and the score already weighs both.
 */
function bestSignalAt(
  bar: Candle,
  prev: Candle,
  index: number,
  zones: SrZone[],
  atr: number | null,
  volumeBaseline: number | null,
  peerTouches: number,
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
    const { confidence, factors } = scoreConfidence({
      bar,
      zone,
      kind,
      side,
      atr,
      volumeBaseline,
      peerTouches,
    });
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
      confidence,
      confidenceBand: confidenceBand(confidence),
      factors,
    };
    if (
      !best ||
      candidate.confidence > best.confidence ||
      (candidate.confidence === best.confidence && candidate.strength > best.strength)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * How textbook this signal looks, 0–100.
 *
 * WHAT THIS IS NOT: a win rate, an expectancy, or anything measured against
 * outcomes. Nothing here has been fitted to what happened after the signal —
 * there is no backtest behind the number. It grades the *shape* of the bar
 * against the *quality* of the level, which is what a reader would grade by
 * eye, and it is calibrated by judgement rather than by data.
 *
 * Five things make a textbook reversal or break, each scored 0–1:
 *
 *   level   how many times the band had been respected before this bar
 *   close   how far toward the signal's own direction the bar closed
 *   follow  how far past the band it closed, or how deep a poke it recovered
 *   range   how big the bar was against ATR — conviction, not a doji
 *   volume  how the bar's volume compared with its neighbours (futures only)
 *
 * The weighted total is stretched across the reportable band, so the number a
 * reader sees is a *relative ranking of setups on their chart*, not a claim
 * about the market.
 */
export function scoreConfidence(params: {
  bar: Candle;
  zone: SrZone;
  kind: SrSignalKind;
  side: SrSignalSide;
  atr: number | null;
  volumeBaseline: number | null;
  /** Touch count of the best-tested band on the chart, for relative scoring. */
  peerTouches?: number;
}): { confidence: number; factors: SrSignalFactor[] } {
  const { bar, zone, kind, side, atr, volumeBaseline } = params;
  const range = bar.high - bar.low;
  const usableAtr = atr != null && atr > 0 ? atr : null;

  const scores: Partial<Record<SrSignalFactorKey, number>> = {
    level: levelQuality(zone.touches, params.peerTouches ?? zone.touches),
    close: closeStrength(bar, side, range),
    follow: followThrough(bar, zone, kind, usableAtr),
    // No ATR means no yardstick for "big bar", so stay neutral rather than
    // punishing every signal on a series too short to measure.
    range: usableAtr ? clamp01(range / usableAtr) : 0.5,
  };
  if (volumeBaseline != null && volumeBaseline > 0 && bar.volume > 0) {
    scores.volume = clamp01(bar.volume / (volumeBaseline * VOLUME_SURGE));
  }

  const keys = Object.keys(scores) as SrSignalFactorKey[];
  const totalWeight = keys.reduce((sum, key) => sum + FACTOR_WEIGHTS[key], 0);
  const factors = keys
    .map((key) => ({
      key,
      label: FACTOR_LABELS[key],
      score: scores[key]!,
      weight: FACTOR_WEIGHTS[key] / totalWeight,
    }))
    .sort((a, b) => b.score * b.weight - a.score * a.weight);

  const raw = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const confidence = Math.round(
    CONFIDENCE_FLOOR + clamp01(raw) * (CONFIDENCE_CEILING - CONFIDENCE_FLOOR),
  );
  return { confidence, factors };
}

export function confidenceBand(confidence: number): SrConfidenceBand {
  if (confidence >= 75) return 'high';
  if (confidence >= 55) return 'medium';
  return 'low';
}

/**
 * How well tested this band is, judged both against its neighbours on the same
 * chart and against an absolute idea of "tested".
 *
 * The lesser of the two wins, so neither reading can flatter a level: being
 * the best band on a chart of untouched lines does not make it strong, and
 * being hit six times does not make it the one to watch if another was hit
 * twenty.
 */
function levelQuality(touches: number, peerTouches: number): number {
  const peers = Math.max(1, peerTouches);
  return clamp01(Math.min(touches / peers, touches / LEVEL_TOUCH_CAP));
}

/**
 * Where the bar closed within its own range, read in the signal's direction.
 * A BUY that closed on its high scores 1; one that closed on its low scores 0.
 */
function closeStrength(bar: Candle, side: SrSignalSide, range: number): number {
  if (range <= 0) {
    return 0.5;
  }
  const fromLow = clamp01((bar.close - bar.low) / range);
  return side === 'BUY' ? fromLow : 1 - fromLow;
}

/**
 * Distance the bar put between itself and the band, in ATR.
 *
 * For a break that is how far past the edge it closed — a close barely peeking
 * over a level is the weak version of the same pattern. For a turn it is how
 * deep into the band price went before being pushed back out, since a long
 * recovered wick is the strongest test a level gets.
 */
function followThrough(
  bar: Candle,
  zone: SrZone,
  kind: SrSignalKind,
  atr: number | null,
): number {
  const distance =
    kind === 'breakout'
      ? bar.close - zone.hi
      : kind === 'breakdown'
        ? zone.lo - bar.close
        : kind === 'bounce'
          ? zone.hi - bar.low
          : bar.high - zone.lo;

  // Without ATR the band's own height is the only scale the series offers.
  const yardstick = atr ? atr * FOLLOW_ATR : zone.hi - zone.lo;
  if (!(yardstick > 0)) {
    return 0.5;
  }
  return clamp01(distance / yardstick);
}

/**
 * Trailing median volume per bar, as the baseline a surge is measured against.
 *
 * Median rather than mean so one opening bar cannot flatten the rest of the
 * session, and trailing rather than whole-series because volume at the open is
 * not comparable with volume at lunch. Null on a series without volume, which
 * is every index: Kite reports 0 there.
 */
function volumeBaselines(candles: Candle[]): (number | null)[] {
  if (!candles.some((c) => c.volume > 0)) {
    return candles.map(() => null);
  }
  return candles.map((_, i) => {
    const window = candles
      .slice(Math.max(0, i - VOLUME_LOOKBACK), i)
      .map((c) => c.volume)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (!window.length) {
      return null;
    }
    const mid = Math.floor(window.length / 2);
    return window.length % 2 ? window[mid]! : (window[mid - 1]! + window[mid]!) / 2;
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
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

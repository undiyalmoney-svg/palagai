/**
 * Visible-bar window for the candle panel: which slice of the series is on
 * screen, and how zoom / pan / new-bar arrival move it.
 *
 * Pure and Angular-free so the arithmetic can be tested without a browser —
 * the canvas renderer only turns the window into pixels.
 */

/** Smallest window a user can zoom into, so candles never become a single blob. */
export const MIN_VISIBLE_BARS = 12;
/** Zoomed-out enough to read a body, not so far that 180 bars are hairlines. */
export const TARGET_PX_PER_BAR = 9;
/** A phone-width plot fits very few bars at the target width; show at least this many. */
export const MIN_DEFAULT_BARS = 24;

/**
 * Breathing room past the newest candle, as a share of the visible window —
 * TradingView's right margin. Proportional rather than a fixed bar count so
 * the gap looks the same at every zoom level.
 */
export const DEFAULT_RIGHT_GAP_FRACTION = 0.12;
/**
 * How far right the series can be pushed. Well past the default so levels can
 * be projected forward into empty space, which is the point of the margin.
 */
export const MAX_RIGHT_GAP_FRACTION = 0.6;

/** Empty bars the opening window leaves after the last candle. */
export function defaultGapBars(count: number): number {
  return Math.max(2, Math.round(count * DEFAULT_RIGHT_GAP_FRACTION));
}

/** Empty bars the window may be scrolled out to. */
export function maxGapBars(count: number): number {
  return Math.max(defaultGapBars(count), Math.round(count * MAX_RIGHT_GAP_FRACTION));
}

export interface Viewport {
  /** First visible bar index. Fractional so a pan can stop mid-bar. */
  start: number;
  /** Visible bar count; the plot width is divided into this many slots. */
  count: number;
}

/**
 * Pull a window back inside the series.
 *
 * `start` may run well past the last bar — up to maxGapBars — so the chart can
 * be scrolled out to the right, leaving empty space to project levels into.
 */
export function clampViewport(view: Viewport, total: number): Viewport {
  if (total <= 0) {
    return { start: 0, count: 1 };
  }
  const minCount = Math.min(MIN_VISIBLE_BARS, total);
  const count = clamp(view.count, minCount, total);
  const maxStart = Math.max(0, total + maxGapBars(count) - count);
  return { start: clamp(view.start, 0, maxStart), count };
}

/** Window of `count` bars sitting on the newest candle, with the default margin. */
export function followRight(count: number, total: number): Viewport {
  const settled = clampViewport({ start: 0, count }, total);
  const start = total + defaultGapBars(settled.count) - settled.count;
  return clampViewport({ start, count: settled.count }, total);
}

/**
 * Opening window: aim for TARGET_PX_PER_BAR and show the newest bars.
 *
 * Fitting every bar into a phone-width canvas is what made the panel
 * unreadable, so the default is a recent slice rather than the whole series.
 */
export function defaultViewport(
  total: number,
  plotW: number,
  targetPxPerBar = TARGET_PX_PER_BAR,
): Viewport {
  if (total <= 0) {
    return { start: 0, count: 1 };
  }
  const fits = Math.floor(Math.max(0, plotW) / Math.max(1, targetPxPerBar));
  const count = Math.min(total, Math.max(MIN_DEFAULT_BARS, fits));
  return followRight(count, total);
}

/**
 * Zoom about an anchor, where `anchor` is 0 at the left edge of the plot and 1
 * at the right. The bar under the anchor keeps its screen position, so pinching
 * on a zone holds that zone still instead of sliding it away.
 *
 * `factor` below 1 zooms in (fewer bars), above 1 zooms out.
 */
export function zoomViewport(
  view: Viewport,
  total: number,
  factor: number,
  anchor = 1,
): Viewport {
  if (total <= 0 || !Number.isFinite(factor) || factor <= 0) {
    return clampViewport(view, total);
  }
  const current = clampViewport(view, total);
  const a = clamp(anchor, 0, 1);
  const minCount = Math.min(MIN_VISIBLE_BARS, total);
  const count = clamp(current.count * factor, minCount, total);
  const anchorBar = current.start + a * current.count;
  return clampViewport({ start: anchorBar - a * count, count }, total);
}

/** Shift the window by whole or partial bars; negative moves toward older bars. */
export function panViewport(view: Viewport, total: number, deltaBars: number): Viewport {
  const current = clampViewport(view, total);
  if (!Number.isFinite(deltaBars)) {
    return current;
  }
  return clampViewport({ start: current.start + deltaBars, count: current.count }, total);
}

/**
 * True when the window is following the newest bar.
 *
 * Scrolling out into the right margin still counts: the newest candle is
 * still what is being watched, just with more space ahead of it.
 */
export function isAtRightEdge(view: Viewport, total: number): boolean {
  if (total <= 0) return true;
  const current = clampViewport(view, total);
  const settled = Math.max(0, total + defaultGapBars(current.count) - current.count);
  return current.start >= settled - 0.5;
}

/** True when there is still room to push the series further left. */
export function canExpandRight(view: Viewport, total: number): boolean {
  if (total <= 0) return false;
  const current = clampViewport(view, total);
  const maxStart = Math.max(0, total + maxGapBars(current.count) - current.count);
  return current.start < maxStart - 0.5;
}

/**
 * Re-place the window after a refresh delivered a different number of bars.
 *
 * Someone watching the live edge should keep watching it as bars arrive, but
 * someone who panned back to study older structure should not be yanked
 * forward — so only a right-edge window follows.
 */
export function reanchorViewport(
  view: Viewport,
  prevTotal: number,
  nextTotal: number,
): Viewport {
  if (nextTotal <= 0) {
    return { start: 0, count: 1 };
  }
  const current = clampViewport(view, prevTotal);
  if (isAtRightEdge(current, prevTotal)) {
    // Carry the trailing gap across, so a margin the reader opened up by
    // scrolling right is not collapsed the moment a candle closes.
    const gap = current.start + current.count - prevTotal;
    return clampViewport(
      { start: nextTotal + gap - current.count, count: current.count },
      nextTotal,
    );
  }
  return clampViewport(current, nextTotal);
}

/** Inclusive bar indices to draw, padded a bar each side so partials clip cleanly. */
export function visibleRange(
  view: Viewport,
  total: number,
): { first: number; last: number } {
  if (total <= 0) {
    return { first: 0, last: -1 };
  }
  const current = clampViewport(view, total);
  const first = Math.max(0, Math.floor(current.start) - 1);
  const last = Math.min(total - 1, Math.ceil(current.start + current.count) + 1);
  return { first, last };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

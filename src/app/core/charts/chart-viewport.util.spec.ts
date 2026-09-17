import { describe, expect, it } from 'vitest';
import {
  MIN_DEFAULT_BARS,
  MIN_VISIBLE_BARS,
  RIGHT_GAP_BARS,
  clampViewport,
  defaultViewport,
  followRight,
  isAtRightEdge,
  panViewport,
  reanchorViewport,
  visibleRange,
  zoomViewport,
} from './chart-viewport.util';

describe('clampViewport', () => {
  it('keeps a window inside the series', () => {
    expect(clampViewport({ start: -5, count: 40 }, 180)).toEqual({ start: 0, count: 40 });
  });

  it('allows the right gap past the last bar but no further', () => {
    const v = clampViewport({ start: 999, count: 40 }, 180);
    expect(v.start).toBe(180 + RIGHT_GAP_BARS - 40);
  });

  it('never zooms in past the minimum window', () => {
    expect(clampViewport({ start: 0, count: 1 }, 180).count).toBe(MIN_VISIBLE_BARS);
  });

  it('never zooms out past the available bars', () => {
    expect(clampViewport({ start: 0, count: 500 }, 180).count).toBe(180);
  });

  it('falls back to the whole series when there are fewer bars than the minimum', () => {
    expect(clampViewport({ start: 0, count: 1 }, 5).count).toBe(5);
  });

  it('survives an empty series', () => {
    expect(clampViewport({ start: 3, count: 40 }, 0)).toEqual({ start: 0, count: 1 });
  });
});

describe('defaultViewport', () => {
  it('shows a recent slice sized to the target bar width, not the whole series', () => {
    // 900px of plot at ~9px a bar is 100 bars, so 180 bars must not all show.
    const v = defaultViewport(180, 900);
    expect(v.count).toBe(100);
    expect(isAtRightEdge(v, 180)).toBe(true);
  });

  it('keeps a readable minimum on a phone-width plot', () => {
    // 300px would fit only 33 bars; a 120px plot would fit 13, below the floor.
    expect(defaultViewport(180, 120).count).toBe(MIN_DEFAULT_BARS);
  });

  it('shows everything when the series is shorter than the window', () => {
    expect(defaultViewport(18, 900).count).toBe(18);
  });

  it('opens on the newest bars', () => {
    const v = defaultViewport(180, 300);
    expect(v.start + v.count).toBeGreaterThan(180);
  });
});

describe('zoomViewport', () => {
  it('zooms in on fewer bars and out on more', () => {
    const base = { start: 60, count: 60 };
    expect(zoomViewport(base, 180, 0.5).count).toBe(30);
    expect(zoomViewport(base, 180, 2).count).toBe(120);
  });

  it('holds the anchored bar still when zooming in', () => {
    const base = { start: 60, count: 60 };
    // The bar at the plot centre is 90; it must stay at the centre.
    const zoomed = zoomViewport(base, 180, 0.5, 0.5);
    expect(zoomed.start + zoomed.count / 2).toBeCloseTo(90);
  });

  it('holds the left edge when anchored left', () => {
    const zoomed = zoomViewport({ start: 60, count: 60 }, 180, 0.5, 0);
    expect(zoomed.start).toBeCloseTo(60);
  });

  it('clamps rather than running off the end when anchored right', () => {
    const zoomed = zoomViewport({ start: 120, count: 60 }, 180, 2, 1);
    expect(zoomed.start).toBeGreaterThanOrEqual(0);
    expect(zoomed.start + zoomed.count).toBeLessThanOrEqual(180 + RIGHT_GAP_BARS);
  });

  it('ignores a nonsense factor', () => {
    const base = { start: 60, count: 60 };
    expect(zoomViewport(base, 180, 0)).toEqual(clampViewport(base, 180));
    expect(zoomViewport(base, 180, Number.NaN)).toEqual(clampViewport(base, 180));
  });

  it('stays on the live edge when zooming anchored right', () => {
    let v = followRight(60, 180);
    for (let i = 0; i < 3; i += 1) {
      v = zoomViewport(v, 180, 1 / 1.35, 1);
      expect(isAtRightEdge(v, 180)).toBe(true);
    }
    expect(v.count).toBeLessThan(60);
  });

  it('stops at the minimum window however hard it is pinched', () => {
    let v = { start: 60, count: 60 };
    for (let i = 0; i < 40; i += 1) {
      v = zoomViewport(v, 180, 0.5, 0.5);
    }
    expect(v.count).toBe(MIN_VISIBLE_BARS);
  });
});

describe('panViewport', () => {
  it('moves the window by bars in both directions', () => {
    expect(panViewport({ start: 60, count: 40 }, 180, 10).start).toBe(70);
    expect(panViewport({ start: 60, count: 40 }, 180, -10).start).toBe(50);
  });

  it('stops at the oldest bar', () => {
    expect(panViewport({ start: 5, count: 40 }, 180, -100).start).toBe(0);
  });

  it('stops at the right gap', () => {
    const v = panViewport({ start: 100, count: 40 }, 180, 500);
    expect(v.start).toBe(180 + RIGHT_GAP_BARS - 40);
  });

  it('keeps the zoom level while panning', () => {
    expect(panViewport({ start: 60, count: 37 }, 180, 25).count).toBe(37);
  });
});

describe('isAtRightEdge', () => {
  it('is true for a freshly opened chart', () => {
    expect(isAtRightEdge(defaultViewport(180, 600), 180)).toBe(true);
  });

  it('is false once panned back', () => {
    expect(isAtRightEdge({ start: 40, count: 40 }, 180)).toBe(false);
  });

  it('treats an empty series as parked', () => {
    expect(isAtRightEdge({ start: 0, count: 1 }, 0)).toBe(true);
  });
});

describe('reanchorViewport', () => {
  it('follows the live edge when a new bar arrives', () => {
    const v = followRight(40, 180);
    const next = reanchorViewport(v, 180, 181);
    expect(isAtRightEdge(next, 181)).toBe(true);
    expect(next.count).toBe(40);
  });

  it('leaves a panned-back reader where they were', () => {
    const next = reanchorViewport({ start: 30, count: 40 }, 180, 181);
    expect(next.start).toBe(30);
    expect(next.count).toBe(40);
  });

  it('pulls a stale window back in when the series shrinks', () => {
    const next = reanchorViewport({ start: 150, count: 40 }, 180, 60);
    expect(next.start).toBeLessThanOrEqual(60 + RIGHT_GAP_BARS - 40);
    expect(next.count).toBe(40);
  });

  it('survives the series emptying out', () => {
    expect(reanchorViewport({ start: 30, count: 40 }, 180, 0)).toEqual({ start: 0, count: 1 });
  });
});

describe('visibleRange', () => {
  it('covers the window with a bar of bleed each side', () => {
    expect(visibleRange({ start: 60, count: 40 }, 180)).toEqual({ first: 59, last: 101 });
  });

  it('clips to the series bounds', () => {
    expect(visibleRange({ start: 0, count: 40 }, 180).first).toBe(0);
    expect(visibleRange(followRight(40, 180), 180).last).toBe(179);
  });

  it('reports an empty range for an empty series', () => {
    expect(visibleRange({ start: 0, count: 1 }, 0)).toEqual({ first: 0, last: -1 });
  });
});

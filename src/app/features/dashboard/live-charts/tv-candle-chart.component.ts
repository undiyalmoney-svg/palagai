/**
 * TradingView-style candlestick panel: candles, the Smart Money Concepts
 * overlay (see smc-chart-painter), a right-hand price axis with trade-level
 * tags, and a crosshair with an OHLC legend.
 *
 * Only a window of the series is drawn at a time — see chart-viewport.util —
 * so candles stay readable on a phone and can be zoomed and panned.
 *
 * Canvas 2D and no charting dependency, keeping the desk free of a chart library
 * — the desk ships no chart library and one 176KB bundle budget is not worth a
 * second renderer.
 */
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  output,
  signal,
} from '@angular/core';
import { Candle } from '../../../core/models/candle.model';
import { SmcAnalysis } from '../../../core/charts/smc/smc.types';
import { SmcLayers, defaultSmcSettings } from '../../../core/charts/smc/smc-settings';
import { focusTrades, paintSmcOver, paintSmcUnder, smcNoteAt } from './smc-chart-painter';
import { AtmOptionSide } from '../../../core/orders/atm-order.util';
import {
  Viewport,
  canExpandRight,
  clampPriceZoom,
  clampViewport,
  defaultViewport,
  isAtRightEdge,
  panViewport,
  reanchorViewport,
  stretchPriceRange,
  visibleRange,
  zoomViewport,
} from '../../../core/charts/chart-viewport.util';

/** TradingView's default light palette, so the panel reads as a TV chart. */
const COLORS = {
  bg: '#ffffff',
  grid: '#f0f3fa',
  axisText: '#787b86',
  axisLine: '#e0e3eb',
  bull: '#26a69a',
  bear: '#ef5350',
  link: 'rgba(120, 123, 134, 0.75)',
  pivot: '#787b86',
  crosshair: '#9598a1',
  lastUp: '#26a69a',
  lastDown: '#ef5350',
  legendInk: '#131722',
  slBg: 'rgba(211, 47, 47, 0.92)',
  entryBg: '#0f172a',
  tpBg: 'rgba(0, 137, 123, 0.92)',
} as const;

const FONT = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';
const FONT_BOLD = '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif';

const PAD = { top: 14, right: 68, bottom: 26, left: 8 } as const;
/** Axis pill height; also the minimum gap two axis labels may sit apart. */
const TAG_H = 15;
/** One button press. Coarser than a wheel notch, which arrives in bursts. */
const BUTTON_ZOOM = 1.35;
const WHEEL_ZOOM = 1.15;
/** A tap has to be brief and still, or it was a pan and must not move the crosshair. */
const TAP_MS = 300;
const TAP_SLOP_PX = 8;
/** Hold this long without moving and the finger starts scrubbing the crosshair. */
const LONG_PRESS_MS = 320;
/** Pixels of vertical axis drag for one e-fold of price stretch. */
const PRICE_DRAG_PX = 180;
/** One press of the vertical stretch buttons. */
const PRICE_BUTTON_STEP = 1.3;

interface AxisTag {
  y: number;
  text: string;
  bg: string;
  ink: string;
}

export interface TvCrosshairBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  changePct: number | null;
  /** What the SMC engine did on this bar: breaks, entries, exits. */
  notes: string[];
}

@Component({
  selector: 'app-tv-candle-chart',
  standalone: true,
  templateUrl: './tv-candle-chart.component.html',
  styleUrl: './tv-candle-chart.component.css',
})
export class TvCandleChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() candles: Candle[] = [];
  /** SMC engine output for these candles; null before the first analysis. */
  @Input() smc: SmcAnalysis | null = null;
  @Input() layers: SmcLayers = defaultSmcSettings().layers;
  /** Colours the last-price line and tag. */
  @Input() changeUp: boolean | null = null;
  /** Name of the higher timeframe, for the trend badge. */
  @Input() htfLabel = '1h';
  @Input() decimals = 2;
  /** Fallback only; the wrapper's CSS height wins so it can be responsive. */
  @Input() height = 340;
  @Input() emptyMessage = 'No candles yet.';
  /**
   * Changing this throws the zoom away and refits. The parent passes the
   * interval, because 30 bars of 15m and 30 bars of 1m are not the same view.
   */
  @Input() resetKey = '';
  /** Full-view ATM buttons — CE is Buy, PE is Sell of the index. */
  @Input() canOrder = false;
  @Input() orderLots = 1;
  @Input() maxOrderLots = 10;
  @Input() ordering: AtmOptionSide | null = null;
  @Input() orderHint = '';
  @Input() orderResult: { ok: boolean; text: string } | null = null;
  @Input() autoTrade = false;
  readonly buyAtm = output<AtmOptionSide>();
  readonly adjustLots = output<number>();
  readonly toggleAuto = output<void>();

  @ViewChild('canvas', { static: true }) canvasRef?: ElementRef<HTMLCanvasElement>;

  /** Hovered bar, mirrored into the HTML legend above the canvas. */
  protected readonly hover = signal<TvCrosshairBar | null>(null);
  /** Zoom readout and button states, published from the last paint. */
  protected readonly visibleCount = signal(0);
  protected readonly totalCount = signal(0);
  protected readonly canZoomIn = signal(false);
  protected readonly canZoomOut = signal(false);
  protected readonly atLiveEdge = signal(true);
  /** Room left to push the series further into the right margin. */
  protected readonly canScrollRight = signal(true);
  /** True once the price scale has been stretched away from auto-fit. */
  protected readonly priceStretched = signal(false);
  /**
   * Expanded mode: the panel takes over the viewport, the way TradingView's
   * fullscreen chart button works. A card-sized chart cannot show much of a
   * 180-bar series, and this is the cheapest way to get the room back.
   */
  protected readonly expanded = signal(false);
  /**
   * Crosshair drag mode. With it on, one finger moves the crosshair instead of
   * panning, so bars can be read by sliding rather than long-pressing each one.
   */
  protected readonly crosshairMode = signal(false);

  private ro: ResizeObserver | null = null;
  private crosshairIndex: number | null = null;
  private crosshairY: number | null = null;
  private frame: number | null = null;

  /** Null until the first paint, which needs the plot width to size the window. */
  private view: Viewport | null = null;
  /** Bars per pixel from the last paint, so a drag can be converted to bars. */
  private slotW = 1;
  private plotW = 1;

  private mouseDragX: number | null = null;
  private touchPanX: number | null = null;
  private pinchSpan: TouchSpan | null = null;
  private pinchAnchor = 0.5;
  private tapStart: { x: number; y: number; at: number } | null = null;

  /**
   * Price-scale stretch. 1 is auto-fit to the visible candles; above 1 shows a
   * narrower range over the same height, which is what "taller candles" means.
   */
  private priceZoom = 1;
  /** Vertical drag in progress on the price axis strip. */
  private axisDragY: number | null = null;
  /** Long-press scrub: the crosshair follows the finger until it lifts. */
  private scrubbing = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  ngAfterViewInit(): void {
    const parent = this.canvasRef?.nativeElement?.parentElement;
    if (parent && typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.scheduleDraw());
      this.ro.observe(parent);
    }
    this.scheduleDraw();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['resetKey'] && !changes['resetKey'].firstChange) {
      this.view = null;
      this.clearCrosshair();
    } else if (changes['candles'] && this.view) {
      const prev: unknown = changes['candles'].previousValue;
      const prevTotal = Array.isArray(prev) ? prev.length : 0;
      this.view = reanchorViewport(this.view, prevTotal, this.candles.length);
    }
    this.scheduleDraw();
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    this.endLongPress();
    this.lockPageScroll(false);
    if (this.frame != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.frame);
    }
  }

  protected zoomIn(): void {
    this.applyZoom(1 / BUTTON_ZOOM, this.buttonAnchor());
  }

  protected zoomOut(): void {
    this.applyZoom(BUTTON_ZOOM, this.buttonAnchor());
  }

  /**
   * Zoom about the live candle while parked on it, and about the middle once
   * scrolled back. Centre-anchoring at the live edge would walk the newest
   * bar off screen every press, which is the opposite of what someone
   * watching a running market wants.
   */
  private buttonAnchor(): number {
    const total = this.candles.length;
    return this.view && isAtRightEdge(this.view, total) ? 1 : 0.5;
  }

  /** Step by a third of the window, so a press always visibly moves. */
  protected pageBack(): void {
    this.applyPan(-Math.max(1, Math.round((this.view?.count ?? 3) / 3)));
  }

  protected pageForward(): void {
    this.applyPan(Math.max(1, Math.round((this.view?.count ?? 3) / 3)));
  }

  protected stretchPrice(): void {
    this.applyPriceZoom(PRICE_BUTTON_STEP);
  }

  protected squashPrice(): void {
    this.applyPriceZoom(1 / PRICE_BUTTON_STEP);
  }

  protected resetView(): void {
    this.view = null;
    this.priceZoom = 1;
    this.priceStretched.set(false);
    this.clearCrosshair();
    this.scheduleDraw();
  }

  private applyPriceZoom(factor: number): void {
    const next = clampPriceZoom(this.priceZoom * factor);
    if (next === this.priceZoom) return;
    this.priceZoom = next;
    this.priceStretched.set(Math.abs(next - 1) > 0.01);
    this.scheduleDraw();
  }

  /** True while the pointer is over the price axis strip rather than the plot. */
  private onPriceAxis(x: number, cssW: number): boolean {
    return x >= cssW - PAD.right;
  }

  private applyZoom(factor: number, anchor: number): void {
    const total = this.candles.length;
    if (!total) return;
    const base = this.view ?? defaultViewport(total, this.plotW);
    this.view = zoomViewport(base, total, factor, anchor);
    this.scheduleDraw();
  }

  private applyPan(deltaBars: number): void {
    const total = this.candles.length;
    if (!total) return;
    const base = this.view ?? defaultViewport(total, this.plotW);
    this.view = panViewport(base, total, deltaBars);
    this.scheduleDraw();
  }

  protected onMouseDown(event: MouseEvent): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // The price axis is the vertical handle, the way it is on TradingView.
    if (this.onPriceAxis(event.clientX - rect.left, rect.width)) {
      this.axisDragY = event.clientY;
      return;
    }
    this.mouseDragX = event.clientX;
  }

  protected onMouseUp(): void {
    this.mouseDragX = null;
    this.axisDragY = null;
  }

  /** Dragging scrolls the series; a plain move inspects a bar. */
  protected onPointerMove(event: MouseEvent): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    if (this.axisDragY != null) {
      const dy = event.clientY - this.axisDragY;
      this.axisDragY = event.clientY;
      this.dragPriceScale(dy);
      return;
    }
    if (this.mouseDragX != null) {
      const dx = event.clientX - this.mouseDragX;
      this.mouseDragX = event.clientX;
      this.applyPan(-dx / this.slotW);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    canvas.style.cursor = this.onPriceAxis(x, rect.width) ? 'ns-resize' : 'crosshair';
    this.setCrosshair(x, event.clientY - rect.top, rect.width);
  }

  /** Dragging up stretches the scale, down squashes it. */
  private dragPriceScale(dy: number): void {
    if (!dy) return;
    this.applyPriceZoom(Math.exp(-dy / PRICE_DRAG_PX));
  }

  protected onWheel(event: WheelEvent): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas || !this.candles.length || event.deltaY === 0) return;
    // The page would otherwise scroll away from the chart mid-zoom.
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const anchor = this.anchorAt(event.clientX - rect.left, rect.width);
    this.applyZoom(event.deltaY > 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, anchor);
  }

  protected onTouchStart(event: TouchEvent): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (event.touches.length >= 2) {
      const [a, b] = [event.touches[0]!, event.touches[1]!];
      this.pinchSpan = touchSpan(a, b);
      this.pinchAnchor = this.anchorAt(
        (a.clientX + b.clientX) / 2 - rect.left,
        rect.width,
      );
      this.endLongPress();
      this.touchPanX = null;
      this.tapStart = null;
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;
    this.pinchSpan = null;
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    if (this.onPriceAxis(x, rect.width)) {
      this.axisDragY = touch.clientY;
      this.touchPanX = null;
      this.tapStart = null;
      return;
    }

    // In crosshair mode the finger is the cursor from the first touch, with no
    // hold to wait out.
    if (this.crosshairMode()) {
      this.scrubbing = true;
      this.touchPanX = null;
      this.tapStart = null;
      this.setCrosshair(x, y, rect.width);
      this.preventIfCancelable(event);
      return;
    }

    this.touchPanX = touch.clientX;
    this.tapStart = { x, y, at: Date.now() };
    // Hold still and the finger takes over the crosshair, so bars can be read
    // by sliding along them rather than tapping each one.
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.scrubbing = true;
      this.touchPanX = null;
      this.setCrosshair(x, y, rect.width);
    }, LONG_PRESS_MS);
  }

  protected onTouchMove(event: TouchEvent): void {
    if (event.touches.length >= 2 && this.pinchSpan != null) {
      this.pinchSpan = this.applyPinch(this.pinchSpan, touchSpan(event.touches[0]!, event.touches[1]!));
      this.preventIfCancelable(event);
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;

    if (this.axisDragY != null) {
      this.dragPriceScale(touch.clientY - this.axisDragY);
      this.axisDragY = touch.clientY;
      this.preventIfCancelable(event);
      return;
    }

    if (this.scrubbing) {
      const canvas = this.canvasRef?.nativeElement;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      this.setCrosshair(touch.clientX - rect.left, touch.clientY - rect.top, rect.width);
      this.preventIfCancelable(event);
      return;
    }

    if (this.touchPanX == null) return;
    const dx = touch.clientX - this.touchPanX;
    if (Math.abs(dx) < 0.5) return;
    if (Math.abs(dx) > TAP_SLOP_PX) {
      // Moving means this was a pan, not a press being held.
      this.endLongPress();
    }
    this.touchPanX = touch.clientX;
    this.tapStart = null;
    this.applyPan(-dx / this.slotW);
    // touch-action is pan-y, so a vertical swipe still scrolls the page and
    // this only claims the horizontal drag.
    this.preventIfCancelable(event);
  }

  /**
   * Two fingers drive whichever axis they are separating along: spreading them
   * sideways shows fewer bars, spreading them vertically stretches the price.
   */
  private applyPinch(from: TouchSpan, to: TouchSpan): TouchSpan {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (dy > dx && from.y > 0 && to.y > 0) {
      this.applyPriceZoom(to.y / from.y);
      return to;
    }
    if (from.x > 0 && to.x > 0) {
      this.applyZoom(from.x / to.x, this.pinchAnchor);
      return to;
    }
    return from;
  }

  protected onTouchEnd(): void {
    const tap = this.tapStart;
    const canvas = this.canvasRef?.nativeElement;
    const wasScrubbing = this.scrubbing;
    this.endLongPress();
    // In crosshair mode the reading stands until the next touch, rather than
    // vanishing the moment the finger lifts.
    this.scrubbing = false;
    this.pinchSpan = null;
    this.touchPanX = null;
    this.axisDragY = null;
    this.tapStart = null;
    // A still, brief touch is someone asking what that bar was. A scrub already
    // left the crosshair where they wanted it, so leave it standing.
    if (!wasScrubbing && tap && canvas && Date.now() - tap.at <= TAP_MS) {
      this.setCrosshair(tap.x, tap.y, canvas.getBoundingClientRect().width);
    }
  }

  protected onGripTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;
    this.axisDragY = touch.clientY;
    this.preventIfCancelable(event);
  }

  protected onGripTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch || this.axisDragY == null) return;
    this.dragPriceScale(touch.clientY - this.axisDragY);
    this.axisDragY = touch.clientY;
    this.preventIfCancelable(event);
  }

  protected onGripTouchEnd(): void {
    this.axisDragY = null;
  }

  protected toggleExpanded(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    // The canvas sizes itself from the wrapper, which the class resizes, so a
    // paint has to wait for the new layout to settle.
    this.lockPageScroll(next);
    setTimeout(() => this.scheduleDraw(), 0);
  }

  protected toggleCrosshairMode(): void {
    const next = !this.crosshairMode();
    this.crosshairMode.set(next);
    if (!next) {
      this.clearCrosshair();
    }
  }

  /** Escape leaves expanded mode, which is what every fullscreen view does. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.expanded()) {
      this.toggleExpanded();
    }
  }

  /** Stop the page behind an expanded chart from scrolling under it. */
  private lockPageScroll(lock: boolean): void {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = lock ? 'hidden' : '';
  }

  protected resetPriceScale(): void {
    if (this.priceZoom === 1) return;
    this.priceZoom = 1;
    this.priceStretched.set(false);
    this.scheduleDraw();
  }

  private endLongPress(): void {
    if (this.longPressTimer != null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  protected onPointerLeave(): void {
    this.mouseDragX = null;
    this.axisDragY = null;
    this.clearCrosshair();
  }

  private clearCrosshair(): void {
    this.crosshairIndex = null;
    this.crosshairY = null;
    this.hover.set(null);
    this.scheduleDraw();
  }

  /** Where a pixel sits across the plot, 0 at the left edge and 1 at the right. */
  private anchorAt(x: number, cssW: number): number {
    const plotW = cssW - PAD.left - PAD.right;
    if (plotW <= 0) return 0.5;
    return Math.min(1, Math.max(0, (x - PAD.left) / plotW));
  }

  private preventIfCancelable(event: TouchEvent): void {
    // Once the browser owns the gesture for scrolling the event is no longer
    // cancelable, and calling preventDefault only logs a warning.
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  private setCrosshair(x: number, y: number, cssW: number): void {
    const bars = this.candles;
    if (!bars.length) return;
    const plotW = cssW - PAD.left - PAD.right;
    if (plotW <= 0) return;
    const view = this.view ?? defaultViewport(bars.length, plotW);
    // Round, not floor: bars are drawn centred in their slot, so flooring
    // reads the bar behind the pointer for the left half of every slot, which
    // is what makes the crosshair feel like it is lagging a candle behind.
    const i = Math.round(view.start + ((x - PAD.left) / plotW) * view.count - 0.5);
    this.crosshairIndex = i >= 0 && i < bars.length ? i : null;
    this.crosshairY = y;

    const bar = this.crosshairIndex != null ? bars[this.crosshairIndex] : null;
    this.hover.set(
      bar
        ? {
            date: bar.date,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            changePct: bar.open !== 0 ? ((bar.close - bar.open) / bar.open) * 100 : null,
            notes: smcNoteAt(this.smc, this.crosshairIndex!),
          }
        : null,
    );
    this.scheduleDraw();
  }

  /** Coalesce resize / hover / input redraws into one frame. */
  private scheduleDraw(): void {
    if (typeof requestAnimationFrame === 'undefined') {
      this.draw();
      return;
    }
    if (this.frame != null) {
      cancelAnimationFrame(this.frame);
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  protected trendText(trend: string): string {
    return trend === 'sideways' ? 'SIDEWAYS' : trend.toUpperCase();
  }

  protected fmt(value: number | null | undefined, decimals = this.decimals): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  private draw(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const cssW = Math.max(280, parent?.clientWidth || 640);
    // CSS owns the height so it can be taller on a phone; the input is the
    // fallback for server-side rendering, where the wrapper measures zero.
    const cssH = Math.max(200, parent?.clientHeight || this.height);
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const bars = this.candles;
    if (!bars.length) {
      this.publishViewState(null, 0);
      ctx.fillStyle = COLORS.axisText;
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.fillText(this.emptyMessage, cssW / 2, cssH / 2);
      ctx.textAlign = 'left';
      return;
    }

    const plotW = cssW - PAD.left - PAD.right;
    const plotH = cssH - PAD.top - PAD.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    // Sizing the opening window needs the plot width, so it waits for a paint.
    const view = clampViewport(this.view ?? defaultViewport(bars.length, plotW), bars.length);
    this.view = view;
    this.plotW = plotW;
    const { first, last } = visibleRange(view, bars.length);
    const windowBars = bars.slice(first, last + 1);
    this.publishViewState(view, bars.length);

    // The scale follows the window, so zooming in opens the price action up
    // rather than keeping it squashed against the full range.
    const { min, max } = this.priceRange(windowBars, first, last);
    const span = max - min || 1;
    const yOf = (price: number) => PAD.top + ((max - price) / span) * plotH;
    const slotW = plotW / view.count;
    this.slotW = slotW;
    const xOf = (index: number) => PAD.left + (index - view.start + 0.5) * slotW;

    const ticks = niceTicks(min, max, Math.max(3, Math.floor(plotH / 52)));
    // Whole-number gridlines read better without decimals, as TV does. Levels
    // follow the axis; only the live price keeps full instrument precision.
    const axisDecimals = ticks.every((t) => Math.abs(t - Math.round(t)) < 1e-9)
      ? 0
      : this.decimals;

    // Axis pills are laid out before anything is painted so a level label can
    // never sit on top of the last-price label.
    const tags = this.layoutAxisTags(bars, yOf, plotH, first, last);

    this.drawGrid(ctx, plotW, plotH, ticks, yOf, axisDecimals, tags);

    // Everything price-scaled is clipped to the plot: the scale fits the
    // candles, so a level may legitimately fall off the edge and must not
    // paint over the axes.
    const frame = this.smc
      ? {
          ctx,
          bars,
          smc: this.smc,
          layers: this.layers,
          xOf,
          yOf,
          slotW,
          first,
          last,
          left: PAD.left,
          right: PAD.left + plotW,
          top: PAD.top,
          bottom: PAD.top + plotH,
        }
      : null;
    if (frame) paintSmcUnder(frame);
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, PAD.top, plotW, plotH);
    ctx.clip();
    this.drawCandles(ctx, bars, xOf, yOf, slotW, first, last);
    this.drawLastPriceLine(ctx, bars, plotW, yOf);
    ctx.restore();
    if (frame) paintSmcOver(frame);

    for (const tag of tags) {
      this.axisTag(ctx, tag.y, cssW, tag.text, tag.bg, tag.ink);
    }
    this.drawTimeAxis(ctx, bars, xOf, cssH, plotW, slotW, first, last);
    this.drawCrosshair(ctx, bars, xOf, yOf, plotW, plotH, cssW, min, max);

    // Axis frame last so nothing paints over it.
    ctx.strokeStyle = COLORS.axisLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left + plotW + 0.5, PAD.top);
    ctx.lineTo(PAD.left + plotW + 0.5, PAD.top + plotH);
    ctx.moveTo(PAD.left, PAD.top + plotH + 0.5);
    ctx.lineTo(PAD.left + plotW, PAD.top + plotH + 0.5);
    ctx.stroke();
  }

  /** Mirror the window into the toolbar's readout and button states. */
  private publishViewState(view: Viewport | null, total: number): void {
    this.totalCount.set(total);
    if (!view || !total) {
      this.visibleCount.set(0);
      this.canZoomIn.set(false);
      this.canZoomOut.set(false);
      this.atLiveEdge.set(true);
      this.canScrollRight.set(false);
      return;
    }
    const shown = Math.min(total, Math.round(view.count));
    this.visibleCount.set(shown);
    this.canZoomIn.set(zoomViewport(view, total, 1 / BUTTON_ZOOM, 0.5).count < view.count);
    this.canZoomOut.set(shown < total);
    this.atLiveEdge.set(isAtRightEdge(view, total));
    this.canScrollRight.set(canExpandRight(view, total));
  }

  /**
   * Fit the scale to the visible candles and pad so nothing touches the frame.
   *
   * Only a live trade's entry and stop widen the scale. Zones and targets are
   * deliberately excluded: a level 6 ATR away would otherwise zoom the panel
   * out and flatten the price action. They clip instead, which is what
   * TradingView does with a drawing off the visible scale.
   */
  private priceRange(bars: Candle[], first: number, last: number): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const b of bars) {
      if (b.low < min) min = b.low;
      if (b.high > max) max = b.high;
    }
    if (this.smc && this.layers.levels) {
      for (const t of focusTrades(this.smc)) {
        const end = t.status === 'open' ? Infinity : (t.exitIndex ?? Infinity);
        if (end >= first && t.entryIndex <= last) {
          min = Math.min(min, t.sl, t.entryPrice);
          max = Math.max(max, t.sl, t.entryPrice);
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 1 };
    }
    const pad = (max - min) * 0.06 || Math.abs(max) * 0.001 || 1;
    const lo = min - pad;
    const hi = max + pad;
    // The newest close is what someone stretching the scale wants a closer
    // look at, so it is what the stretch holds still.
    const focus = bars[bars.length - 1]?.close ?? (lo + hi) / 2;
    return stretchPriceRange(lo, hi, focus, this.priceZoom);
  }

  /**
   * Price-axis pills: the live price always wins, then the working trade's
   * levels, and anything that would collide is dropped rather than drawn over.
   */
  private layoutAxisTags(
    bars: Candle[],
    yOf: (p: number) => number,
    plotH: number,
    first: number,
    last: number,
  ): AxisTag[] {
    const lastBar = bars[bars.length - 1]!;
    const up = this.changeUp ?? lastBar.close >= lastBar.open;
    const lastY = yOf(lastBar.close);
    const tags: AxisTag[] = [];
    // Panning back can put the live price off the window's scale, and a pill
    // pinned to the frame edge would be a lie about where that price sits.
    if (lastY >= PAD.top && lastY <= PAD.top + plotH) {
      tags.push({
        y: lastY,
        text: this.fmt(lastBar.close),
        bg: up ? COLORS.lastUp : COLORS.lastDown,
        ink: '#ffffff',
      });
    }

    const trade = this.smc && this.layers.levels ? focusTrades(this.smc).at(-1) : undefined;
    if (trade) {
      const end = trade.status === 'open' ? Infinity : (trade.exitIndex ?? Infinity);
      if (end >= first && trade.entryIndex <= last) {
        this.pushAxisTag(tags, yOf(trade.entryPrice), plotH, 'ENTRY', COLORS.entryBg, '#ffffff');
        this.pushAxisTag(tags, yOf(trade.slNow), plotH, 'SL', COLORS.slBg, '#ffffff');
        this.pushAxisTag(tags, yOf(trade.tpFinal), plotH, 'FINAL TP', COLORS.tpBg, '#ffffff');
        this.pushAxisTag(tags, yOf(trade.tp2), plotH, 'TP2', COLORS.tpBg, '#ffffff');
        this.pushAxisTag(tags, yOf(trade.tp1), plotH, 'TP1', COLORS.tpBg, '#ffffff');
      }
    }
    return tags;
  }

  private pushAxisTag(
    tags: AxisTag[],
    y: number,
    plotH: number,
    text: string,
    bg: string,
    ink: string,
  ): void {
    if (y < PAD.top || y > PAD.top + plotH) return;
    if (tags.some((t) => Math.abs(t.y - y) < TAG_H + 1)) return;
    tags.push({ y, text, bg, ink });
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    plotW: number,
    plotH: number,
    ticks: number[],
    yOf: (p: number) => number,
    axisDecimals: number,
    tags: AxisTag[],
  ): void {
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (const price of ticks) {
      const y = yOf(price);
      if (y < PAD.top - 1 || y > PAD.top + plotH + 1) continue;
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, Math.round(y) + 0.5);
      ctx.lineTo(PAD.left + plotW, Math.round(y) + 0.5);
      ctx.stroke();

      // A pill at this height owns the axis slot; skip the gridline number.
      if (tags.some((t) => Math.abs(t.y - y) < TAG_H)) continue;

      ctx.fillStyle = COLORS.axisText;
      ctx.textAlign = 'left';
      ctx.fillText(this.fmt(price, axisDecimals), PAD.left + plotW + 6, y);
    }
    ctx.textBaseline = 'alphabetic';
  }

  private drawCandles(
    ctx: CanvasRenderingContext2D,
    bars: Candle[],
    xOf: (i: number) => number,
    yOf: (p: number) => number,
    slotW: number,
    first: number,
    last: number,
  ): void {
    const bodyW = Math.max(1, Math.min(14, slotW * 0.68));
    for (let i = first; i <= last; i += 1) {
      const b = bars[i]!;
      const up = b.close >= b.open;
      const color = up ? COLORS.bull : COLORS.bear;
      const x = xOf(i);

      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, Math.min(1.6, bodyW * 0.18));
      ctx.beginPath();
      ctx.moveTo(x, yOf(b.high));
      ctx.lineTo(x, yOf(b.low));
      ctx.stroke();

      const top = yOf(Math.max(b.open, b.close));
      const bot = yOf(Math.min(b.open, b.close));
      ctx.fillStyle = color;
      // A doji still needs a visible mark.
      ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, bot - top));
    }
  }

  private drawLastPriceLine(
    ctx: CanvasRenderingContext2D,
    bars: Candle[],
    plotW: number,
    yOf: (p: number) => number,
  ): void {
    const last = bars[bars.length - 1]!;
    const y = yOf(last.close);
    const up = this.changeUp ?? last.close >= last.open;

    ctx.strokeStyle = up ? COLORS.lastUp : COLORS.lastDown;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, Math.round(y) + 0.5);
    ctx.lineTo(PAD.left + plotW, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private axisTag(
    ctx: CanvasRenderingContext2D,
    y: number,
    cssW: number,
    text: string,
    bg: string,
    ink: string,
  ): void {
    const h = TAG_H;
    const x = cssW - PAD.right + 2;
    const w = PAD.right - 4;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y - h / 2, w, h);
    ctx.fillStyle = ink;
    ctx.font = FONT_BOLD;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 4, y);
    ctx.textBaseline = 'alphabetic';
  }

  private drawTimeAxis(
    ctx: CanvasRenderingContext2D,
    bars: Candle[],
    xOf: (i: number) => number,
    cssH: number,
    plotW: number,
    slotW: number,
    first: number,
    last: number,
  ): void {
    ctx.fillStyle = COLORS.axisText;
    ctx.font = FONT;
    ctx.textAlign = 'center';
    const minGap = 52;
    // Label density follows the zoom: wider slots can carry more labels.
    const step = Math.max(1, Math.ceil(minGap / Math.max(1, slotW)));
    let lastDay = '';
    // Anchor the stride to the window so labels do not jitter while panning.
    const start = Math.ceil(first / step) * step;
    for (let i = start; i <= last; i += step) {
      const b = bars[i]!;
      const day = String(b.date).slice(0, 10);
      // Print the date on the first bar of a session, the clock otherwise.
      const label = day !== lastDay ? formatDayLabel(b.date) : String(b.date).slice(11, 16);
      lastDay = day;
      const x = xOf(i);
      if (x < PAD.left || x > PAD.left + plotW) continue;
      // The first and last bars sit close to the frame, so a centred label
      // would hang off the edge and lose a character. Nudge it inside.
      const half = ctx.measureText(label).width / 2;
      const clamped = Math.min(
        Math.max(x, PAD.left + half),
        PAD.left + plotW - half,
      );
      ctx.fillText(label, clamped, cssH - 8);
    }
    ctx.textAlign = 'left';
  }

  private drawCrosshair(
    ctx: CanvasRenderingContext2D,
    bars: Candle[],
    xOf: (i: number) => number,
    yOf: (p: number) => number,
    plotW: number,
    plotH: number,
    cssW: number,
    min: number,
    max: number,
  ): void {
    const i = this.crosshairIndex;
    if (i == null || i < 0 || i >= bars.length) return;
    const x = xOf(i);
    const y = this.crosshairY;

    ctx.strokeStyle = COLORS.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, PAD.top);
    ctx.lineTo(Math.round(x) + 0.5, PAD.top + plotH);
    if (y != null && y >= PAD.top && y <= PAD.top + plotH) {
      ctx.moveTo(PAD.left, Math.round(y) + 0.5);
      ctx.lineTo(PAD.left + plotW, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (y != null && y >= PAD.top && y <= PAD.top + plotH) {
      const price = max - ((y - PAD.top) / plotH) * (max - min);
      this.axisTag(ctx, y, cssW, this.fmt(price), '#131722', '#ffffff');
    }

    // Time pill under the hovered bar.
    const label = String(bars[i]!.date).slice(11, 16);
    ctx.font = FONT_BOLD;
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = '#131722';
    ctx.fillRect(x - w / 2, PAD.top + plotH + 2, w, 15);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, PAD.top + plotH + 9.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

/** Human gridline values (1/2/5 × 10ⁿ) covering [min, max]. */
export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) {
    return [min];
  }
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const stepMult = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  const step = stepMult * mag;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-9; v += step) {
    // Re-round each step: repeated addition drifts on values like 0.05.
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

/** How far apart two fingers are along each axis, tracked separately so a
 * vertical pinch can drive the price scale and a horizontal one the time scale. */
interface TouchSpan {
  x: number;
  y: number;
}

function touchSpan(a: Touch, b: Touch): TouchSpan {
  return { x: Math.abs(a.clientX - b.clientX), y: Math.abs(a.clientY - b.clientY) };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function overlaps(
  a: { x0: number; x1: number; y0: number; y1: number },
  b: { x0: number; x1: number; y0: number; y1: number },
): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function formatDayLabel(date: string): string {
  const day = String(date).slice(8, 10);
  const month = Number(String(date).slice(5, 7));
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = names[Math.max(0, Math.min(11, month - 1))];
  return `${day} ${name}`;
}

/**
 * TradingView-style candlestick panel: candles, S/R zone boxes, pivot
 * connection lines, a right-hand price axis with level tags, and a crosshair
 * with an OHLC legend.
 *
 * Only a window of the series is drawn at a time — see chart-viewport.util —
 * so candles stay readable on a phone and can be zoomed and panned.
 *
 * Canvas 2D and no charting dependency, matching sr-structure-chart.component
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
import { SrChartModel, SrZone } from '../../../core/charts/sr-chart.util';
import { SrConfidenceBand, SrSignal } from '../../../core/charts/sr-signals.util';
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
  supportFill: 'rgba(38, 166, 154, 0.20)',
  supportEdge: 'rgba(38, 166, 154, 0.75)',
  supportTagBg: 'rgba(38, 166, 154, 0.85)',
  supportInk: '#ffffff',
  resistanceFill: 'rgba(239, 83, 80, 0.20)',
  resistanceEdge: 'rgba(239, 83, 80, 0.75)',
  resistanceTagBg: 'rgba(239, 83, 80, 0.85)',
  resistanceInk: '#ffffff',
  legendInk: '#131722',
  // Deeper than the candle bodies so an arrow never reads as another wick.
  signalBuy: '#00897b',
  signalSell: '#d32f2f',
  /** Laid under a marker caption so it stays readable over the candles. */
  signalHalo: 'rgba(255, 255, 255, 0.86)',
} as const;

const FONT = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';
const FONT_BOLD = '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
const FONT_ZONE = '600 9px ui-sans-serif, system-ui, -apple-system, sans-serif';
const FONT_SIGNAL = '600 9px ui-sans-serif, system-ui, -apple-system, sans-serif';
const FONT_SIGNAL_H = 9;
/** Marker geometry, and the clearance it keeps from the wick it belongs to. */
const SIGNAL_W = 9;
const SIGNAL_H = 8;
const SIGNAL_GAP = 7;
/**
 * A weak marker is drawn faint so the eye lands on the strong ones first.
 * Never fully transparent: the arrow still has to be findable once seen.
 */
const SIGNAL_ALPHA: Record<SrConfidenceBand, number> = {
  high: 1,
  medium: 0.72,
  low: 0.45,
};
/** Thin levels still need a band with presence. */
const MIN_ZONE_H = 6;
/** Below this the label would not fit inside the band. */
const ZONE_LABEL_MIN_H = 15;

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

/** Screen rectangle a caption occupies, for collision tests. */
interface LabelBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface TvCrosshairBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  changePct: number | null;
  /** Signal that fired on this bar, so the legend can explain its score. */
  signal: SrSignal | null;
}

@Component({
  selector: 'app-tv-candle-chart',
  standalone: true,
  templateUrl: './tv-candle-chart.component.html',
  styleUrl: './tv-candle-chart.component.css',
})
export class TvCandleChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() candles: Candle[] = [];
  @Input() model: SrChartModel | null = null;
  @Input() decimals = 2;
  /** Fallback only; the wrapper's CSS height wins so it can be responsive. */
  @Input() height = 340;
  @Input() emptyMessage = 'No candles yet.';
  /** Chart annotations, not orders — see sr-signals.util for what they mean. */
  @Input() signals: SrSignal[] = [];
  /**
   * Changing this throws the zoom away and refits. The parent passes the
   * interval, because 30 bars of 15m and 30 bars of 1m are not the same view.
   */
  @Input() resetKey = '';
  /** Full-view ATM buttons — CE is Buy, PE is Sell of the index. */
  @Input() canOrder = false;
  @Input() orderLots = 1;
  @Input() ordering: AtmOptionSide | null = null;
  @Input() orderHint = '';
  @Input() orderResult: { ok: boolean; text: string } | null = null;
  readonly buyAtm = output<AtmOptionSide>();

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
  /** Zone caption boxes from the current paint, for signal labels to dodge. */
  private zoneLabelBoxes: LabelBox[] = [];
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
            signal: this.signals.find((s) => s.index === this.crosshairIndex) ?? null,
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

  protected fmt(value: number | null | undefined, decimals = this.decimals): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  /** The one thing that earned this signal most of its score. */
  protected topFactor(signal: SrSignal): string {
    return signal.factors[0]?.label ?? '';
  }

  /** Full breakdown on hover, so the percentage is never just asserted. */
  protected factorTooltip(signal: SrSignal): string {
    const lines = signal.factors.map(
      (f) => `${f.label}: ${Math.round(f.score * 100)}% (weight ${Math.round(f.weight * 100)}%)`,
    );
    return [
      `${signal.side} ${signal.label} — ${signal.confidence}% setup quality`,
      ...lines,
      'Scores how textbook the setup looks. Not a win rate.',
    ].join('\n');
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

    const zones = this.model?.zones ?? [];
    // The scale follows the window, so zooming in opens the price action up
    // rather than keeping it squashed against the full range.
    const { min, max } = this.priceRange(windowBars);
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
    const tags = this.layoutAxisTags(bars, zones, yOf, axisDecimals, plotH);

    this.drawGrid(ctx, plotW, plotH, ticks, yOf, axisDecimals, tags);

    // Everything price-scaled is clipped to the plot: the scale fits the
    // candles, so a zone or pivot line may legitimately fall off the edge and
    // must not paint over the axes.
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, PAD.top, plotW, plotH);
    ctx.clip();
    this.drawZones(ctx, zones, xOf, yOf, plotW, slotW);
    this.drawLinks(ctx, xOf, yOf);
    this.drawCandles(ctx, bars, xOf, yOf, slotW, first, last);
    this.drawZoneLabels(ctx, zones, xOf, yOf, plotW, slotW);
    this.drawSignals(ctx, xOf, yOf, first, last, plotH);
    this.drawLastPriceLine(ctx, bars, plotW, yOf);
    ctx.restore();

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

  /**
   * Buy / sell markers: a filled arrow just outside the bar it fired on,
   * pointing the way the signal reads, with the pattern name beside it.
   *
   * Drawn after the candles so a marker is never buried by a body, and only for
   * bars in the window so panning does not cost anything.
   */
  private drawSignals(
    ctx: CanvasRenderingContext2D,
    xOf: (i: number) => number,
    yOf: (p: number) => number,
    first: number,
    last: number,
    plotH: number,
  ): void {
    const signals = this.signals;
    if (!signals.length) return;

    ctx.font = FONT_SIGNAL;
    ctx.textAlign = 'center';
    const placed = [...this.zoneLabelBoxes];

    for (const signal of signals) {
      if (signal.index < first || signal.index > last) continue;
      const buy = signal.side === 'BUY';
      const x = xOf(signal.index);
      const at = yOf(signal.price);
      // Sit clear of the wick, and flip inside the frame near an edge so a
      // marker on a bar at the top or bottom of the scale is still readable.
      const outward = buy ? SIGNAL_GAP : -SIGNAL_GAP;
      let tipY = at + outward;
      if (tipY > PAD.top + plotH - SIGNAL_H || tipY < PAD.top + SIGNAL_H) {
        tipY = at - outward;
      }
      const pointsDown = tipY < at;

      const labelY = pointsDown ? tipY - SIGNAL_H - 3 : tipY + SIGNAL_H + 3;
      // Pattern name first, but the score is the part worth keeping: when the
      // full caption will not fit, shed the word rather than the percentage.
      // The name is still one hover away in the legend.
      const fitted = this.fitSignalLabel(
        ctx,
        [
          `${signal.side} ${signal.label} ${signal.confidence}%`,
          `${signal.side} ${signal.confidence}%`,
          `${signal.confidence}%`,
        ],
        x,
        tipY,
        labelY,
        placed,
      );
      if (fitted) placed.push(fitted.box);

      const fill = buy ? COLORS.signalBuy : COLORS.signalSell;
      ctx.globalAlpha = SIGNAL_ALPHA[signal.confidenceBand];
      this.signalArrow(ctx, x, tipY, pointsDown, fill);

      if (fitted) {
        ctx.textBaseline = pointsDown ? 'bottom' : 'top';
        // A caption often lands on top of the candles it describes, and 9px
        // text over a wick is unreadable. Lay the chart background under it.
        const w = ctx.measureText(fitted.text).width;
        ctx.fillStyle = COLORS.signalHalo;
        ctx.fillRect(
          fitted.x - w / 2 - 2,
          (pointsDown ? labelY - FONT_SIGNAL_H : labelY) - 1,
          w + 4,
          FONT_SIGNAL_H + 2,
        );
        ctx.fillStyle = fill;
        ctx.fillText(fitted.text, fitted.x, labelY);
      }
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * First caption from `candidates` that clears everything already drawn.
   *
   * Two markers a bar apart would otherwise print on top of each other when
   * zoomed out. Null means even the shortest form collided, and only the arrow
   * is drawn — a smudge of overlapping text reads worse than no text.
   */
  private fitSignalLabel(
    ctx: CanvasRenderingContext2D,
    candidates: string[],
    x: number,
    tipY: number,
    labelY: number,
    placed: LabelBox[],
  ): { text: string; x: number; box: LabelBox } | null {
    for (const text of candidates) {
      const w = ctx.measureText(text).width;
      // A marker on one of the first or last visible bars would otherwise have
      // its caption sliced off by the frame.
      const cx = clampNumber(x, PAD.left + w / 2 + 2, PAD.left + this.plotW - w / 2 - 2);
      const box = {
        x0: cx - Math.max(w, SIGNAL_W) / 2 - 2,
        x1: cx + Math.max(w, SIGNAL_W) / 2 + 2,
        y0: Math.min(tipY, labelY) - FONT_SIGNAL_H,
        y1: Math.max(tipY, labelY) + FONT_SIGNAL_H,
      };
      if (!placed.some((p) => overlaps(p, box))) {
        return { text, x: cx, box };
      }
    }
    return null;
  }

  private signalArrow(
    ctx: CanvasRenderingContext2D,
    x: number,
    tipY: number,
    pointsDown: boolean,
    fill: string,
  ): void {
    const dir = pointsDown ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x, tipY);
    ctx.lineTo(x - SIGNAL_W / 2, tipY - dir * SIGNAL_H);
    ctx.lineTo(x + SIGNAL_W / 2, tipY - dir * SIGNAL_H);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    // A hairline of background keeps the arrow off the wick it belongs to.
    ctx.strokeStyle = COLORS.bg;
    ctx.lineWidth = 1;
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
   * Zones are deliberately excluded: a level 6 ATR away would otherwise zoom
   * the panel out and flatten the price action. Out-of-range zones clip instead,
   * which is what TradingView does with a drawing off the visible scale.
   */
  private priceRange(bars: Candle[]): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const b of bars) {
      if (b.low < min) min = b.low;
      if (b.high > max) max = b.high;
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
   * Price-axis pills: the live price always wins, then S/R levels strongest
   * first, and anything that would collide is dropped rather than drawn over.
   */
  private layoutAxisTags(
    bars: Candle[],
    zones: SrZone[],
    yOf: (p: number) => number,
    axisDecimals: number,
    plotH: number,
  ): AxisTag[] {
    const last = bars[bars.length - 1]!;
    const up = this.model?.changeAbs == null ? last.close >= last.open : this.model.changeAbs >= 0;
    const lastY = yOf(last.close);
    const tags: AxisTag[] = [];
    // Panning back can put the live price off the window's scale, and a pill
    // pinned to the frame edge would be a lie about where that price sits.
    if (lastY >= PAD.top && lastY <= PAD.top + plotH) {
      tags.push({
        y: lastY,
        text: this.fmt(last.close),
        bg: up ? COLORS.lastUp : COLORS.lastDown,
        ink: '#ffffff',
      });
    }

    for (const zone of zones) {
      const y = yOf(zone.mid);
      // A zone clipped off the scale gets no axis label either.
      if (y < PAD.top || y > PAD.top + plotH) {
        continue;
      }
      if (tags.some((t) => Math.abs(t.y - y) < TAG_H + 1)) {
        continue;
      }
      const support = zone.kind === 'support';
      tags.push({
        y,
        text: this.fmt(zone.mid, axisDecimals),
        bg: support ? 'rgba(38, 166, 154, 0.16)' : 'rgba(239, 83, 80, 0.16)',
        ink: support ? '#0f766e' : '#b91c1c',
      });
    }
    return tags;
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

  private drawZones(
    ctx: CanvasRenderingContext2D,
    zones: SrZone[],
    xOf: (i: number) => number,
    yOf: (p: number) => number,
    plotW: number,
    slotW: number,
  ): void {
    for (const zone of zones) {
      const support = zone.kind === 'support';
      const x0 = Math.max(PAD.left, xOf(zone.fromIndex) - slotW / 2);
      // Bands run to the right edge so they carry through the empty margin,
      // which is what makes a level readable as something price may return to.
      const x1 = PAD.left + plotW;
      const yTop = yOf(zone.hi);
      const yBot = yOf(zone.lo);
      // A one-tick level still has to be a band you can see.
      const h = Math.max(MIN_ZONE_H, yBot - yTop);
      const top = yBot - yTop < MIN_ZONE_H ? (yTop + yBot) / 2 - MIN_ZONE_H / 2 : yTop;

      ctx.fillStyle = support ? COLORS.supportFill : COLORS.resistanceFill;
      ctx.fillRect(x0, top, Math.max(6, x1 - x0), h);

      // Edges only — a mid rule inside a thin band reads as clutter.
      ctx.strokeStyle = support ? COLORS.supportEdge : COLORS.resistanceEdge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(top) + 0.5);
      ctx.lineTo(x1, Math.round(top) + 0.5);
      ctx.moveTo(x0, Math.round(top + h) + 0.5);
      ctx.lineTo(x1, Math.round(top + h) + 0.5);
      ctx.stroke();

    }
  }

  /**
   * Labels go on after the candles. Drawn with the bands they were painted
   * over by any candle crossing the level, which chopped the text in half.
   */
  private drawZoneLabels(
    ctx: CanvasRenderingContext2D,
    zones: SrZone[],
    xOf: (i: number) => number,
    yOf: (p: number) => number,
    plotW: number,
    slotW: number,
  ): void {
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const zone of zones) {
      const x0 = Math.max(PAD.left, xOf(zone.fromIndex) - slotW / 2);
      const x1 = PAD.left + plotW;
      const yTop = yOf(zone.hi);
      const yBot = yOf(zone.lo);
      const h = Math.max(MIN_ZONE_H, yBot - yTop);
      const top = yBot - yTop < MIN_ZONE_H ? (yTop + yBot) / 2 - MIN_ZONE_H / 2 : yTop;
      this.zoneLabel(ctx, zone.kind === 'support', x0, top, h, x1, placed);
    }
    // Signal captions are drawn next and must dodge these, or a "BUY Bounce"
    // lands on the SUPPORT tag of the very band that produced it.
    this.zoneLabelBoxes = placed;
  }

  /**
   * Name the band, as TradingView's zone indicators do — but only when it
   * fits and would not land on a label already drawn. Two nearby levels were
   * otherwise printing one on top of the other and both became unreadable.
   */
  private zoneLabel(
    ctx: CanvasRenderingContext2D,
    support: boolean,
    x0: number,
    top: number,
    h: number,
    x1: number,
    placed: { x0: number; x1: number; y0: number; y1: number }[],
  ): void {
    if (h < ZONE_LABEL_MIN_H) return;
    const text = support ? 'SUPPORT' : 'RESISTANCE';
    ctx.font = FONT_ZONE;
    const w = ctx.measureText(text).width + 8;
    const left = x0 + 2;
    if (x1 - left < w + 4) return;

    const box = { x0: left, x1: left + w, y0: top + h / 2 - 6.5, y1: top + h / 2 + 6.5 };
    if (placed.some((p) => overlaps(p, box))) return;
    placed.push(box);

    ctx.fillStyle = support ? COLORS.supportTagBg : COLORS.resistanceTagBg;
    ctx.fillRect(box.x0, box.y0, w, 13);
    ctx.fillStyle = support ? COLORS.supportInk : COLORS.resistanceInk;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, box.x0 + 4, top + h / 2);
    ctx.textBaseline = 'alphabetic';
  }

  private drawLinks(
    ctx: CanvasRenderingContext2D,
    xOf: (i: number) => number,
    yOf: (p: number) => number,
  ): void {
    const links = this.model?.links ?? [];
    // Structure lines are context, not the subject. Near-black at 1.3px read
    // as the main content and buried the candles and zones.
    ctx.strokeStyle = COLORS.link;
    ctx.lineWidth = 1;
    for (const link of links) {
      ctx.beginPath();
      ctx.moveTo(xOf(link.fromIndex), yOf(link.fromPrice));
      ctx.lineTo(xOf(link.toIndex), yOf(link.toPrice));
      ctx.stroke();
    }

    // Pivot handles, so it is obvious which bar anchored each line.
    const pivots = this.model?.pivots ?? [];
    for (const pivot of pivots) {
      ctx.fillStyle = COLORS.pivot;
      ctx.beginPath();
      ctx.arc(xOf(pivot.index), yOf(pivot.price), 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
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
    const up = this.model?.changeAbs == null ? last.close >= last.open : this.model.changeAbs >= 0;

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

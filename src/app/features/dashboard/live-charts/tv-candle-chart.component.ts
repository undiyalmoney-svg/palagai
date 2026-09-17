/**
 * TradingView-style candlestick panel: candles, S/R zone boxes, pivot
 * connection lines, a right-hand price axis with level tags, and a crosshair
 * with an OHLC legend.
 *
 * Canvas 2D and no charting dependency, matching sr-structure-chart.component
 * — the desk ships no chart library and one 176KB bundle budget is not worth a
 * second renderer.
 */
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { Candle } from '../../../core/models/candle.model';
import { SrChartModel, SrZone } from '../../../core/charts/sr-chart.util';

/** TradingView's default light palette, so the panel reads as a TV chart. */
const COLORS = {
  bg: '#ffffff',
  grid: '#f0f3fa',
  axisText: '#787b86',
  axisLine: '#e0e3eb',
  bull: '#26a69a',
  bear: '#ef5350',
  link: '#363a45',
  crosshair: '#9598a1',
  lastUp: '#26a69a',
  lastDown: '#ef5350',
  supportFill: 'rgba(38, 166, 154, 0.13)',
  supportEdge: 'rgba(38, 166, 154, 0.55)',
  resistanceFill: 'rgba(239, 83, 80, 0.13)',
  resistanceEdge: 'rgba(239, 83, 80, 0.55)',
  legendInk: '#131722',
} as const;

const FONT = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';
const FONT_BOLD = '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif';

const PAD = { top: 14, right: 68, bottom: 26, left: 8 } as const;
/** Bars of empty space kept at the right edge, like TV's scroll-ahead gap. */
const RIGHT_GAP_BARS = 2;
/** Axis pill height; also the minimum gap two axis labels may sit apart. */
const TAG_H = 15;

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
  @Input() height = 340;
  @Input() emptyMessage = 'No candles yet.';

  @ViewChild('canvas', { static: true }) canvasRef?: ElementRef<HTMLCanvasElement>;

  /** Hovered bar, mirrored into the HTML legend above the canvas. */
  protected readonly hover = signal<TvCrosshairBar | null>(null);

  private ro: ResizeObserver | null = null;
  private crosshairIndex: number | null = null;
  private crosshairY: number | null = null;
  private frame: number | null = null;

  ngAfterViewInit(): void {
    const parent = this.canvasRef?.nativeElement?.parentElement;
    if (parent && typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.scheduleDraw());
      this.ro.observe(parent);
    }
    this.scheduleDraw();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.scheduleDraw();
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    if (this.frame != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.frame);
    }
  }

  protected onPointerMove(event: MouseEvent): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.setCrosshair(event.clientX - rect.left, event.clientY - rect.top, rect.width);
  }

  protected onTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    const canvas = this.canvasRef?.nativeElement;
    if (!touch || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.setCrosshair(touch.clientX - rect.left, touch.clientY - rect.top, rect.width);
  }

  protected onPointerLeave(): void {
    this.crosshairIndex = null;
    this.crosshairY = null;
    this.hover.set(null);
    this.scheduleDraw();
  }

  private setCrosshair(x: number, y: number, cssW: number): void {
    const bars = this.candles;
    if (!bars.length) return;
    const plotW = cssW - PAD.left - PAD.right;
    if (plotW <= 0) return;
    const slots = bars.length + RIGHT_GAP_BARS;
    const i = Math.floor(((x - PAD.left) / plotW) * slots);
    const clamped = Math.max(0, Math.min(bars.length - 1, i));
    this.crosshairIndex = i >= 0 && i < bars.length ? clamped : null;
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

  private draw(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const cssW = Math.max(280, parent?.clientWidth || 640);
    const cssH = Math.max(200, this.height);
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

    const zones = this.model?.zones ?? [];
    const { min, max } = this.priceRange(bars);
    const span = max - min || 1;
    const yOf = (price: number) => PAD.top + ((max - price) / span) * plotH;
    const slots = bars.length + RIGHT_GAP_BARS;
    const slotW = plotW / slots;
    const xOf = (index: number) => PAD.left + (index + 0.5) * slotW;

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
    this.drawCandles(ctx, bars, xOf, yOf, slotW);
    this.drawLastPriceLine(ctx, bars, plotW, yOf);
    ctx.restore();

    for (const tag of tags) {
      this.axisTag(ctx, tag.y, cssW, tag.text, tag.bg, tag.ink);
    }
    this.drawTimeAxis(ctx, bars, xOf, cssH, plotW);
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
   * Fit the scale to the candles and pad so nothing touches the frame.
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
    return { min: min - pad, max: max + pad };
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
    const tags: AxisTag[] = [
      {
        y: yOf(last.close),
        text: this.fmt(last.close),
        bg: up ? COLORS.lastUp : COLORS.lastDown,
        ink: '#ffffff',
      },
    ];

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
      const x1 = PAD.left + plotW;
      const yTop = yOf(zone.hi);
      const yBot = yOf(zone.lo);
      const h = Math.max(2, yBot - yTop);

      ctx.fillStyle = support ? COLORS.supportFill : COLORS.resistanceFill;
      ctx.fillRect(x0, yTop, Math.max(6, x1 - x0), h);

      // Edges only — a mid rule inside a thin band reads as clutter.
      ctx.strokeStyle = support ? COLORS.supportEdge : COLORS.resistanceEdge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(yTop) + 0.5);
      ctx.lineTo(x1, Math.round(yTop) + 0.5);
      ctx.moveTo(x0, Math.round(yBot) + 0.5);
      ctx.lineTo(x1, Math.round(yBot) + 0.5);
      ctx.stroke();
    }
  }

  private drawLinks(
    ctx: CanvasRenderingContext2D,
    xOf: (i: number) => number,
    yOf: (p: number) => number,
  ): void {
    const links = this.model?.links ?? [];
    ctx.strokeStyle = COLORS.link;
    ctx.lineWidth = 1.3;
    for (const link of links) {
      ctx.beginPath();
      ctx.moveTo(xOf(link.fromIndex), yOf(link.fromPrice));
      ctx.lineTo(xOf(link.toIndex), yOf(link.toPrice));
      ctx.stroke();
    }

    // Pivot handles, so it is obvious which bar anchored each line.
    const pivots = this.model?.pivots ?? [];
    for (const pivot of pivots) {
      ctx.fillStyle = COLORS.link;
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
  ): void {
    const bodyW = Math.max(1, Math.min(14, slotW * 0.68));
    for (let i = 0; i < bars.length; i += 1) {
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
  ): void {
    ctx.fillStyle = COLORS.axisText;
    ctx.font = FONT;
    ctx.textAlign = 'center';
    const minGap = 52;
    const step = Math.max(1, Math.ceil(minGap / (plotW / (bars.length + RIGHT_GAP_BARS))));
    let lastDay = '';
    for (let i = 0; i < bars.length; i += step) {
      const b = bars[i]!;
      const day = String(b.date).slice(0, 10);
      // Print the date on the first bar of a session, the clock otherwise.
      const label = day !== lastDay ? formatDayLabel(b.date) : String(b.date).slice(11, 16);
      lastDay = day;
      const x = xOf(i);
      if (x < PAD.left || x > PAD.left + plotW) continue;
      ctx.fillText(label, x, cssH - 8);
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

function formatDayLabel(date: string): string {
  const day = String(date).slice(8, 10);
  const month = Number(String(date).slice(5, 7));
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = names[Math.max(0, Math.min(11, month - 1))];
  return `${day} ${name}`;
}

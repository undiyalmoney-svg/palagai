import { Component, Input } from '@angular/core';
import { MarketDeskCandle, MarketDeskOverlay } from '../../../core/market-desk/market-desk.models';

@Component({
  selector: 'app-desk-candle-chart',
  standalone: true,
  templateUrl: './desk-candle-chart.component.html',
  styleUrl: './desk-candle-chart.component.css',
})
export class DeskCandleChartComponent {
  @Input() candles: MarketDeskCandle[] = [];
  @Input() overlay: MarketDeskOverlay | null = null;
  @Input() emptyMessage = 'No candles yet.';

  protected hover: MarketDeskCandle | null = null;

  protected get view(): MarketDeskCandle[] {
    return this.candles.slice(-80);
  }

  protected barX(i: number): number {
    const n = Math.max(this.view.length, 1);
    return 8 + (i * (100 - 16)) / n;
  }

  protected barW(): number {
    return Math.max(0.4, (100 - 16) / Math.max(this.view.length, 1) - 0.15);
  }

  protected yOf(price: number): number {
    const { lo, hi } = this.range();
    if (hi === lo) return 28;
    return 52 - ((price - lo) / (hi - lo)) * 44;
  }

  protected volH(bar: MarketDeskCandle): number {
    const max = Math.max(...this.view.map((c) => c.volume || 0), 1);
    return ((bar.volume || 0) / max) * 10;
  }

  protected range(): { lo: number; hi: number } {
    const highs = this.view.map((c) => c.high);
    const lows = this.view.map((c) => c.low);
    const extras = [this.overlay?.emaFast, this.overlay?.emaSlow, this.overlay?.vwap, this.overlay?.support, this.overlay?.resistance].filter(
      (n): n is number => Number.isFinite(n),
    );
    const hi = Math.max(...highs, ...extras);
    const lo = Math.min(...lows, ...extras);
    const pad = (hi - lo) * 0.08 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }

  protected linePoints(kind: 'emaFast' | 'emaSlow'): string {
    const val = this.overlay?.[kind];
    if (!Number.isFinite(val)) return '';
    const y = this.yOf(val as number);
    return `M 8 ${y} L 92 ${y}`;
  }

  protected fmt(n: number | null | undefined, d = 2): string {
    if (!Number.isFinite(n)) return '—';
    return (n as number).toFixed(d);
  }

  protected bodyY(bar: MarketDeskCandle): number {
    return this.yOf(Math.max(bar.open, bar.close));
  }

  protected bodyH(bar: MarketDeskCandle): number {
    return Math.max(0.35, Math.abs(this.yOf(bar.open) - this.yOf(bar.close)));
  }
}

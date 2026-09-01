import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FADE_BACKTEST } from './fade-backtest-data';

/**
 * Fade Test — a dedicated tab to inspect and test the Exhaustion Fade strategy
 * in isolation. Shows the frozen backtest record (equity curve, stats, every
 * signal) and a clear Paper / Live status. READ-ONLY: displays results, never
 * places an order. Live is gated with the real prerequisites.
 */
type Mode = 'paper' | 'live';

@Component({
  selector: 'app-fade-test',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fade-test.component.html',
  styleUrl: './fade-test.component.css',
})
export class FadeTestComponent {
  readonly d = FADE_BACKTEST;
  readonly mode = signal<Mode>('paper');
  readonly showAllTrades = signal(false);

  readonly rr = computed(() => {
    const s = this.d.stats;
    return Math.abs(s.avgWin / s.avgLoss);
  });

  readonly years = computed(() =>
    Object.entries(this.d.byYear)
      .map(([year, net]) => ({ year, net: net as number }))
      .sort((a, b) => a.year.localeCompare(b.year)),
  );

  readonly maxYearMag = computed(() =>
    Math.max(1, ...this.years().map((y) => Math.abs(y.net))),
  );

  readonly recentTrades = computed(() => {
    const t = [...this.d.trades].reverse();
    return this.showAllTrades() ? t : t.slice(0, 12);
  });

  /** Equity curve as an SVG polyline path over a 0..1000 x 0..300 viewbox. */
  readonly curvePath = computed(() => {
    const c = this.d.curve;
    if (!c.length) return '';
    const eq = c.map((p) => p.equity);
    const min = Math.min(...eq, this.d.stats.startCapital);
    const max = Math.max(...eq);
    const span = max - min || 1;
    const W = 1000;
    const H = 300;
    return c
      .map((p, i) => {
        const x = (i / (c.length - 1)) * W;
        const y = H - ((p.equity - min) / span) * H;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  readonly curveArea = computed(() => {
    const p = this.curvePath();
    return p ? `${p} L1000,300 L0,300 Z` : '';
  });

  /** y for the starting-capital baseline in the same viewbox. */
  readonly baselineY = computed(() => {
    const c = this.d.curve;
    const eq = c.map((p) => p.equity);
    const min = Math.min(...eq, this.d.stats.startCapital);
    const max = Math.max(...eq);
    const span = max - min || 1;
    return 300 - ((this.d.stats.startCapital - min) / span) * 300;
  });

  setMode(m: Mode): void {
    this.mode.set(m);
  }

  fmt(n: number): string {
    const sign = n < 0 ? '-' : '';
    return `${sign}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
  }
}

import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface ChartSeries {
  name: string;
  color: string;
  values: Array<number | null>;
  dashed?: boolean;
  area?: boolean;
}

const W = 860;
const PAD_L = 62;
const PAD_R = 14;
const PAD_T = 12;
const PAD_B = 26;

/** Dependency-free SVG line chart with hover read-out. */
@Component({
  selector: 'mp-line-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="legend">
        @for (s of series(); track s.name) {
          <span class="lg"><i [style.background]="s.color"></i>{{ s.name }}</span>
        }
      </div>
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + height()"
        (mousemove)="onMove($event)"
        (mouseleave)="hover.set(null)"
        role="img"
        [attr.aria-label]="ariaLabel()"
      >
        @for (t of yTicks(); track t.y) {
          <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="t.y" [attr.y2]="t.y" class="grid" />
          <text [attr.x]="padL - 8" [attr.y]="t.y + 4" class="tick" text-anchor="end">{{ t.label }}</text>
        }
        @for (t of xTicks(); track t.x) {
          <text [attr.x]="t.x" [attr.y]="height() - 8" class="tick" [attr.text-anchor]="t.anchor">{{ t.label }}</text>
        }
        @for (p of paths(); track p.name) {
          @if (p.area) {
            <path [attr.d]="p.areaD" [attr.fill]="p.color" opacity="0.08" />
          }
          <path [attr.d]="p.d" fill="none" [attr.stroke]="p.color" stroke-width="2" [attr.stroke-dasharray]="p.dashed ? '5 4' : null" stroke-linejoin="round" />
        }
        @if (cursor(); as c) {
          <line [attr.x1]="c.x" [attr.x2]="c.x" [attr.y1]="padT" [attr.y2]="height() - padB" class="cursor" />
          @for (d of c.dots; track d.name) {
            <circle [attr.cx]="c.x" [attr.cy]="d.y" r="3.5" [attr.fill]="d.color" />
          }
        }
      </svg>
      @if (cursor(); as c) {
        <div class="tip">
          <strong>{{ c.label }}</strong>
          @for (d of c.dots; track d.name) {
            <span><i [style.background]="d.color"></i>{{ d.name }}: {{ d.text }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .wrap { position: relative; }
    svg { width: 100%; height: auto; display: block; }
    .grid { stroke: var(--pg-line); stroke-width: 1; }
    .tick { fill: var(--pg-muted); font-size: 11px; font-family: var(--pg-font); }
    .cursor { stroke: var(--pg-line-strong); stroke-dasharray: 3 3; }
    .legend { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.75rem; color: var(--pg-muted); margin-bottom: 0.3rem; }
    .lg i, .tip i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 0.35rem; }
    .tip { display: flex; gap: 0.9rem; flex-wrap: wrap; font-size: 0.76rem; padding: 0.35rem 0.6rem; margin-top: 0.2rem; background: var(--pg-bg-muted); border-radius: 8px; font-variant-numeric: tabular-nums; }
  `,
})
export class LineChartComponent {
  readonly series = input.required<ChartSeries[]>();
  readonly labels = input<string[]>([]);
  readonly height = input(260);
  readonly format = input<(v: number) => string>((v) => v.toFixed(0));
  readonly ariaLabel = input('Line chart');

  protected readonly W = W;
  protected readonly padL = PAD_L;
  protected readonly padR = PAD_R;
  protected readonly padT = PAD_T;
  protected readonly padB = PAD_B;
  protected readonly hover = signal<number | null>(null);

  private readonly range = computed(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of this.series()) {
      for (const v of s.values) {
        if (v == null || !Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo)) return { lo: 0, hi: 1 };
    if (lo === hi) return { lo: lo - 1, hi: hi + 1 };
    const pad = (hi - lo) * 0.06;
    return { lo: lo - pad, hi: hi + pad };
  });

  private y(v: number): number {
    const { lo, hi } = this.range();
    const h = this.height() - PAD_T - PAD_B;
    return PAD_T + (1 - (v - lo) / (hi - lo)) * h;
  }

  private x(i: number, n: number): number {
    return PAD_L + (n <= 1 ? 0 : i / (n - 1)) * (W - PAD_L - PAD_R);
  }

  protected readonly paths = computed(() =>
    this.series().map((s) => {
      const n = s.values.length;
      let d = '';
      let first = -1;
      let last = -1;
      s.values.forEach((v, i) => {
        if (v == null || !Number.isFinite(v)) return;
        d += `${d ? 'L' : 'M'}${this.x(i, n).toFixed(1)},${this.y(v).toFixed(1)}`;
        if (first < 0) first = i;
        last = i;
      });
      const base = this.height() - PAD_B;
      const areaD = first >= 0 ? `${d}L${this.x(last, n).toFixed(1)},${base}L${this.x(first, n).toFixed(1)},${base}Z` : '';
      return { name: s.name, color: s.color, dashed: !!s.dashed, area: !!s.area, d, areaD };
    }),
  );

  protected readonly yTicks = computed(() => {
    const { lo, hi } = this.range();
    const fmt = this.format();
    return Array.from({ length: 5 }, (_, i) => {
      const v = lo + ((hi - lo) * i) / 4;
      return { y: this.y(v), label: fmt(v) };
    });
  });

  protected readonly xTicks = computed(() => {
    const labels = this.labels();
    const n = labels.length;
    if (!n) return [];
    const idx = n < 5 ? labels.map((_, i) => i) : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1];
    return idx.map((i, k) => ({
      x: this.x(i, n),
      label: labels[i],
      anchor: k === 0 ? 'start' : k === idx.length - 1 ? 'end' : 'middle',
    }));
  });

  protected readonly cursor = computed(() => {
    const f = this.hover();
    if (f == null) return null;
    const labels = this.labels();
    const fmt = this.format();
    const dots: Array<{ name: string; color: string; y: number; text: string }> = [];
    for (const s of this.series()) {
      const n = s.values.length;
      const j = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
      const v = s.values[j];
      if (v == null || !Number.isFinite(v)) continue;
      dots.push({ name: s.name, color: s.color, y: this.y(v), text: fmt(v) });
    }
    const li = labels.length ? Math.max(0, Math.min(labels.length - 1, Math.round(f * (labels.length - 1)))) : 0;
    return { x: PAD_L + f * (W - PAD_L - PAD_R), label: labels[li] ?? '', dots };
  });

  protected onMove(ev: MouseEvent): void {
    const svg = ev.currentTarget as SVGElement;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    const f = (px - PAD_L) / (W - PAD_L - PAD_R);
    this.hover.set(f < 0 ? 0 : f > 1 ? 1 : f);
  }
}

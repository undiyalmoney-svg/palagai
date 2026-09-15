import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

export interface SrChartBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface SrStructureBox {
  wall: number;
  wallHi?: number;
  wallLo?: number;
  dir?: number;
  height?: number;
  adverseExtreme?: number;
  measuredMove?: number;
  pink?: { lo: number; hi: number; fromHm?: string | null; toHm?: string | null };
  teal?: { lo: number; hi: number; fromHm?: string | null; toHm?: string | null };
  entry?: { hm?: string | null; price?: number | null };
  exit?: { hm?: string | null; price?: number | null; reason?: string | null } | null;
}

@Component({
  selector: 'app-sr-structure-chart',
  standalone: true,
  templateUrl: './sr-structure-chart.component.html',
  styleUrl: './sr-structure-chart.component.css',
})
export class SrStructureChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() bars: SrChartBar[] = [];
  @Input() structure: SrStructureBox | null = null;
  @Input() title = '';
  @Input() subtitle = '';

  @ViewChild('canvas', { static: true }) canvasRef?: ElementRef<HTMLCanvasElement>;

  private ro: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    const el = this.canvasRef?.nativeElement?.parentElement;
    if (el && typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(el);
    }
    this.draw();
  }

  ngOnChanges(_c: SimpleChanges): void {
    this.draw();
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
  }

  private draw(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const cssW = Math.max(320, parent?.clientWidth || 640);
    const cssH = 280;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cssW, cssH);

    const bars = this.bars || [];
    if (!bars.length) {
      ctx.fillStyle = '#64748b';
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('No 5m index bars for this day.', 16, 24);
      return;
    }

    const padL = 58;
    const padR = 12;
    const padT = 12;
    const padB = 28;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    const box = this.structure;
    const lows = bars.map((b) => b.l);
    const highs = bars.map((b) => b.h);
    if (box?.pink) {
      lows.push(box.pink.lo);
      highs.push(box.pink.hi);
    }
    if (box?.teal) {
      lows.push(box.teal.lo);
      highs.push(box.teal.hi);
    }
    if (box?.wall) {
      lows.push(box.wall);
      highs.push(box.wall);
    }
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    const pad = (max - min) * 0.08 || 4;
    min -= pad;
    max += pad;
    const yOf = (px: number) => padT + ((max - px) / (max - min)) * plotH;
    const xOf = (i: number) => padL + ((i + 0.5) / bars.length) * plotW;
    const hmOf = (t: string) => String(t).slice(11, 16);
    const idxOfHm = (hm?: string | null) => {
      if (!hm) return -1;
      const want = String(hm).slice(0, 5);
      let best = -1;
      for (let i = 0; i < bars.length; i++) {
        if (hmOf(bars[i].t) >= want) {
          best = i;
          break;
        }
      }
      return best;
    };

    const fillBand = (
      lo: number,
      hi: number,
      fromHm: string | null | undefined,
      toHm: string | null | undefined,
      color: string,
    ) => {
      let i0 = idxOfHm(fromHm);
      let i1 = idxOfHm(toHm);
      if (i0 < 0) i0 = 0;
      if (i1 < 0) i1 = bars.length - 1;
      if (i1 < i0) [i0, i1] = [i1, i0];
      const x0 = padL + (i0 / bars.length) * plotW;
      const x1 = padL + ((i1 + 1) / bars.length) * plotW;
      const y0 = yOf(hi);
      const y1 = yOf(lo);
      ctx.fillStyle = color;
      ctx.fillRect(x0, y0, Math.max(4, x1 - x0), Math.max(2, y1 - y0));
    };

    if (box?.pink) {
      fillBand(box.pink.lo, box.pink.hi, box.pink.fromHm, box.pink.toHm, 'rgba(244, 114, 182, 0.28)');
    }
    if (box?.teal) {
      fillBand(box.teal.lo, box.teal.hi, box.teal.fromHm, box.teal.toHm, 'rgba(45, 212, 191, 0.28)');
    }

    if (box?.wall) {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(padL, yOf(box.wall));
      ctx.lineTo(padL + plotW, yOf(box.wall));
      ctx.stroke();
    }

    const candleW = Math.max(2, (plotW / bars.length) * 0.62);
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const x = xOf(i);
      const up = b.c >= b.o;
      ctx.strokeStyle = up ? '#15803d' : '#b91c1c';
      ctx.fillStyle = up ? '#15803d' : '#b91c1c';
      ctx.beginPath();
      ctx.moveTo(x, yOf(b.h));
      ctx.lineTo(x, yOf(b.l));
      ctx.stroke();
      const top = yOf(Math.max(b.o, b.c));
      const bot = yOf(Math.min(b.o, b.c));
      ctx.fillRect(x - candleW / 2, top, candleW, Math.max(1, bot - top));
    }

    const mark = (hm: string | null | undefined, price: number | null | undefined, color: string, label: string) => {
      const i = idxOfHm(hm);
      if (i < 0 || price == null || !Number.isFinite(price)) return;
      const x = xOf(i);
      const y = yOf(price);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(label, x + 6, y - 6);
    };
    if (box?.entry) mark(box.entry.hm, box.entry.price, '#2563eb', 'In');
    if (box?.exit) mark(box.exit.hm, box.exit.price, '#7c3aed', box.exit.reason || 'Out');

    ctx.fillStyle = '#64748b';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(max.toFixed(0), padL - 6, padT + 10);
    ctx.fillText(min.toFixed(0), padL - 6, padT + plotH);
    ctx.textAlign = 'left';
    ctx.fillText(hmOf(bars[0].t), padL, cssH - 8);
    ctx.textAlign = 'right';
    ctx.fillText(hmOf(bars[bars.length - 1].t), padL + plotW, cssH - 8);
    ctx.textAlign = 'left';
  }
}

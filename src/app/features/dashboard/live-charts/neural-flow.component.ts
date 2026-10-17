import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { BehaviourFlow } from '../../../core/market-desk/market-desk.models';

interface Wave {
  amp: number;
  freq: number;
  phase: number;
  y: number;
  width: number;
  tint: number;
}

interface Particle {
  wave: number;
  t: number;
  speed: number;
  size: number;
}

const MIX: Record<BehaviourFlow, { g: number; r: number; v: number; a: number }> = {
  bull: { g: 0.78, r: 0.08, v: 0.04, a: 0.9 },
  bear: { g: 0.08, r: 0.78, v: 0.04, a: 0.9 },
  side: { g: 0.28, r: 0.22, v: 0.08, a: 0.7 },
  fade: { g: 0.38, r: 0.28, v: 0.18, a: 0.55 },
  reversal: { g: 0.22, r: 0.22, v: 0.7, a: 0.85 },
  failed: { g: 0.18, r: 0.42, v: 0.12, a: 0.8 },
  wait: { g: 0.18, r: 0.12, v: 0.08, a: 0.45 },
};

@Component({
  selector: 'app-neural-flow',
  standalone: true,
  template: `<canvas #canvas class="neural-canvas" role="img" [attr.aria-label]="label()"></canvas>`,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .neural-canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class NeuralFlowComponent implements AfterViewInit, OnDestroy {
  readonly state = input<BehaviourFlow>('wait');
  readonly strength = input<string>('moderate');
  readonly label = input('Market flow visualization');
  readonly paused = input(false);

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly zone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private raf = 0;
  private resize: ResizeObserver | null = null;
  private waves: Wave[] = [];
  private particles: Particle[] = [];
  private mix = { ...MIX.wait };
  private target = { ...MIX.wait };
  private t = 0;
  private reduced = false;
  private compact = false;

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.layout(canvas);
    this.resize = new ResizeObserver(() => this.layout(canvas));
    this.resize.observe(canvas);
    this.zone.runOutsideAngular(() => this.loop(canvas));
  }

  ngOnDestroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resize?.disconnect();
  }

  private layout(canvas: HTMLCanvasElement): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.compact = w < 720;
    const count = this.reduced ? 18 : this.compact ? 36 : 72;
    this.waves = Array.from({ length: count }, (_, i) => ({
      amp: 10 + ((i * 17) % 28),
      freq: 0.006 + (i % 7) * 0.0011,
      phase: i * 0.37,
      y: h * (0.12 + ((i * 0.618) % 0.76)),
      width: 0.6 + (i % 5) * 0.18,
      tint: i % 5,
    }));
    const nPart = this.reduced ? 20 : this.compact ? 46 : 110;
    this.particles = Array.from({ length: nPart }, (_, i) => ({
      wave: i % this.waves.length,
      t: (i * 0.137) % 1,
      speed: 0.0012 + (i % 9) * 0.00018,
      size: 1 + (i % 3) * 0.45,
    }));
  }

  private loop(canvas: HTMLCanvasElement): void {
    const step = () => {
      this.target = MIX[this.state()] || MIX.wait;
      const k = 0.045;
      this.mix.g += (this.target.g - this.mix.g) * k;
      this.mix.r += (this.target.r - this.mix.r) * k;
      this.mix.v += (this.target.v - this.mix.v) * k;
      this.mix.a += (this.target.a - this.mix.a) * k;
      if (!this.paused() && !this.reduced) this.t += this.strength() === 'strong' ? 1.15 : this.strength() === 'weak' ? 0.7 : 1;
      this.draw(canvas);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private draw(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const flat = this.state() === 'side' || this.state() === 'wait' ? 0.45 : 1;
    for (const wave of this.waves) {
      ctx.beginPath();
      const color = this.stroke(wave.tint);
      ctx.strokeStyle = color;
      ctx.lineWidth = wave.width;
      ctx.globalAlpha = 0.22 + this.mix.a * 0.28;
      for (let x = 0; x <= w; x += 8) {
        const pull = Math.exp(-((x - cx) ** 2) / (w * w * 0.12));
        const y =
          wave.y +
          Math.sin(x * wave.freq + wave.phase + this.t * 0.012) * wave.amp * flat * (0.55 + pull * 0.7) +
          (cy - wave.y) * pull * 0.42;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (this.reduced) {
      this.drawHub(ctx, cx, cy);
      return;
    }
    for (const p of this.particles) {
      p.t += p.speed * (this.paused() ? 0 : this.state() === 'fade' ? 0.55 : 1);
      if (p.t > 1) p.t -= 1;
      const wave = this.waves[p.wave];
      if (!wave) continue;
      const x = p.t * w;
      const pull = Math.exp(-((x - cx) ** 2) / (w * w * 0.12));
      const y =
        wave.y +
        Math.sin(x * wave.freq + wave.phase + this.t * 0.012) * wave.amp * flat * (0.55 + pull * 0.7) +
        (cy - wave.y) * pull * 0.42;
      ctx.beginPath();
      ctx.fillStyle = this.stroke(wave.tint);
      ctx.globalAlpha = 0.55;
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.drawHub(ctx, cx, cy);
  }

  private drawHub(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const pulse = 1 + Math.sin(this.t * 0.04) * 0.08;
    const r = 46 * pulse;
    const g = ctx.createRadialGradient(cx, cy, 8, cx, cy, r * 1.8);
    g.addColorStop(0, this.hex(this.mix.g, this.mix.r, this.mix.v, 0.28));
    g.addColorStop(1, 'rgba(245,248,252,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = this.hex(this.mix.g, this.mix.r, this.mix.v, 0.85);
    ctx.lineWidth = 2;
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private stroke(tint: number): string {
    if (tint === 0) return `rgba(0, 184, 135, ${0.35 + this.mix.g * 0.45})`;
    if (tint === 1) return `rgba(239, 68, 82, ${0.28 + this.mix.r * 0.45})`;
    if (tint === 2) return `rgba(128, 101, 216, ${0.18 + this.mix.v * 0.5})`;
    if (tint === 3) return `rgba(56, 189, 248, ${0.18 + this.mix.a * 0.25})`;
    return `rgba(148, 163, 184, ${0.16 + (1 - this.mix.a) * 0.2})`;
  }

  private hex(g: number, r: number, v: number, a: number): string {
    const R = Math.round(0 + 239 * r + 128 * v);
    const G = Math.round(40 + 184 * g + 40 * v);
    const B = Math.round(80 + 80 * g + 120 * v);
    return `rgba(${R},${G},${B},${a})`;
  }
}

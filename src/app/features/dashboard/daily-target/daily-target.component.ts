import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TARGET_DATA } from './target-data';

/**
 * Daily Target — set a capital and a rupee target, see what the Exhaustion Fade
 * strategy actually delivers against it, scaled from its real per-trade record.
 * READ-ONLY analysis; never trades. Scales the frozen ₹30k/5× per-trade net P&L
 * linearly with the entered capital (notional = capital × 5× MIS).
 */
@Component({
  selector: 'app-daily-target',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './daily-target.component.html',
  styleUrl: './daily-target.component.css',
})
export class DailyTargetComponent {
  readonly capital = signal(30000);
  readonly target = signal(300);
  private readonly d = TARGET_DATA;

  /** Per-trade nets scaled to the entered capital (base is ₹30k). */
  private readonly scaled = computed(() => {
    const factor = this.capital() / this.d.baseCapital;
    return this.d.trades.map((n) => n * factor);
  });

  readonly stats = computed(() => {
    const t = this.scaled();
    const tgt = this.target();
    const wins = t.filter((n) => n > 0);
    const losses = t.filter((n) => n <= 0);
    const hit = t.filter((n) => n >= tgt);
    const total = t.reduce((a, b) => a + b, 0);
    const perTrade = total / t.length;
    const tradesPerMonth = (t.length / this.d.sessions) * 21;
    return {
      trades: t.length,
      hitPct: Math.round((100 * hit.length) / t.length),
      winPct: Math.round((100 * wins.length) / t.length),
      avgWin: Math.round(wins.reduce((a, b) => a + b, 0) / (wins.length || 1)),
      avgLoss: Math.round(losses.reduce((a, b) => a + b, 0) / (losses.length || 1)),
      perTrade: Math.round(perTrade),
      perMonth: Math.round(perTrade * tradesPerMonth),
      tradesPerMonth: Math.round(tradesPerMonth * 10) / 10,
      worst: Math.round(Math.min(...t)),
      best: Math.round(Math.max(...t)),
      years:
        (new Date(this.d.lastDate).getTime() - new Date(this.d.firstDate).getTime()) /
        (365 * 864e5),
    };
  });

  /** Honest verdict tone from the numbers. */
  readonly verdict = computed(() => {
    const s = this.stats();
    if (s.perTrade <= 0) return { tone: 'bad', text: 'Loses money after costs at this capital.' };
    if (s.perMonth >= this.target())
      return {
        tone: 'ok',
        text: `Averages ${this.fmt(s.perMonth)}/month — clears your ${this.fmt(
          this.target(),
        )} target on average, but not every trade and not without losing weeks.`,
      };
    return {
      tone: 'warn',
      text: `Positive on average (${this.fmt(s.perTrade)}/trade) but below your target once costs are paid.`,
    };
  });

  fmt(n: number): string {
    const sign = n < 0 ? '-' : '';
    return `${sign}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
  }
  setCapital(v: string): void {
    const n = Number(v);
    if (n > 0) this.capital.set(Math.round(n));
  }
  setTarget(v: string): void {
    const n = Number(v);
    if (n > 0) this.target.set(Math.round(n));
  }
}

import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { SniperService } from '../../../core/sniper/sniper.service';
import {
  SNIPER_EVENT_STEPS,
  SNIPER_STOP_RS,
  SNIPER_TARGET_RS,
  SniperBar,
  SniperBookState,
  SniperEvent,
  sniperEventRank,
} from '../../../core/sniper/sniper.models';
import { hhmm, sniperIstClock } from '../../../core/sniper/sniper-clock';
import { deskTotals } from '../../../core/sniper/sniper-stats';
import { allSniperFills, candleDir } from '../../../core/sniper/sniper-engine';

@Component({
  selector: 'app-sniper',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './sniper.component.html',
  styleUrl: './sniper.component.css',
})
export class SniperComponent {
  protected readonly sniper = inject(SniperService);
  protected readonly steps = SNIPER_EVENT_STEPS;
  protected readonly stopRs = SNIPER_STOP_RS;
  protected readonly targetRs = SNIPER_TARGET_RS;
  protected readonly nowIst = signal(sniperIstClock(new Date().toISOString()));
  protected readonly totals = computed(() => deskTotals(this.sniper.session()));
  protected readonly fills = computed(() => allSniperFills(this.sniper.session()));
  protected readonly book = computed(() => this.sniper.session().books.find((b) => b.id === 'bank') || null);
  protected readonly selected = computed(() => {
    const s = this.sniper.session();
    return s.books.find((b) => b.id === s.selected) || this.book();
  });
  protected readonly startOff = computed(() => this.sniper.session().running || this.sniper.busy());
  protected readonly stopOff = computed(() => !this.sniper.session().running);
  protected readonly pulses = computed(() => [...(this.book()?.pulse || [])].reverse());

  constructor() {
    const tick = setInterval(() => this.nowIst.set(sniperIstClock(new Date().toISOString())), 1_000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  protected clock(iso?: string): string {
    return sniperIstClock(iso);
  }

  protected hhmm(min: number | null | undefined): string {
    return min == null ? '—' : hhmm(min);
  }

  protected eventOf(b: SniperBookState | null | undefined): SniperEvent {
    return b?.event || 'watching';
  }

  protected parked(b: SniperBookState): boolean {
    return this.eventOf(b) === 'parked';
  }

  protected badge(b: SniperBookState): string {
    const ev = this.eventOf(b);
    if (ev === 'parked' && b.cut === 'up') return 'skip up';
    if (ev === 'parked') return 'idle';
    if (ev === 'orb_break') return `ORB ${b.cut || 'down'}`.trim();
    if (ev === 'breakout_candle') return '40% red';
    if (ev === 'found_entry') return 'entry';
    if (ev === 'trade_taken') return 'taken';
    if (ev === 'trade_closed') return 'closed';
    if (ev === 'off') return 'off';
    return b.orReady ? 'ORB' : 'ORB…';
  }

  protected chipOn(step: (typeof SNIPER_EVENT_STEPS)[number]['id'], b: SniperBookState | null): boolean {
    if (!b || this.parked(b)) return false;
    return sniperEventRank(this.eventOf(b)) >= sniperEventRank(step);
  }

  protected chipNow(step: (typeof SNIPER_EVENT_STEPS)[number]['id'], b: SniperBookState | null): boolean {
    return !!b && !this.parked(b) && this.eventOf(b) === step;
  }

  protected dir(bar: SniperBar): 'green' | 'red' | 'doji' {
    return candleDir(bar);
  }

  protected startDesk(): void {
    if (this.startOff()) return;
    void this.sniper.start();
  }

  protected stopDesk(): void {
    if (this.stopOff()) return;
    this.sniper.stop();
  }

  protected onPaper(ev: Event): void {
    this.sniper.setPaper((ev.target as HTMLInputElement).checked);
  }

  protected onLive(ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    if (on) void this.sniper.armLive();
    else this.sniper.disarmLive();
  }

  protected onLots(ev: Event): void {
    this.sniper.setLots(Number((ev.target as HTMLInputElement).value));
  }
}

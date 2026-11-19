import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { SniperService } from '../../../core/sniper/sniper.service';
import { SNIPER_BOOKS, SNIPER_CAPITAL_RS, SNIPER_HONEST, SniperBookState, SniperMode } from '../../../core/sniper/sniper.models';
import { sniperIstClock, sniperRemainingMin, sniperCfg, hhmm, sniperIstMinutes } from '../../../core/sniper/sniper-clock';
import { deskTotals, equityPoints, sessionReport, statsAll } from '../../../core/sniper/sniper-stats';
import { allSniperFills } from '../../../core/sniper/sniper-engine';

@Component({
  selector: 'app-sniper',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './sniper.component.html',
  styleUrl: './sniper.component.css',
})
export class SniperComponent {
  protected readonly sniper = inject(SniperService);
  protected readonly honest = SNIPER_HONEST;
  protected readonly startRs = SNIPER_CAPITAL_RS;
  protected readonly copied = signal('');
  protected readonly replayDay = signal(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));

  protected readonly totals = computed(() => deskTotals(this.sniper.session()));
  protected readonly bookStats = computed(() => statsAll(this.sniper.session()));
  protected readonly fills = computed(() => allSniperFills(this.sniper.session()));
  protected readonly report = computed(() => sessionReport(this.sniper.session()));
  protected readonly equity = computed(() => {
    const s = this.sniper.session();
    return s.books.map((b) => ({ id: b.id, label: b.label, pts: equityPoints(b.fills) }));
  });
  protected readonly startOff = computed(() => this.sniper.session().running || this.sniper.busy());
  protected readonly stopOff = computed(() => !this.sniper.session().running);

  protected clock(iso?: string): string {
    return sniperIstClock(iso);
  }

  protected remain(book: SniperBookState): number {
    return sniperRemainingMin(sniperCfg(book.id), sniperIstMinutes());
  }

  protected slotNow(book: SniperBookState): string {
    const cfg = sniperCfg(book.id);
    const m = sniperIstMinutes();
    if (m < cfg.openMin) return `opens ${hhmm(cfg.openMin)}`;
    if (m >= cfg.flatMin) return 'session closed';
    return `${hhmm(book.entryMin ?? cfg.openMin)}–${hhmm((book.intervalEnd ?? cfg.openMin + 5))}`;
  }

  protected startDesk(): void {
    if (this.startOff()) return;
    void this.sniper.start();
  }

  protected stopDesk(): void {
    if (this.stopOff()) return;
    this.sniper.stop();
  }

  protected setMode(mode: SniperMode): void {
    this.sniper.setMode(mode);
  }

  protected arm(): void {
    void this.sniper.armLive();
  }

  protected disarm(): void {
    this.sniper.disarmLive();
  }

  protected onReplayDay(ev: Event): void {
    this.replayDay.set((ev.target as HTMLInputElement).value);
  }

  protected runReplay(): void {
    void this.sniper.replay(this.replayDay());
  }

  protected async copyReport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.report());
      this.copied.set('ok');
      window.setTimeout(() => this.copied.set(''), 1600);
    } catch {
      this.copied.set('');
    }
  }

  protected spark(pts: { t: string; y: number }[]): string {
    if (pts.length < 2) return '';
    const w = 220;
    const h = 64;
    const ys = pts.map((p) => p.y);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const span = max - min || 1;
    return pts
      .map((p, i) => {
        const x = (i / (pts.length - 1)) * w;
        const y = h - ((p.y - min) / span) * (h - 4) - 2;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  protected books(): typeof SNIPER_BOOKS {
    return SNIPER_BOOKS;
  }
}

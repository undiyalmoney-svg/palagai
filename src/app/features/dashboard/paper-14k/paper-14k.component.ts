import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import { PAPER_HUNT_CAP, PAPER_HUNT_HONEST, PAPER_HUNT_METHODS } from '../../../core/paper-desk/paper-hunt.methods';
import { huntTabNet, huntTickets } from '../../../core/paper-desk/paper-hunt.engine';

const HUNT_TABS = [
  { under: 'nifty' as const, label: 'Nifty 50' },
  { under: 'bank' as const, label: 'Bank Nifty' },
  { under: 'sensex' as const, label: 'Sensex' },
  { under: 'crude' as const, label: 'Crude Mini' },
];

@Component({
  selector: 'app-paper-14k',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './paper-14k.component.html',
  styleUrl: '../crude-oil/crude-oil.component.css',
})
export class Paper14kComponent implements OnDestroy {
  protected readonly paper = inject(LivePaperService);
  private readonly clockNow = signal(Date.now());
  private readonly clockTimer = setInterval(() => this.clockNow.set(Date.now()), 5_000);

  protected readonly now = computed(() => this.nowCard(this.paper.session(), this.paper.busy(), this.clockNow()));
  protected readonly huntHonest = PAPER_HUNT_HONEST;
  protected readonly huntMethodCount = PAPER_HUNT_METHODS.length;
  protected readonly huntCap = PAPER_HUNT_CAP;
  protected readonly huntTabs = HUNT_TABS;
  protected readonly huntTab = signal<(typeof HUNT_TABS)[number]['under']>('nifty');
  protected readonly hunt = computed(() => this.paper.session().hunt || null);
  protected readonly huntTabTickets = computed(() => huntTickets(this.hunt(), this.huntTab()));
  protected readonly huntTabClosed = computed(() => huntTabNet(this.hunt(), this.huntTab()));
  protected readonly huntTabLabel = computed(
    () => this.huntTabs.find((r) => r.under === this.huntTab())?.label || this.huntTab(),
  );

  constructor() {
    this.paper.setLiveToggle(false);
    for (const row of HUNT_TABS) this.paper.setLiveBook(row.under, false);
  }

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
  }

  protected startPaper(): void {
    this.paper.setLiveToggle(false);
    for (const row of HUNT_TABS) this.paper.setLiveBook(row.under, false);
    void this.paper.start();
  }

  protected stopPaper(): void {
    this.paper.stop();
  }

  protected selectHuntTab(under: (typeof HUNT_TABS)[number]['under']): void {
    this.huntTab.set(under);
  }

  protected clock(iso?: string): string {
    return istClock(iso || '');
  }

  private nowCard(
    s: ReturnType<LivePaperService['session']>,
    busy: boolean,
    nowMs: number,
  ): { tone: string; badge: string; title: string; lines: string[] } {
    const huntTrades = s.hunt?.trades || 0;
    const ageSec = s.asOf ? Math.max(0, Math.round((nowMs - Date.parse(s.asOf)) / 1000)) : null;
    const checked =
      s.asOf && ageSec != null && Number.isFinite(ageSec)
        ? `Last Kite check ${istClock(s.asOf)} IST${ageSec >= 90 ? ` — ${Math.round(ageSec / 60)} min ago.` : '.'}`
        : '';
    const today = `Today ${s.day}: ${huntTrades.toLocaleString('en-IN')} paper tickets.`;
    const foot = `Paper hunt only. One Start runs ${this.huntMethodCount} methods on all four names. Not a guaranteed profit.`;

    if (s.kiteError) {
      return { tone: 'down', badge: 'needs Token', title: s.kiteError, lines: [today, foot] };
    }
    if (!s.running) {
      return {
        tone: 'info',
        badge: 'not watching',
        title: 'Not watching. Hit Start. One Start runs all four on paper.',
        lines: ['Nifty 50, Bank Nifty, Sensex, Crude Mini.', today, foot],
      };
    }
    if (busy && huntTrades === 0 && !s.hunt) {
      return { tone: 'info', badge: 'checking Kite', title: 'Checking Kite…', lines: [foot] };
    }
    return {
      tone: 'info',
      badge: 'watching',
      title: `Watching Nifty, Bank Nifty, Sensex and Crude Mini from 09:00. ${this.huntMethodCount} methods each, paper only.`,
      lines: [checked, today, foot].filter(Boolean),
    };
  }
}

function istClock(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

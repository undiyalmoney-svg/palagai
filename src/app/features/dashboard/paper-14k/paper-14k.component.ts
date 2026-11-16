import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import { PAPER_HUNT_CAP, PAPER_HUNT_HONEST, PAPER_HUNT_METHODS } from '../../../core/paper-desk/paper-hunt.methods';
import {
  HuntMethodView,
  filterHuntMethodRows,
  huntLeaders,
  huntMethodRows,
  huntSummaries,
  huntTabNet,
  huntTickets,
} from '../../../core/paper-desk/paper-hunt.engine';

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
  protected readonly huntView = signal<HuntMethodView>('all');
  protected readonly huntViews: { id: HuntMethodView; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'traded', label: 'Traded' },
    { id: 'green', label: 'Green' },
  ];
  protected readonly hunt = computed(() => this.paper.session().hunt || null);
  protected readonly huntSummaries = computed(() => huntSummaries(this.hunt()));
  protected readonly huntLeaders = computed(() => huntLeaders(this.hunt()));
  protected readonly huntTabMethods = computed(() =>
    filterHuntMethodRows(huntMethodRows(this.hunt(), this.huntTab()), this.huntView()),
  );
  protected readonly huntTabTickets = computed(() => huntTickets(this.hunt(), this.huntTab()));
  protected readonly huntTabClosed = computed(() => huntTabNet(this.hunt(), this.huntTab()));
  protected readonly huntTabLabel = computed(
    () => this.huntTabs.find((r) => r.under === this.huntTab())?.label || this.huntTab(),
  );
  protected readonly startOff = computed(() => this.paper.session().running || this.paper.busy());
  protected readonly stopOff = computed(() => !this.paper.session().running);

  constructor() {
    this.paper.setLiveToggle(false);
    for (const row of HUNT_TABS) this.paper.setLiveBook(row.under, false);
  }

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
  }

  protected startPaper(): void {
    if (this.startOff()) return;
    this.paper.setLiveToggle(false);
    for (const row of HUNT_TABS) this.paper.setLiveBook(row.under, false);
    void this.paper.start();
  }

  protected stopPaper(): void {
    if (this.stopOff()) return;
    this.paper.stop();
  }

  protected refreshPaper(): void {
    void this.paper.refresh();
  }

  protected selectHuntTab(under: (typeof HUNT_TABS)[number]['under']): void {
    this.huntTab.set(under);
  }

  protected selectHuntView(view: HuntMethodView): void {
    this.huntView.set(view);
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
    const feed = s.hunt?.feed || '';
    const droplet = this.paper.dropletNote();
    const foot = `Paper hunt only. One Start runs ${this.huntMethodCount} methods on all four names. Not a guaranteed profit.`;

    if (s.kiteError) {
      return { tone: 'down', badge: 'needs Token', title: s.kiteError, lines: [today, feed, foot].filter(Boolean) };
    }
    if (!s.running) {
      return {
        tone: 'info',
        badge: 'not watching',
        title: 'Not watching. Hit Start. One Start runs all four on paper.',
        lines: ['Nifty 50, Bank Nifty, Sensex, Crude Mini.', today, feed, foot].filter(Boolean),
      };
    }
    if (busy && huntTrades === 0 && !s.hunt) {
      return { tone: 'info', badge: 'checking Kite', title: 'Checking Kite…', lines: [foot] };
    }
    return {
      tone: feed ? 'warn' : 'info',
      badge: 'watching',
      title: `Watching Nifty, Bank Nifty, Sensex and Crude Mini from 09:00. ${this.huntMethodCount} methods each, paper only.`,
      lines: [checked, today, feed, droplet, foot].filter(Boolean),
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

import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import { PaperLiveUnder } from '../../../core/paper-desk/paper-live-order.util';
import {
  LIVE_TAKE_LABEL,
  LIVE_TAKE_LINE,
  LIVE_TAKE_METHOD,
  LIVE_TAKE_UNDERS,
  LivePaperBookState,
  OptionPickView,
  PAPER_TEST_HONEST,
  allClosedFills,
  deskOf,
  nightLogJson,
  optionPickLabel,
  underOf,
} from '../../../core/paper-desk/live-paper.engine';

@Component({
  selector: 'app-crude-oil',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './crude-oil.component.html',
  styleUrl: './crude-oil.component.css',
})
export class CrudeOilComponent implements OnDestroy {
  protected readonly paper = inject(LivePaperService);
  private readonly clockNow = signal(Date.now());
  private readonly clockTimer = setInterval(() => this.clockNow.set(Date.now()), 5_000);

  protected readonly honest = PAPER_TEST_HONEST;
  protected readonly now = computed(() => this.nowCard(this.paper.session(), this.paper.busy(), this.clockNow()));
  protected readonly liveBookRows = LIVE_TAKE_UNDERS.map((under) => ({
    under,
    label: LIVE_TAKE_LABEL[under],
    method: LIVE_TAKE_METHOD[under],
  }));
  protected readonly liveBooks = computed(() => {
    const books = this.paper.session().books;
    return this.liveBookRows
      .map((row) => {
        const book = books.find((b) => (b.under || underOf(b.id)) === row.under && (b.desk || deskOf(b.id)) === 'momentum');
        return book ? { ...row, book } : null;
      })
      .filter((row): row is { under: (typeof LIVE_TAKE_UNDERS)[number]; label: string; method: string; book: LivePaperBookState } => !!row);
  });
  protected readonly liveFills = computed(() =>
    allClosedFills(this.paper.session().books).filter((f) =>
      LIVE_TAKE_UNDERS.includes((f.under || underOf(f.book)) as (typeof LIVE_TAKE_UNDERS)[number]),
    ),
  );
  protected readonly copiedLeader = signal('');
  protected readonly startOff = computed(() => this.paper.session().running || this.paper.busy());
  protected readonly stopOff = computed(() => !this.paper.session().running);

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
  }

  protected startDesk(): void {
    if (this.startOff()) return;
    void this.paper.start();
  }

  protected stopDesk(): void {
    if (this.stopOff()) return;
    this.paper.stop();
  }

  protected refreshDesk(): void {
    void this.paper.refresh();
  }

  protected onLiveBook(under: PaperLiveUnder, ev: Event): void {
    if (!LIVE_TAKE_UNDERS.includes(under as (typeof LIVE_TAKE_UNDERS)[number])) return;
    this.paper.setLiveBook(under, !!(ev.target as HTMLInputElement | null)?.checked);
  }

  protected pick(row: OptionPickView): string {
    return optionPickLabel(row);
  }

  protected copyNightLog(): void {
    void this.writeClipboard(nightLogJson(this.paper.session()), 'log');
  }

  protected clock(iso?: string): string {
    return istClock(iso || '');
  }

  private async writeClipboard(text: string, key: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copiedLeader.set(key);
      window.setTimeout(() => {
        if (this.copiedLeader() === key) this.copiedLeader.set('');
      }, 1600);
    } catch {
      this.copiedLeader.set('');
    }
  }

  private nowCard(
    s: ReturnType<LivePaperService['session']>,
    busy: boolean,
    nowMs: number,
  ): { tone: string; badge: string; title: string; lines: string[] } {
    const ageSec = s.asOf ? Math.max(0, Math.round((nowMs - Date.parse(s.asOf)) / 1000)) : null;
    const checked =
      s.asOf && ageSec != null && Number.isFinite(ageSec)
        ? `Last Kite check ${istClock(s.asOf)} IST${ageSec >= 90 ? ` — ${Math.round(ageSec / 60)} min ago.` : '.'}`
        : '';
    const bank = this.liveBooks().find((d) => d.under === 'bank');
    const nifty = this.liveBooks().find((d) => d.under === 'nifty');
    const sensex = this.liveBooks().find((d) => d.under === 'sensex');
    const crude = this.liveBooks().find((d) => d.under === 'crude');
    const today = `Today ${s.day}: Bank ₹${Math.round(bank?.book.closedRs || 0).toLocaleString('en-IN')} · Nifty ₹${Math.round(nifty?.book.closedRs || 0).toLocaleString('en-IN')} · Sensex ₹${Math.round(sensex?.book.closedRs || 0).toLocaleString('en-IN')} · Crude ₹${Math.round(crude?.book.closedRs || 0).toLocaleString('en-IN')}.`;
    const droplet = this.paper.dropletNote();
    const foot = `Paper always records. Arise Live Kite is ${LIVE_TAKE_LINE}. Hunt stays on Paper test. Not a guaranteed profit.`;

    if (s.kiteError) {
      return { tone: 'down', badge: 'needs Token', title: s.kiteError, lines: [today, foot].filter(Boolean) };
    }
    if (!s.running) {
      return {
        tone: 'info',
        badge: 'not watching',
        title: 'Not watching. Hit Start. Paper always. Live Kite is extra on ticked books.',
        lines: [
          LIVE_TAKE_LINE + '.',
          'Index tickets from 09:45 IST after the 09:15–09:30 opening range. Crude Mini from 09:15 IST.',
          today,
          foot,
        ].filter(Boolean),
      };
    }
    if (busy && !s.asOf) {
      return { tone: 'info', badge: 'checking Kite', title: 'Checking Kite…', lines: [foot] };
    }
    return {
      tone: this.paper.liveArmed() ? 'down' : 'info',
      badge: this.paper.liveArmed() ? 'Live Kite on' : 'watching',
      title: this.paper.liveArmed()
        ? 'Watching Bank Nifty, Nifty 50, Sensex and Crude Mini. Index from 09:45 IST, Crude Mini from 09:15 IST. Live Kite sends a MARKET buy and a resting SL on ticked books.'
        : 'Watching Bank Nifty, Nifty 50, Sensex and Crude Mini on paper. Index from 09:45 IST, Crude Mini from 09:15 IST. Switch to Live Kite to send orders.',
      lines: [checked, today, droplet, foot].filter(Boolean),
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

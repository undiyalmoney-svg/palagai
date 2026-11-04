import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { AnalyticsView, PaperAnalyticsComponent } from './paper-analytics.component';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import {
  LIVE_PAPER_BOOKS,
  LivePaperBookState,
  OptionPickView,
  allClosedFills,
  booksFundEnd,
  hhmm,
  optionPickLabel,
} from '../../../core/paper-desk/live-paper.engine';

@Component({
  selector: 'app-paper-14k',
  standalone: true,
  imports: [DecimalPipe, PaperAnalyticsComponent],
  templateUrl: './paper-14k.component.html',
  styleUrl: '../crude-oil/crude-oil.component.css',
})
export class Paper14kComponent implements OnDestroy {
  protected readonly paper = inject(LivePaperService);
  private readonly clock = signal(Date.now());
  private readonly clockTimer = setInterval(() => this.clock.set(Date.now()), 5_000);

  protected readonly view = signal<'desk' | AnalyticsView>('desk');
  protected readonly views: { id: 'desk' | AnalyticsView; label: string }[] = [
    { id: 'desk', label: 'Desk' },
    { id: 'signals', label: 'Signals' },
    { id: 'performance', label: 'Performance' },
    { id: 'compare', label: 'Paper vs live' },
    { id: 'validation', label: 'Validation' },
    { id: 'trades', label: 'Trades' },
  ];

  protected readonly now = computed(() => this.nowCard(this.paper.session(), this.paper.busy(), this.clock()));

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
  }

  protected analyticsView(): AnalyticsView | null {
    const v = this.view();
    return v === 'desk' ? null : v;
  }

  protected startPaper(): void {
    void this.paper.start();
  }

  protected stopPaper(): void {
    this.paper.stop();
  }

  protected booksFund(): number {
    return booksFundEnd(this.paper.session().books);
  }

  protected strategyNote(id: string): string {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === id);
    if (cfg?.strategy === 'watch') return 'watch only';
    if (cfg?.strategy === 'momentum') return 'momentum';
    return '';
  }

  protected pick(row: OptionPickView): string {
    return optionPickLabel(row);
  }

  protected fills() {
    return allClosedFills(this.paper.session().books);
  }

  private nowCard(
    s: ReturnType<LivePaperService['session']>,
    busy: boolean,
    nowMs: number,
  ): { tone: string; badge: string; title: string; lines: string[] } {
    const nifty = s.books.find((b) => b.id === 'nifty');
    const ageSec = s.asOf ? Math.max(0, Math.round((nowMs - Date.parse(s.asOf)) / 1000)) : null;
    const checked =
      s.asOf && ageSec != null && Number.isFinite(ageSec)
        ? `Last Kite check ${istClock(s.asOf)} IST${ageSec >= 90 ? ` — ${Math.round(ageSec / 60)} min ago. This tab was in the background, so the desk paused. Leave it open and in front.` : '.'}`
        : '';
    const today = `Today ${s.day}: closed ₹${Math.round(s.closedRs).toLocaleString('en-IN')}.`;
    const foot = 'Paper only — no Kite order. No order is placed. Motto: buy CE/PE. Not a guaranteed profit.';

    if (s.kiteError) {
      return { tone: 'down', badge: 'needs Token', title: s.kiteError, lines: [today, foot] };
    }
    if (!s.running) {
      return {
        tone: 'info',
        badge: 'not watching',
        title: 'Not watching. Hit Start and leave this tab open through the session.',
        lines: [today, foot],
      };
    }
    if (busy && !nifty?.last) {
      return { tone: 'info', badge: 'checking Kite', title: 'Checking Kite…', lines: [foot] };
    }
    if (nifty && nifty.side !== 'flat') {
      return {
        tone: nifty.liveRs < 0 ? 'down' : 'up',
        badge: 'in a trade',
        title: tradeLine(nifty),
        lines: [checked, today, foot].filter(Boolean),
      };
    }
    const gauge = nifty?.gauge;
    const title = !gauge
      ? 'Watching Nifty. Momentum needs 30 minutes of bars, so nothing can fire before about 9:45.'
      : `Nifty moved ${gauge.move} pts in 30 min. A trade needs ${gauge.need} pts. No trade right now.`;
    const note = nifty?.reason && /missed|skipped|max \d|day stop|cooldown/.test(nifty.reason) ? nifty.reason : '';
    return {
      tone: 'info',
      badge: 'watching',
      title,
      lines: [note, checked, today, foot].filter(Boolean),
    };
  }
}

function tradeLine(b: LivePaperBookState): string {
  const name = optionPickLabel(b) || b.label;
  const since = b.entryMin != null ? ` from ${hhmm(b.entryMin)}` : '';
  const out = b.entryMin != null ? hhmm(Math.min(b.entryMin + 24 * 5, 15 * 60 + 15)) : '15:15';
  return `${name}${since}. Stop ₹${b.sl ?? '—'}, target ₹${b.tp ?? '—'}. Live ₹${Math.round(b.liveRs).toLocaleString('en-IN')}. Out by ${out} or 15:15.`;
}

function istClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

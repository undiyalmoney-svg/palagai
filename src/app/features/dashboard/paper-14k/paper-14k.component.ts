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
    if (cfg?.strategy === 'momentum') return 'momentum · ATM · stop 40% · target 100% · 2 h';
    if (cfg?.strategy === 'watch') return 'watch only';
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
    const books = s.books;
    const open = books.filter((b) => b.side !== 'flat');
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
    if (busy && !books.some((b) => b.last != null)) {
      return { tone: 'info', badge: 'checking Kite', title: 'Checking Kite…', lines: [foot] };
    }
    if (open.length) {
      const lead = open[0];
      return {
        tone: open.some((b) => b.liveRs < 0) ? 'down' : 'up',
        badge: open.length > 1 ? `${open.length} trades` : 'in a trade',
        title: tradeLine(lead),
        lines: [
          open.length > 1 ? open.slice(1).map((b) => tradeLine(b)).join(' ') : '',
          checked,
          today,
          foot,
        ].filter(Boolean),
      };
    }
    const gauges = books
      .filter((b) => b.gauge)
      .map((b) => `${b.label} ${b.gauge!.move}/${b.gauge!.need}`)
      .join(' · ');
    const title = gauges
      ? `Watching all four on momentum. ${gauges} pts in 30 min (move / need). No trade right now.`
      : 'Watching all four on momentum. Needs 30 minutes of bars (about 9:45 on the indices, 9:30 on Crude).';
    const notes = books
      .filter((b) => b.reason && /missed|skipped|max \d|day stop|cooldown/.test(b.reason))
      .map((b) => `${b.label}: ${b.reason}`)
      .join(' ');
    return {
      tone: 'info',
      badge: 'watching',
      title,
      lines: [notes, checked, today, foot].filter(Boolean),
    };
  }
}

function tradeLine(b: LivePaperBookState): string {
  const cfg = LIVE_PAPER_BOOKS.find((c) => c.id === b.id);
  const name = optionPickLabel(b) || b.label;
  const since = b.entryMin != null ? ` from ${hhmm(b.entryMin)}` : '';
  const flat = cfg?.flat ?? 15 * 60 + 15;
  const holdEnd = b.entryMin != null ? b.entryMin + (cfg?.holdBars ?? 24) * 5 : flat;
  const out = hhmm(Math.min(holdEnd, flat));
  return `${name}${since}. Stop ₹${b.sl ?? '—'}, target ₹${b.tp ?? '—'}. Live ₹${Math.round(b.liveRs).toLocaleString('en-IN')}. Out by ${out}.`;
}

function istClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

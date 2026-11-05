import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import {
  ALL_PAPER_BOOKS,
  LivePaperBookState,
  OptionPickView,
  PAPER_DESKS,
  PAPER_SCALP,
  allClosedFills,
  booksFundEnd,
  deskOf,
  hhmm,
  nightLogJson,
  optionPickLabel,
} from '../../../core/paper-desk/live-paper.engine';

@Component({
  selector: 'app-paper-14k',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './paper-14k.component.html',
  styleUrl: '../crude-oil/crude-oil.component.css',
})
export class Paper14kComponent implements OnDestroy {
  protected readonly paper = inject(LivePaperService);
  protected readonly copied = signal(false);
  private readonly clockNow = signal(Date.now());
  private readonly clockTimer = setInterval(() => this.clockNow.set(Date.now()), 5_000);

  protected readonly now = computed(() => this.nowCard(this.paper.session(), this.paper.busy(), this.clockNow()));
  protected readonly desks = computed(() => {
    const books = this.paper.session().books;
    return PAPER_DESKS.map((d) => {
      const rows = books.filter((b) => (b.desk || deskOf(b.id)) === d.id);
      return {
        ...d,
        books: rows,
        liveRs: Math.round(rows.reduce((s, b) => s + (b.side === 'flat' ? 0 : b.liveRs), 0) * 10) / 10,
        closedRs: Math.round(rows.reduce((s, b) => s + b.closedRs, 0) * 10) / 10,
      };
    });
  });
  protected readonly scalp = computed(() => {
    const rows = this.paper.session().books.filter((b) => (b.desk || deskOf(b.id)) === PAPER_SCALP.id);
    return {
      ...PAPER_SCALP,
      books: rows,
      liveRs: Math.round(rows.reduce((s, b) => s + (b.side === 'flat' ? 0 : b.liveRs), 0) * 10) / 10,
      closedRs: Math.round(rows.reduce((s, b) => s + b.closedRs, 0) * 10) / 10,
      capitalUsed: Math.round(rows.reduce((s, b) => s + (b.capitalUsed || 0), 0)),
    };
  });

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
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

  protected pick(row: OptionPickView): string {
    return optionPickLabel(row);
  }

  protected fills() {
    return allClosedFills(this.paper.session().books);
  }

  protected deskLabel(id: string): string {
    const desk = id.includes('-') ? deskOf(id) : id;
    if (desk === PAPER_SCALP.id) return PAPER_SCALP.label;
    return PAPER_DESKS.find((d) => d.id === desk)?.label || desk;
  }

  protected clock(iso?: string): string {
    return istClock(iso || '');
  }

  protected copyNightLog(): void {
    const text = nightLogJson(this.paper.session());
    void navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
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
    const names = 'Crude Mini, Nifty 50, Bank Nifty, Sensex.';
    const foot = 'Paper only — no Kite order. No order is placed. Motto: buy CE/PE. Not a guaranteed profit.';

    if (s.kiteError) {
      return { tone: 'down', badge: 'needs Token', title: s.kiteError, lines: [today, foot] };
    }
    if (!s.running) {
      return {
        tone: 'info',
        badge: 'not watching',
        title: 'Not watching. Hit Start and leave this tab open through the session.',
        lines: [names, today, foot],
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
    return {
      tone: 'info',
      badge: 'watching',
      title: 'Watching Nifty, Bank Nifty and Sensex momentum. Crude and the other desks are watch-only. No trade right now.',
      lines: [checked, today, foot].filter(Boolean),
    };
  }
}

function tradeLine(b: LivePaperBookState): string {
  const cfg = ALL_PAPER_BOOKS.find((c) => c.id === b.id);
  const deskId = b.desk || deskOf(b.id);
  const desk =
    deskId === PAPER_SCALP.id ? PAPER_SCALP.label : PAPER_DESKS.find((d) => d.id === deskId)?.label || '';
  const name = optionPickLabel(b) || b.label;
  const since = b.entryMin != null ? ` from ${hhmm(b.entryMin)}` : '';
  const flat = cfg?.flat ?? 15 * 60 + 15;
  const holdEnd = b.entryMin != null ? b.entryMin + (cfg?.holdBars ?? 24) * (cfg?.barMinutes ?? 5) : flat;
  const out = hhmm(Math.min(holdEnd, flat));
  return `${desk} ${name}${since}. Stop ₹${b.sl ?? '—'}, target ₹${b.tp ?? '—'}. Live ₹${Math.round(b.liveRs).toLocaleString('en-IN')}. Out by ${out}.`;
}

function istClock(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

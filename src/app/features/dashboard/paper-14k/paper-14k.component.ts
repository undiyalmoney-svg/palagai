import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import { PaperLiveUnder } from '../../../core/paper-desk/paper-live-order.util';
import {
  ALL_PAPER_BOOKS,
  LivePaperBookState,
  OptionPickView,
  PAPER_DESKS,
  allClosedFills,
  booksFundEnd,
  deskOf,
  hhmm,
  nightLogJson,
  optionPickLabel,
  paperFillGrade,
  paperFillGradeTone,
  underOf,
} from '../../../core/paper-desk/live-paper.engine';

const ARMED_ORDER = ['nifty', 'bank', 'sensex', 'crude'] as const;
const ARMED_RULE: Record<(typeof ARMED_ORDER)[number], string> = {
  nifty: '1-min from 09:45 — own fill · up to five fills · target nets ₹370 after charges · fill TP at the live bid',
  bank: '1-min from 09:45 — own fill · up to five fills · target nets ₹370 after charges · fill TP at the live bid',
  sensex: '1-min from 09:45 — own fill · up to five fills · target nets ₹370 after charges · fill TP at the live bid',
  crude: 'From 09:00 MCX open — up to five fills · 0.8× thrust · target nets ₹370',
};

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
  protected readonly armed = computed(() => {
    const books = this.paper.session().books;
    return ARMED_ORDER.map((under) => {
      const book = books.find((b) => (b.under || underOf(b.id)) === under && (b.desk || deskOf(b.id)) === 'momentum');
      return book ? { under, rule: ARMED_RULE[under], book } : null;
    }).filter((row): row is { under: (typeof ARMED_ORDER)[number]; rule: string; book: LivePaperBookState } => !!row);
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

  protected readonly liveBookRows = [
    { under: 'nifty' as const, label: 'Nifty 50' },
    { under: 'bank' as const, label: 'Bank Nifty' },
    { under: 'sensex' as const, label: 'Sensex' },
    { under: 'crude' as const, label: 'Crude Mini' },
  ];

  protected onLiveBook(under: PaperLiveUnder, ev: Event): void {
    this.paper.setLiveBook(under, !!(ev.target as HTMLInputElement | null)?.checked);
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

  protected gradeOf(f: { rs: number; reason: string; grade?: string }): string {
    return f.grade || paperFillGrade(f);
  }

  protected gradeTone(f: { rs: number; reason: string; grade?: string }): string {
    return paperFillGradeTone(paperFillGrade(f));
  }

  protected lastGrade(book: LivePaperBookState): string {
    const last = book.fills[book.fills.length - 1];
    return last ? this.gradeOf(last) : '';
  }

  protected deskLabel(id: string): string {
    const desk = id.includes('-') ? deskOf(id) : id;
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
        ? `Last Kite check ${istClock(s.asOf)} IST${ageSec >= 90 ? ` — ${Math.round(ageSec / 60)} min ago. This tab was in the background. If Live is on, the droplet keeps placing.` : '.'}`
        : '';
    const today = `Today ${s.day}: closed ₹${Math.round(s.closedRs).toLocaleString('en-IN')}.`;
    const names = 'Crude Mini, Nifty 50, Bank Nifty, Sensex.';
    const foot = s.liveOrders
      ? 'Paper always records. LIVE Kite also sends a MARKET buy and SL on ticked books. Motto: buy CE/PE. Not a guaranteed profit.'
      : 'Paper always records. Live Kite is extra — select Live Kite and tick a book to send a real order. Motto: buy CE/PE. Not a guaranteed profit.';

    if (s.kiteError) {
      return { tone: 'down', badge: 'needs Token', title: s.kiteError, lines: [today, foot] };
    }
    if (!s.running) {
      return {
        tone: 'info',
        badge: 'not watching',
        title: 'Not watching. Hit Start. Live stays on if you close the tab — the droplet keeps checking.',
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
      title: 'Watching Nifty, Bank Nifty, Sensex and Crude Mini from 09:00. No trade right now.',
      lines: [checked, today, foot].filter(Boolean),
    };
  }
}

function tradeLine(b: LivePaperBookState): string {
  const cfg = ALL_PAPER_BOOKS.find((c) => c.id === b.id);
  const deskId = b.desk || deskOf(b.id);
  const desk = PAPER_DESKS.find((d) => d.id === deskId)?.label || '';
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

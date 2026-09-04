import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';

interface SrTrade {
  date: string; instrument: string; side: string; option: string; confidence: number;
  entryTime: string; entryPrice: number; level: number; bodyPts: number; target: number;
  exitTime: string; exitPrice: number; exitReason: string; points: number; rupees: number;
}
interface SrSummary {
  trades: number; wins: number; losses: number; winPct: number;
  grossPoints: number; grossRupees: number; tgtHitPct: number;
  totalProfitRupees: number; totalLossRupees: number; netRupees: number;
}
interface SrInstrumentResult { key: string; name: string; contract?: string; token: string; candles: number; summary: SrSummary; trades: SrTrade[]; error?: string; }
interface SrResponse { status: string; mode: string; fromDate: string; toDate: string; isToday: boolean; ranAt: string; results: SrInstrumentResult[]; }

const INSTRUMENTS = [
  { key: 'nifty', label: 'Nifty 50' },
  { key: 'banknifty', label: 'Bank Nifty' },
  { key: 'crude', label: 'Crude Oil Mini' },
];

@Component({
  selector: 'app-sr-breakout',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sr-breakout.component.html',
  styleUrl: './sr-breakout.component.css',
})
export class SrBreakoutComponent {
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly liveApiBase =
    (environment as { liveApiBaseUrl?: string }).liveApiBaseUrl || '/api/live';

  readonly tab = signal<'paper' | 'live'>('paper');
  readonly instruments = INSTRUMENTS;

  // form state
  today = new Date().toISOString().slice(0, 10);
  fromDate = this.today;
  toDate = this.today;
  sel: Record<string, boolean> = { nifty: true, banknifty: true, crude: true };
  lots = 1;
  entryPts: number | null = null;   // blank = use per-instrument default
  dayLossStopRs: number | null = 3500;    // stop the day once loss reaches this
  dayProfitTargetRs: number | null = 3500; // stop the day once profit reaches this
  maxTradesPerDay = 3;

  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<SrResponse | null>(null);
  readonly pushing = signal(false);
  readonly tokenNote = signal('');

  // Live announcer — the "brain" narrating what the system is doing. Ephemeral.
  readonly announce = signal<{ icon: string; text: string; tone: string }[]>([]);
  readonly announcing = signal(false);
  private annTimers: ReturnType<typeof setTimeout>[] = [];

  readonly totals = computed(() => {
    const r = this.result();
    if (!r) return null;
    const ok = r.results.filter((x) => !x.error);
    return {
      trades: ok.reduce((a, x) => a + x.summary.trades, 0),
      wins: ok.reduce((a, x) => a + x.summary.wins, 0),
      losses: ok.reduce((a, x) => a + x.summary.losses, 0),
      profit: ok.reduce((a, x) => a + x.summary.totalProfitRupees, 0),
      loss: ok.reduce((a, x) => a + x.summary.totalLossRupees, 0),
      net: ok.reduce((a, x) => a + x.summary.netRupees, 0),
    };
  });

  readonly allTrades = computed(() => {
    const r = this.result();
    if (!r) return [] as SrTrade[];
    return r.results.flatMap((x) => x.trades || []).sort((a, b) => (a.date + a.entryTime < b.date + b.entryTime ? -1 : 1));
  });

  setTab(t: 'paper' | 'live'): void { this.tab.set(t); }
  toggle(key: string): void { this.sel[key] = !this.sel[key]; }

  /** Push the browser's Kite token to the server so Paper works even without
   *  the browser resending it (and for future Live). Encrypted server-side. */
  async pushToken(): Promise<void> {
    this.tokenNote.set('');
    const s = this.kiteSession.storedSession();
    const apiKey = s?.data?.api_key;
    const accessToken = s?.data?.access_token;
    if (!apiKey || !accessToken) { this.tokenNote.set('No Kite session in this browser. Open Get Token first.'); return; }
    this.pushing.set(true);
    try {
      await firstValueFrom(this.http.put(`${this.liveApiBase}/auth`, { apiKey, accessToken }));
      this.tokenNote.set('✓ Kite token pushed to server.');
    } catch (err) {
      const msg = (err as { error?: { message?: string } })?.error?.message;
      this.tokenNote.set(`Push failed: ${msg || 'try again'}`);
    } finally {
      this.pushing.set(false);
    }
  }

  async run(): Promise<void> {
    this.error.set('');
    const chosen = INSTRUMENTS.filter((i) => this.sel[i.key]).map((i) => i.key);
    if (!chosen.length) { this.error.set('Select at least one instrument.'); return; }
    if (!this.fromDate || !this.toDate || this.fromDate > this.toDate) { this.error.set('Pick a valid From → To range.'); return; }

    const body: Record<string, unknown> = {
      instruments: chosen, fromDate: this.fromDate, toDate: this.toDate, lots: Number(this.lots) || 1,
      maxTradesPerDay: Number(this.maxTradesPerDay) || 3,
    };
    if (this.entryPts != null && this.entryPts !== ('' as unknown)) body['entryPts'] = this.entryPts;
    if (this.dayLossStopRs != null && this.dayLossStopRs !== ('' as unknown)) body['dayLossStopRs'] = this.dayLossStopRs;
    if (this.dayProfitTargetRs != null && this.dayProfitTargetRs !== ('' as unknown)) body['dayProfitTargetRs'] = this.dayProfitTargetRs;

    // Send the browser's Kite header when present; otherwise rely on the token
    // pushed to the server. Do NOT block here — let the server decide.
    const kite = this.kiteSession.getAuthorizationHeader();
    const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};

    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<SrResponse>(`${this.liveApiBase}/sr-breakout`, body, { headers }),
      );
      this.result.set(res);
      this.playAnnouncer(res);
    } catch (err) {
      const msg = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(msg || 'Run failed — open Get Token (fresh daily token), Push Token, then retry.');
    } finally {
      this.busy.set(false);
    }
  }

  downloadCsv(): void {
    const trades = this.allTrades();
    if (!trades.length) return;
    const cols = ['date', 'instrument', 'option', 'side', 'confidence', 'entryTime', 'entryPrice', 'level', 'bodyPts', 'target', 'exitTime', 'exitPrice', 'exitReason', 'points', 'rupees'];
    const lines = [cols.join(',')];
    for (const t of trades) lines.push(cols.map((c) => (t as unknown as Record<string, unknown>)[c]).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sr-breakout_${this.fromDate}_${this.toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  fmt(n: number): string { const s = n < 0 ? '-' : ''; return `${s}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`; }

  stars(score: number): string { return '★'.repeat(Math.max(0, Math.min(3, score))) + '☆'.repeat(3 - Math.max(0, Math.min(3, score))); }

  // ── Live announcer ────────────────────────────────────────────────────────
  // Replays the run as a plain-English feed so you can *see* what the brain did:
  // scanning → spotting a break → picking the option → entering → how it exited.
  // Purely visual; nothing is stored. Cadence is faster than real time.
  private clearAnnouncer(): void {
    for (const t of this.annTimers) clearTimeout(t);
    this.annTimers = [];
  }
  private say(lines: { icon: string; text: string; tone: string }[]): void {
    this.clearAnnouncer();
    this.announce.set([]);
    this.announcing.set(true);
    let i = 0;
    const step = () => {
      if (i >= lines.length) { this.announcing.set(false); return; }
      this.announce.update((cur) => [...cur, lines[i]]);
      i += 1;
      this.annTimers.push(setTimeout(step, i < 2 ? 650 : 480));
    };
    step();
  }
  private playAnnouncer(res: SrResponse): void {
    const ok = res.results.filter((r) => !r.error);
    const lines: { icon: string; text: string; tone: string }[] = [];
    const range = res.isToday ? 'today' : `${res.fromDate} → ${res.toDate}`;
    lines.push({ icon: '☀️', text: `A calm ${res.mode} session. Waking up the brain for ${range}…`, tone: 'muted' });
    if (!ok.length) {
      lines.push({ icon: '🌙', text: 'No instruments came back with candles. Push a fresh Kite token and try again.', tone: 'warn' });
      this.say(lines); return;
    }
    for (const r of ok) {
      const label = r.contract && r.contract !== r.name ? `${r.name} (${r.contract})` : r.name;
      lines.push({ icon: '🔍', text: `Scanning ${label} — ${r.candles.toLocaleString('en-IN')} candles for support/resistance breaks…`, tone: 'muted' });
      const shown = r.trades.slice(0, 6);
      for (const t of shown) {
        const opt = t.option === 'CE' ? 'call (CE)' : 'put (PE)';
        lines.push({ icon: t.option === 'CE' ? '📈' : '📉', text: `${t.date} ${t.entryTime} — a ${Math.abs(t.bodyPts)}pt candle broke ${t.side === 'BUY' ? 'resistance' : 'support'}. Looks like a ${opt}.`, tone: 'muted' });
        lines.push({ icon: '🧠', text: `Confidence ${this.stars(t.confidence)} — picking the ${opt}, aiming for ${t.target} pts.`, tone: 'accent' });
        lines.push({ icon: '🟢', text: `Entering at ${t.entryPrice}…`, tone: 'muted' });
        const win = t.points > 0;
        lines.push({
          icon: win ? '✅' : '🔴',
          text: win
            ? `${t.exitReason === 'TARGET' ? 'Target hit' : 'Closed green'} at ${t.exitPrice} — +${t.points} pts (${this.fmt(t.rupees)}).`
            : `Exited at ${t.exitPrice} — ${t.points} pts (${this.fmt(t.rupees)}). Sat through it.`,
          tone: win ? 'good' : 'bad',
        });
      }
      if (r.trades.length > shown.length) lines.push({ icon: '⏩', text: `…and ${r.trades.length - shown.length} more ${label} trades in the table below.`, tone: 'muted' });
      const s = r.summary;
      lines.push({ icon: s.netRupees >= 0 ? '🟩' : '🟥', text: `${r.name} wrapped: ${s.trades} trades, ${s.winPct}% hit, net ${this.fmt(s.netRupees)}.`, tone: s.netRupees >= 0 ? 'good' : 'bad' });
    }
    const tot = this.totals();
    if (tot) lines.push({ icon: '😌', text: `Session done. ${tot.trades} trades across all books — net ${this.fmt(tot.net)}. That's the honest number, after nothing hidden.`, tone: tot.net >= 0 ? 'good' : 'bad' });
    this.say(lines);
  }
}

import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
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
interface ObserverStatus {
  running: boolean; lastPoll: string | null; lastPollStatus: string; idleReason: string | null;
  polls: number; lastSignalId: string | null;
  config?: { MARKET_OPEN: string; MARKET_CLOSE: string; INSTRUMENTS: string[] };
  executionMode?: string;
  liveBrokerOrders?: string;
  dashboard?: {
    today: { signals: number; paperEntries: number; armed: number; open: number; closed?: number; dayPnl?: number; brake?: string | null };
    cumulative: {
      totalSignals: number; optionTradesRecorded: number; closed: number; wins: number; losses: number; winRate: number | null;
      netPnL?: number; avgWin?: number | null; avgLoss?: number | null; profitFactor?: number | null; expectedValue?: number | null; maxDrawdown?: number;
    };
    collection: { signalsRecorded: number; optionTradesRecorded: number; minSampleForFirstValidation: number; recommended: number; optionEdgeStatus: string };
  };
}
interface SrResponse { status: string; mode: string; fromDate: string; toDate: string; isToday: boolean; ranAt: string; results: SrInstrumentResult[]; }
interface AuditCandle {
  time: string; body: number; nearestWall: number | null; wallType: string; distToWall: number | null;
  trend: number | null; threshold: number; reachedThreshold: boolean; brokeWall: boolean; withTrend: boolean;
  signal: boolean; option: string | null; rejection: string | null;
  developing: { finalState: string; developingAt: string | null; thresholdCrossedAt: string | null };
}
interface AuditResult {
  key: string; name: string; error?: string;
  summary?: { completedCandles: number; candidatesReachedThreshold: number; signals: number; rejected: number; rejectionReasons: Record<string, number>; detectorRan: boolean };
  candles?: AuditCandle[];
}
interface AuditResponse { status: string; date: string; results: AuditResult[]; }

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
export class SrBreakoutComponent implements OnDestroy {
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
  readonly audit = signal<AuditResponse | null>(null);
  readonly auditing = signal(false);
  readonly pushing = signal(false);
  readonly tokenNote = signal('');

  // Live announcer — the "brain" narrating what the system is doing. Ephemeral.
  readonly announce = signal<{ icon: string; text: string; tone: string }[]>([]);
  readonly announcing = signal(false);
  private annTimers: ReturnType<typeof setTimeout>[] = [];

  // ── Live watch state (shadow only — never places an order) ──────────────────
  readonly liveOn = signal(false);
  readonly liveResult = signal<SrResponse | null>(null);
  readonly liveTick = signal(0);            // poll counter
  readonly liveAt = signal('');             // last poll clock time
  readonly liveErr = signal('');
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private seenLive = new Set<string>();     // signal keys already narrated
  private readonly LIVE_MS = 60_000;

  // Strike step + Kite symbol root per instrument, for the manual order ticket.
  private readonly TICKET: Record<string, { step: number; root: string }> = {
    nifty: { step: 50, root: 'NIFTY' },
    banknifty: { step: 100, root: 'BANKNIFTY' },
    crude: { step: 50, root: 'CRUDEOILM' },
  };
  readonly liveSignals = computed(() => {
    const r = this.liveResult();
    if (!r) return [] as (SrTrade & { key: string })[];
    return r.results.flatMap((x) => (x.trades || []).map((t) => ({ ...t, key: x.key })))
      .sort((a, b) => (a.entryTime < b.entryTime ? 1 : -1));
  });

  // Backend collector status (Buildia Live Observer) — polled from the server,
  // which is the source of truth. Runs whether or not this tab is open.
  readonly observer = signal<ObserverStatus | null>(null);
  private obsTimer: ReturnType<typeof setInterval> | null = null;

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

  setTab(t: 'paper' | 'live'): void {
    this.tab.set(t);
    if (t === 'live') this.startObserverPoll(); else this.stopObserverPoll();
  }
  toggle(key: string): void { this.sel[key] = !this.sel[key]; }

  // Poll the backend collector status (source of truth; runs server-side).
  private startObserverPoll(): void {
    if (this.obsTimer) return;
    void this.pollObserver();
    this.obsTimer = setInterval(() => void this.pollObserver(), 15_000);
  }
  private stopObserverPoll(): void {
    if (this.obsTimer) { clearInterval(this.obsTimer); this.obsTimer = null; }
  }
  private async pollObserver(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<ObserverStatus>(`${this.liveApiBase}/sr-observe/status`));
      this.observer.set(s);
    } catch { /* leave last status; endpoint may be pre-deploy */ }
  }
  obsPct(): number {
    const d = this.observer()?.dashboard?.collection;
    if (!d) return 0;
    return Math.min(100, Math.round((100 * d.optionTradesRecorded) / d.minSampleForFirstValidation));
  }

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

  /** "Why no trade?" — audit every candle for the chosen date and show why each
   *  was accepted or rejected. Distinguishes NO OPPORTUNITY from a broken detector. */
  async whyNoTrade(): Promise<void> {
    const chosen = INSTRUMENTS.filter((i) => this.sel[i.key]).map((i) => i.key);
    if (!chosen.length) { this.error.set('Select at least one instrument.'); return; }
    this.error.set('');
    this.auditing.set(true);
    const kite = this.kiteSession.getAuthorizationHeader();
    const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};
    try {
      const res = await firstValueFrom(this.http.post<AuditResponse>(
        `${this.liveApiBase}/sr-breakout/debug`, { instruments: chosen, date: this.toDate }, { headers },
      ));
      this.audit.set(res);
    } catch (err) {
      const msg = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(msg || 'Audit failed — push a fresh Kite token and retry.');
    } finally {
      this.auditing.set(false);
    }
  }
  rejectionList(r: AuditResult): { reason: string; n: number }[] {
    const rr = r.summary?.rejectionReasons || {};
    return Object.entries(rr).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n);
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

  ngOnDestroy(): void { this.stopLive(); this.clearAnnouncer(); this.stopObserverPoll(); }

  // ── Live watch (shadow) ─────────────────────────────────────────────────────
  // Polls TODAY's candles on a timer and narrates new signals as they appear.
  // It NEVER places an order — it shows a ticket you submit yourself in Kite.
  toggleLive(): void { this.liveOn() ? this.stopLive() : this.startLive(); }
  startLive(): void {
    const chosen = INSTRUMENTS.filter((i) => this.sel[i.key]).map((i) => i.key);
    if (!chosen.length) { this.liveErr.set('Select at least one instrument first.'); return; }
    this.liveErr.set('');
    this.seenLive.clear();
    this.announce.set([]);
    this.liveOn.set(true);
    this.say([{ icon: '🟢', text: 'Live watch on. I will call every breakout as it forms — you place the orders.', tone: 'accent' }]);
    void this.pollLive();
    this.liveTimer = setInterval(() => void this.pollLive(), this.LIVE_MS);
  }
  stopLive(): void {
    if (this.liveTimer) { clearInterval(this.liveTimer); this.liveTimer = null; }
    if (this.liveOn()) this.pushAnn({ icon: '⏸️', text: 'Live watch paused.', tone: 'muted' });
    this.liveOn.set(false);
  }
  private async pollLive(): Promise<void> {
    const chosen = INSTRUMENTS.filter((i) => this.sel[i.key]).map((i) => i.key);
    const body: Record<string, unknown> = {
      instruments: chosen, fromDate: this.today, toDate: this.today,
      lots: Number(this.lots) || 1, maxTradesPerDay: Number(this.maxTradesPerDay) || 3,
    };
    if (this.entryPts != null && this.entryPts !== ('' as unknown)) body['entryPts'] = this.entryPts;
    const kite = this.kiteSession.getAuthorizationHeader();
    const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};
    try {
      const res = await firstValueFrom(this.http.post<SrResponse>(`${this.liveApiBase}/sr-breakout`, body, { headers }));
      this.liveResult.set(res);
      this.liveTick.update((n) => n + 1);
      this.liveAt.set(new Date().toLocaleTimeString('en-IN', { hour12: false }));
      this.liveErr.set('');
      this.narrateNew(res);
    } catch (err) {
      const msg = (err as { error?: { message?: string } })?.error?.message;
      this.liveErr.set(msg || 'Live poll failed — Get Token (fresh daily), Push Token, then Start again.');
    }
  }
  private narrateNew(res: SrResponse): void {
    const ok = res.results.filter((r) => !r.error);
    let fresh = 0;
    for (const r of ok) {
      for (const t of r.trades || []) {
        const key = `${r.key}|${t.date}|${t.entryTime}`;
        if (this.seenLive.has(key)) continue;
        this.seenLive.add(key); fresh += 1;
        const opt = t.option === 'CE' ? 'call (CE)' : 'put (PE)';
        this.pushAnn({ icon: t.option === 'CE' ? '📈' : '📉', text: `${t.entryTime} ${r.name}: ${Math.abs(t.bodyPts)}pt candle broke ${t.side === 'BUY' ? 'resistance' : 'support'} — ${opt}, confidence ${this.stars(t.confidence)}, aim ${t.target} pts.`, tone: 'accent' });
        this.pushAnn({ icon: '🎫', text: `Ticket ready: ${this.ticketText(t as SrTrade & { key: string })} — place it in Kite when you're happy.`, tone: 'muted' });
      }
    }
    if (!fresh && this.liveTick() > 1) this.pushAnn({ icon: '🫧', text: `${this.liveAt()} — scanned, no new break. Holding.`, tone: 'muted' });
  }
  private pushAnn(a: { icon: string; text: string; tone: string }): void {
    this.announcing.set(true);
    this.announce.update((cur) => [...cur, a]);
    // keep the feed from growing unbounded across a long session
    this.announce.update((cur) => (cur.length > 80 ? cur.slice(cur.length - 80) : cur));
  }

  atmStrike(t: SrTrade & { key: string }): number {
    const step = this.TICKET[t.key]?.step || 50;
    return Math.round(t.entryPrice / step) * step;
  }
  ticketText(t: SrTrade & { key: string }): string {
    const root = this.TICKET[t.key]?.root || t.instrument;
    return `BUY ${this.lots} lot ${root} ${this.atmStrike(t)} ${t.option} (nearest expiry)`;
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

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';

interface SrTrade {
  date: string; instrument: string; side: string; option: string;
  entryTime: string; entryPrice: number; level: number; bodyPts: number;
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
  sel: Record<string, boolean> = { nifty: true, banknifty: true, crude: false };
  lots = 1;
  entryPts: number | null = null;   // blank = use per-instrument default
  bigPts: number | null = null;
  targetPts: number | null = null;  // blank/0 = hold to close

  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<SrResponse | null>(null);

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

  async run(): Promise<void> {
    this.error.set('');
    const chosen = INSTRUMENTS.filter((i) => this.sel[i.key]).map((i) => i.key);
    if (!chosen.length) { this.error.set('Select at least one instrument.'); return; }
    if (!this.fromDate || !this.toDate || this.fromDate > this.toDate) { this.error.set('Pick a valid From → To range.'); return; }
    const kite = this.kiteSession.getAuthorizationHeader();
    if (!kite) { this.error.set('Kite token required — open Get Token, then retry.'); return; }

    const body: Record<string, unknown> = {
      instruments: chosen, fromDate: this.fromDate, toDate: this.toDate, lots: Number(this.lots) || 1,
    };
    if (this.entryPts != null && this.entryPts !== ('' as unknown)) body['entryPts'] = this.entryPts;
    if (this.bigPts != null && this.bigPts !== ('' as unknown)) body['bigPts'] = this.bigPts;
    if (this.targetPts != null && this.targetPts !== ('' as unknown)) body['targetPts'] = this.targetPts;

    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<SrResponse>(`${this.liveApiBase}/sr-breakout`, body, { headers: { 'X-Kite-Authorization': kite } }),
      );
      this.result.set(res);
    } catch (err) {
      const msg = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(msg || 'Run failed. Check the token and try again.');
    } finally {
      this.busy.set(false);
    }
  }

  downloadCsv(): void {
    const trades = this.allTrades();
    if (!trades.length) return;
    const cols = ['date', 'instrument', 'option', 'side', 'entryTime', 'entryPrice', 'level', 'bodyPts', 'exitTime', 'exitPrice', 'exitReason', 'points', 'rupees'];
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
}

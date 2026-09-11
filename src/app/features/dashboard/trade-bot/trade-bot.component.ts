import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { LotsPreferenceService } from '../../../core/services/lots-preference.service';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { AuthService } from '../../../core/auth/auth.service';

interface PaperTrade {
  instrumentName?: string;
  side?: string;
  entryTime?: string;
  exitTime?: string;
  exitReason?: string;
  optionPnlRs?: number | null;
  netOptionPnlRs?: number | null;
  optionSymbol?: string | null;
}

interface PaperTotals {
  trades?: number;
  wins?: number;
  losses?: number;
  optionNetAfterChargesRs?: number;
  optionNetRs?: number;
}

interface PaperResult {
  mode?: string;
  fromDate?: string;
  toDate?: string;
  liveMoney?: boolean;
  realOrders?: boolean;
  totals?: PaperTotals;
  trades?: PaperTrade[];
  message?: string;
}

interface OptionBar {
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  oi?: number;
}

interface OptionLive {
  price?: number | null;
  ohlc?: { open?: number | null; high?: number | null; low?: number | null; close?: number | null };
  bid?: number | null;
  ask?: number | null;
  volume?: number | null;
  oi?: number | null;
}

interface OptionContract {
  tradingSymbol?: string;
  instrumentToken?: number;
  instrumentType?: string;
  strike?: number | null;
  expiry?: string;
  key?: string;
  price?: number | null;
  live?: OptionLive | null;
  historical?: OptionBar[];
  lastBar?: OptionBar | null;
  historicalError?: string;
  dataSource?: string | null;
  intervalUsed?: string | null;
  note?: string | null;
}

interface OptionOhlcResult {
  fromDate?: string | null;
  toDate?: string | null;
  interval?: string | null;
  atm?: boolean;
  spot?: number | null;
  contracts?: OptionContract[];
  message?: string;
}

interface EeWaitSpec {
  entry?: string;
  lookback?: number;
  wait?: number;
  hold?: number;
  stopPct?: number;
  targetPct?: number;
}

interface EeWaitFound {
  fromDate?: string;
  toDate?: string;
  bars?: number;
  note?: string;
  best?: {
    spec?: EeWaitSpec;
    oos?: { trades?: number; points?: number; rupees?: number; wins?: number; losses?: number };
  };
  checks?: {
    btstOvernight?: {
      spec?: EeWaitSpec;
      oos?: {
        trades?: number;
        points?: number;
        rupees?: number;
        profitFactor?: number;
      };
      full?: {
        trades?: number;
        points?: number;
        rupees?: number;
        profitFactor?: number;
        wins?: number;
        losses?: number;
      };
    };
  };
}

interface LiveStatus {
  status?: string;
  message?: string;
  liveMoney?: boolean;
  realOrders?: boolean;
  events?: Array<{ at?: string; action?: string; detail?: string }>;
  totals?: { netRs?: number; trades?: number };
}

function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

@Component({
  selector: 'app-trade-bot',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './trade-bot.component.html',
  styleUrl: './trade-bot.component.css',
})
export class TradeBotComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly lotsPreference = inject(LotsPreferenceService);
  private readonly uiDialog = inject(UiDialogService);
  private readonly auth = inject(AuthService);
  private readonly liveApiBase =
    (environment as { liveApiBaseUrl?: string }).liveApiBaseUrl || '/api/live';

  protected fromDate = istToday();
  protected toDate = istToday();
  protected today = true;
  protected liveMoney = false;
  protected lots = 1;
  protected optionSymbol = '';
  protected optionAtm = false;
  protected optionHistorical = true;
  protected optionLive = true;
  protected optionInterval = '5minute';
  protected optionExpiry = '';

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly paper = signal<PaperResult | null>(null);
  protected readonly live = signal<LiveStatus | null>(null);
  protected readonly optionBusy = signal(false);
  protected readonly optionError = signal('');
  protected readonly optionResult = signal<OptionOhlcResult | null>(null);
  protected readonly researchBusy = signal(false);
  protected readonly researchError = signal('');
  protected readonly research = signal<EeWaitFound | null>(null);

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly allowLiveMoney =
    (environment as { allowLiveMoney?: boolean }).allowLiveMoney !== false;

  ngOnInit(): void {
    const uid = this.auth.currentUser()?.id;
    if (uid) this.kiteSession.bindSiteUser(uid);
    this.lots = this.lotsPreference.get();
    this.applyToday();
    void this.refreshLiveStatus();
  }

  ngOnDestroy(): void {
    this.clearPoll();
  }

  protected onTodayChange(): void {
    this.applyToday();
  }

  protected applyToday(): void {
    if (!this.today) return;
    const d = istToday();
    this.fromDate = d;
    this.toDate = d;
  }

  protected datesIncludeToday(): boolean {
    const t = istToday();
    return !!this.fromDate && !!this.toDate && this.fromDate <= t && this.toDate >= t;
  }

  protected onLotsChange(): void {
    const n = Math.max(1, Math.floor(Number(this.lots)) || 1);
    this.lots = n;
    this.lotsPreference.set(n);
  }

  protected async findEeWait(): Promise<void> {
    this.researchError.set('');
    this.researchBusy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<EeWaitFound>(`${this.liveApiBase}/research/ee-wait`, {
          fromDate: this.today ? '' : this.fromDate,
          toDate: this.today ? '' : this.toDate,
          lots: this.lots,
        }),
      );
      this.research.set(res);
    } catch (err) {
      this.researchError.set(this.fmtErr(err));
    } finally {
      this.researchBusy.set(false);
    }
  }

  protected async run(): Promise<void> {
    this.error.set('');
    this.applyToday();
    if (!this.fromDate || !this.toDate || this.fromDate > this.toDate) {
      this.error.set('Pick a valid From date and To date.');
      return;
    }
    if (this.liveMoney && !this.allowLiveMoney) {
      this.error.set('Live money is disabled in this build.');
      return;
    }
    if (this.liveMoney) {
      const ok = await this.uiDialog.confirm({
        title: 'Place live Kite orders?',
        message:
          'Paper and live use the same engine. Live money is on, so this run will send real orders when the strategy fires.',
        confirmLabel: 'Start live',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) return;
      await this.pushToken();
    }

    const found = this.research()?.best?.spec;
    const body: {
      fromDate: string;
      toDate: string;
      today: boolean;
      liveMoney: boolean;
      realOrders: boolean;
      lots: number;
      niftyLots: number;
      engine?: string;
      eeWait?: EeWaitSpec;
    } = {
      fromDate: this.fromDate,
      toDate: this.toDate,
      today: this.today,
      liveMoney: this.liveMoney,
      realOrders: this.liveMoney,
      lots: this.lots,
      niftyLots: this.lots,
    };
    if (found) {
      body.engine = 'ee-wait';
      body.eeWait = found;
    }
    const kite = this.kiteSession.getAuthorizationHeader();
    const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};

    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<PaperResult & LiveStatus>(`${this.liveApiBase}/start`, body, { headers }),
      );
      if (this.liveMoney) {
        this.paper.set(null);
        this.live.set(res);
        this.startPoll();
      } else {
        this.paper.set(res);
        this.live.set(null);
        this.clearPoll();
      }
    } catch (err) {
      this.error.set(this.fmtErr(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async stopLive(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<LiveStatus>(`${this.liveApiBase}/stop`, {}),
      );
      this.live.set(res);
      this.clearPoll();
    } catch (err) {
      this.error.set(this.fmtErr(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected onOptionSymbolChange(): void {
    if (this.optionSymbol.trim()) this.optionAtm = false;
  }

  protected optionBars(c: OptionContract): OptionBar[] {
    const rows = c.historical || [];
    return rows.length > 250 ? rows.slice(-250) : rows;
  }

  protected async fetchOptionOhlc(): Promise<void> {
    this.optionError.set('');
    this.applyToday();
    if (this.optionHistorical && (!this.fromDate || !this.toDate || this.fromDate > this.toDate)) {
      this.optionError.set('Pick a valid From date and To date for historical OHLC.');
      return;
    }
    const kite = this.kiteSession.getAuthorizationHeader();
    if (this.optionLive && !kite && !this.optionHistorical) {
      this.optionError.set('Live option price needs Get Token. Historical expired candles use NSE and do not.');
      return;
    }
    if (this.optionAtm && !kite) {
      this.optionError.set('ATM Nifty needs a Kite token for live spot.');
      return;
    }
    const body: {
      fromDate: string;
      toDate: string;
      today: boolean;
      historical: boolean;
      live: boolean;
      interval: string;
      atm: boolean;
      oi: boolean;
      tradingSymbol?: string;
      expiryDate?: string;
    } = {
      fromDate: this.fromDate,
      toDate: this.toDate,
      today: this.today,
      historical: this.optionHistorical,
      live: this.optionLive && !!kite,
      interval: this.optionInterval,
      atm: this.optionAtm,
      oi: true,
    };
    const expiry = this.optionExpiry.trim();
    if (expiry) body.expiryDate = expiry;
    const symbol = this.optionSymbol.trim();
    if (symbol) {
      body.tradingSymbol = symbol;
      body.atm = false;
    } else if (!this.optionAtm) {
      this.optionError.set('Type any listed option tradingsymbol, or check ATM Nifty.');
      return;
    }
    const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};
    this.optionBusy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<OptionOhlcResult>(`${this.liveApiBase}/options/ohlc`, body, { headers }),
      );
      this.optionResult.set(res);
    } catch (err) {
      this.optionError.set(this.fmtErr(err));
    } finally {
      this.optionBusy.set(false);
    }
  }

  private async pushToken(): Promise<void> {
    const data = this.kiteSession.getSession()?.data;
    if (!data?.api_key || !data.access_token) return;
    try {
      await firstValueFrom(
        this.http.put(`${this.liveApiBase}/auth`, {
          apiKey: data.api_key,
          accessToken: data.access_token,
        }),
      );
    } catch {
      /* server may already have a pushed token */
    }
  }

  private async refreshLiveStatus(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<LiveStatus>(`${this.liveApiBase}/status`));
      this.live.set(s);
      if (s?.status === 'running') {
        this.startPoll();
      }
    } catch {
      /* idle / not signed in for auto module */
    }
  }

  private startPoll(): void {
    this.clearPoll();
    this.pollTimer = setInterval(() => {
      void this.refreshLiveStatus();
    }, 5000);
  }

  private clearPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private fmtErr(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { message?: string; error?: string } | string;
      if (typeof body === 'string' && body.trim()) return body;
      if (body && typeof body === 'object') {
        return body.message || body.error || err.message || 'Request failed';
      }
      return err.message || 'Request failed';
    }
    return err instanceof Error ? err.message : 'Request failed';
  }
}

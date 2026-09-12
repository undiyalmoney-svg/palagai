import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { LotsPreferenceService } from '../../../core/services/lots-preference.service';
import { CapitalPreferenceService } from '../../../core/services/capital-preference.service';
import { KiteFundsService } from '../../../core/services/kite-funds.service';
import { DEFAULT_TRADING_CAPITAL_RS } from '../../../core/paper-desk/capital-plan.util';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { AuthService } from '../../../core/auth/auth.service';

interface PaperTrade {
  instrumentName?: string;
  side?: string;
  direction?: string;
  entryTime?: string;
  exitTime?: string;
  exitReason?: string;
  open?: boolean;
  optionPnlRs?: number | null;
  netOptionPnlRs?: number | null;
  optionSymbol?: string | null;
  option?: { tradingSymbol?: string; symbol?: string };
  liveWouldTake?: boolean;
  skipReason?: string;
  lots?: number;
}

interface PaperTotals {
  trades?: number;
  wins?: number;
  losses?: number;
  grossProfitRs?: number;
  grossLossRs?: number;
  netRs?: number;
  optionNetAfterChargesRs?: number;
  optionNetRs?: number;
  underlyingPoints?: number;
  profitFactor?: number;
}

interface PaperResult {
  mode?: string;
  engine?: string;
  strategy?: string;
  fromDate?: string;
  toDate?: string;
  liveMoney?: boolean;
  realOrders?: boolean;
  usedFindWindow?: boolean;
  totals?: PaperTotals;
  liveTotals?: PaperTotals;
  trades?: PaperTrade[];
  message?: string;
  note?: string;
  capitalRs?: number;
  maxLots?: number;
  month?: {
    key?: string;
    fromDate?: string;
    mtdRs?: number;
    hadTrade?: boolean;
    locked?: boolean;
    mode?: string;
    rule?: string;
  };
  kiteFunds?: {
    source?: string;
    equityCash?: number;
    equityNet?: number;
    commodityCash?: number;
    commodityNet?: number;
    capitalRs?: number;
    error?: string;
  };
  scanTotals?: PaperTotals;
  allocation?: {
    capitalRs?: number;
    riskPerTradeRs?: number;
    dayRiskRs?: number;
    dayRiskUsedRs?: number;
    taken?: Array<{
      instrumentName?: string;
      bookId?: string;
      direction?: string;
      lots?: number;
      riskRs?: number;
    }>;
    skipped?: Array<{
      instrumentName?: string;
      bookId?: string;
      reason?: string;
      detail?: string;
      riskRs1?: number;
    }>;
  };
  spec?: Record<string, unknown>;
  specText?: string;
  train?: { fromDate?: string; toDate?: string; totals?: PaperTotals };
  books?: Array<{
    id?: string;
    label?: string;
    vehicle?: string;
    sitOut?: boolean;
    status?: string;
    why?: string;
    specText?: string;
    totals?: PaperTotals;
    error?: string;
  }>;
  coreBooks?: Array<{
    id?: string;
    label?: string;
    vehicle?: string;
    sitOut?: boolean;
    status?: string;
    why?: string;
    specText?: string;
    totals?: PaperTotals;
    error?: string;
  }>;
  stocks?: {
    source?: string;
    universe?: string;
    scanned?: number;
    taken?: string[];
    rows?: Array<{
      symbol?: string;
      sitOut?: boolean;
      train?: PaperTotals;
      day?: PaperTotals;
      trades?: number;
    }>;
    error?: string;
  };
  compare?: {
    rule?: string;
    overall?: {
      book?: string;
      bookId?: string;
      strategy?: string;
      strategyId?: string;
      totals?: PaperTotals;
    };
    books?: Array<{
      bookId?: string;
      label?: string;
      winnerId?: string;
      winnerLabel?: string;
      rows?: Array<{
        id?: string;
        label?: string;
        totals?: PaperTotals;
      }>;
    }>;
  };
  instruments?: Array<{
    id?: string;
    instrumentName?: string;
    sitOut?: boolean;
    status?: string;
    trades?: number;
    wins?: number;
    losses?: number;
    grossProfitRs?: number;
    grossLossRs?: number;
    netRs?: number;
    source?: string;
    riskRs?: number;
    why?: string;
  }>;
  protection?: {
    fundsRs?: number;
    capitalRs?: number;
    riskPerTradePct?: number;
    dayRiskPct?: number;
    riskPerTradeRs?: number;
    dayRiskRs?: number;
    dayRiskUsedRs?: number;
    dayRiskLeftRs?: number;
    protectedFloorRs?: number;
    stillProtectedRs?: number;
    monthMtdRs?: number;
    monthLocked?: boolean;
    monthMode?: string | null;
    monthRule?: string | null;
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
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

@Component({
  selector: 'app-trade-bot',
  standalone: true,
  imports: [FormsModule, DecimalPipe, DatePipe, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './trade-bot.component.html',
  styleUrl: './trade-bot.component.css',
})
export class TradeBotComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly lotsPreference = inject(LotsPreferenceService);
  private readonly capitalPreference = inject(CapitalPreferenceService);
  protected readonly kiteFundsSvc = inject(KiteFundsService);
  private readonly uiDialog = inject(UiDialogService);
  private readonly auth = inject(AuthService);
  private readonly liveApiBase =
    (environment as { liveApiBaseUrl?: string }).liveApiBaseUrl || '/api/live';

  protected fromDate = istToday();
  protected toDate = istToday();
  protected today = false;
  protected liveMoney = false;
  protected lots = 1;
  protected capitalRs = DEFAULT_TRADING_CAPITAL_RS;

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly paper = signal<PaperResult | null>(null);
  protected readonly live = signal<LiveStatus | null>(null);

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly allowLiveMoney =
    (environment as { allowLiveMoney?: boolean }).allowLiveMoney !== false;

  ngOnInit(): void {
    const uid = this.auth.currentUser()?.id;
    if (uid) this.kiteSession.bindSiteUser(uid);
    this.lots = this.lotsPreference.get();
    this.capitalRs = this.capitalPreference.get();
    this.setRangeDays(60);
    if (this.today) this.applyToday();
    void this.refreshLiveStatus();
    void this.refreshKiteFunds();
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

  protected onCapitalChange(): void {
    const n = Math.max(10_000, Math.floor(Number(this.capitalRs)) || DEFAULT_TRADING_CAPITAL_RS);
    this.capitalRs = n;
    this.capitalPreference.set(n);
  }

  protected setRangeDays(days: number): void {
    this.today = false;
    this.toDate = istToday();
    const t = new Date(`${this.toDate}T00:00:00+05:30`);
    t.setDate(t.getDate() - Math.max(1, days));
    this.fromDate = t.toISOString().slice(0, 10);
  }

  protected async runTwoMonthBatch(): Promise<void> {
    this.today = false;
    this.liveMoney = false;
    this.setRangeDays(60);
    await this.run();
  }

  protected paperNet(p: PaperResult): number {
    return Number(p.totals?.netRs ?? p.totals?.optionNetAfterChargesRs ?? p.totals?.optionNetRs ?? 0) || 0;
  }

  protected paperProfit(p: PaperResult): number {
    const fromTotals = Number(p.totals?.grossProfitRs);
    if (Number.isFinite(fromTotals) && fromTotals > 0) return fromTotals;
    let sum = 0;
    for (const t of p.trades || []) {
      const n = Number(t.netOptionPnlRs ?? t.optionPnlRs) || 0;
      if (n > 0) sum += n;
    }
    return Math.round(sum);
  }

  protected paperLoss(p: PaperResult): number {
    const fromTotals = Number(p.totals?.grossLossRs);
    if (Number.isFinite(fromTotals) && fromTotals > 0) return fromTotals;
    let sum = 0;
    for (const t of p.trades || []) {
      const n = Number(t.netOptionPnlRs ?? t.optionPnlRs) || 0;
      if (n < 0) sum += Math.abs(n);
    }
    return Math.round(sum);
  }

  protected sizingCapitalRs(): number {
    return this.availableFundsRs() || Math.max(0, Math.floor(Number(this.capitalRs) || 0));
  }

  protected tradeRiskBudgetRs(): number {
    return Math.round(this.sizingCapitalRs() * 0.02);
  }

  protected dayRiskBudgetRs(): number {
    return Math.round(this.sizingCapitalRs() * 0.06);
  }

  protected protectedFloorRs(): number {
    return Math.max(0, this.sizingCapitalRs() - this.dayRiskBudgetRs());
  }

  protected protectionOf(p?: PaperResult | null) {
    if (p?.protection) return p.protection;
    const capital = Number(p?.capitalRs || p?.allocation?.capitalRs) || this.sizingCapitalRs();
    const dayRisk = Number(p?.allocation?.dayRiskRs) || Math.round(capital * 0.06);
    const used = Number(p?.allocation?.dayRiskUsedRs) || 0;
    const trade = Number(p?.allocation?.riskPerTradeRs) || Math.round(capital * 0.02);
    const funds = this.availableFundsRs() || Number(p?.kiteFunds?.equityCash || p?.kiteFunds?.capitalRs) || 0;
    return {
      fundsRs: funds,
      capitalRs: capital,
      riskPerTradePct: 0.02,
      dayRiskPct: 0.06,
      riskPerTradeRs: trade,
      dayRiskRs: dayRisk,
      dayRiskUsedRs: used,
      dayRiskLeftRs: Math.max(0, dayRisk - used),
      protectedFloorRs: Math.max(0, capital - dayRisk),
      stillProtectedRs: Math.max(0, capital - used),
      monthMtdRs: p?.month?.mtdRs || 0,
      monthLocked: !!p?.month?.locked,
      monthMode: p?.month?.mode || null,
      monthRule: p?.month?.rule || null,
    };
  }

  protected instrumentRows(p: PaperResult) {
    if (p.instruments?.length) {
      return p.instruments.filter((r) => r.id !== 'crude' && r.id !== 'stocks');
    }
    const rows: NonNullable<PaperResult['instruments']> = [];
    const fundedKeys = new Set<string>();
    const byName = new Map<string, NonNullable<PaperResult['instruments']>[number]>();
    for (const t of p.trades || []) {
      const key = t.instrumentName || 'book';
      const n = Number(t.netOptionPnlRs ?? t.optionPnlRs) || 0;
      const cur = byName.get(key) || {
        id: key,
        instrumentName: key,
        status: 'taken',
        trades: 0,
        wins: 0,
        losses: 0,
        grossProfitRs: 0,
        grossLossRs: 0,
        netRs: 0,
        riskRs: 0,
        why: 'Taken',
      };
      cur.trades = (cur.trades || 0) + 1;
      cur.netRs = (cur.netRs || 0) + n;
      if (n > 0) {
        cur.wins = (cur.wins || 0) + 1;
        cur.grossProfitRs = (cur.grossProfitRs || 0) + n;
      } else if (n < 0) {
        cur.losses = (cur.losses || 0) + 1;
        cur.grossLossRs = (cur.grossLossRs || 0) + Math.abs(n);
      }
      byName.set(key, cur);
      fundedKeys.add(key);
    }
    for (const id of ['nifty', 'bank']) {
      const b = (p.books || []).find((row) => row.id === id);
      const funded = [...byName.values()].find((r) => r.id === id || r.instrumentName === b?.label);
      if (funded) {
        rows.push({ ...funded, why: b?.why || funded.why });
        continue;
      }
      rows.push({
        id,
        instrumentName: b?.label || id,
        status: 'not-taken',
        trades: 0,
        wins: 0,
        losses: 0,
        grossProfitRs: 0,
        grossLossRs: 0,
        netRs: 0,
        riskRs: 0,
        why: b?.why || 'Not taken',
      });
    }
    for (const row of byName.values()) {
      if (rows.some((r) => r.instrumentName === row.instrumentName)) continue;
      rows.push(row);
    }
    return rows;
  }

  protected get kiteFunds() {
    return this.kiteFundsSvc.funds();
  }

  protected get kiteFundsError() {
    return this.kiteFundsSvc.error();
  }

  protected get fundsBusy() {
    return this.kiteFundsSvc.busy();
  }

  protected availableFundsRs(): number | null {
    const n = this.kiteFundsSvc.equityAvailable();
    return n != null && n > 0 ? n : null;
  }

  protected paperMark(p: PaperResult): number {
    return Math.round((this.availableFundsRs() || Number(p.capitalRs) || 0) + this.paperNet(p));
  }

  protected moneyAfterRs(p: PaperResult): number {
    const prot = this.protectionOf(p);
    const funds = Number(prot.fundsRs || prot.capitalRs) || this.sizingCapitalRs();
    return Math.round(funds + this.paperNet(p));
  }

  protected indexBooks(p: PaperResult): NonNullable<PaperResult['coreBooks']> {
    if (p.coreBooks?.length) return p.coreBooks;
    return (p.books || []).filter((b) => b.id === 'nifty' || b.id === 'bank' || b.id === 'crude');
  }

  protected onRefreshFunds(): void {
    void this.refreshKiteFunds();
  }

  protected tradeSide(t: PaperTrade): string {
    return t.side || t.direction || '';
  }

  protected tradeSymbol(t: PaperTrade): string {
    return t.optionSymbol || t.option?.tradingSymbol || t.option?.symbol || '';
  }

  protected isOpenTrade(t: PaperTrade): boolean {
    return !!(t.open || t.exitReason === 'open');
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
          'Live uses the same paper desk. Short ATM CE+PE only if price is still inside the 15-minute range at 10:00. Breakout days sit out. Late start will not chase. Stocks stay paper.',
        confirmLabel: 'Start live',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) return;
    }
    await this.refreshKiteFunds();

    const body: {
      fromDate: string;
      toDate: string;
      today: boolean;
      liveMoney: boolean;
      realOrders: boolean;
      lots: number;
      niftyLots: number;
      capitalRs: number;
      engine: string;
    } = {
      fromDate: this.fromDate,
      toDate: this.toDate,
      today: this.today,
      liveMoney: this.liveMoney,
      realOrders: this.liveMoney,
      lots: this.lots,
      niftyLots: this.lots,
      capitalRs: this.capitalRs,
      engine: 'paper-desk',
    };
    const kite = this.kiteSession.getAuthorizationHeader();
    const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};

    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<PaperResult & LiveStatus>(`${this.liveApiBase}/start`, body, { headers }).pipe(
          timeout(180_000),
        ),
      );
      if (this.liveMoney) {
        this.paper.set(null);
        this.live.set(res);
        this.startPoll();
      } else {
        this.paper.set(res);
        this.live.set(null);
        this.clearPoll();
        if (res.kiteFunds && (res.kiteFunds.capitalRs || res.kiteFunds.equityCash != null)) {
          this.kiteFundsSvc.apply(res.kiteFunds);
          this.syncCapitalFromFunds();
        }
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

  private async refreshKiteFunds(): Promise<void> {
    await this.kiteFundsSvc.refresh();
    this.syncCapitalFromFunds();
  }

  private syncCapitalFromFunds(): void {
    const n = this.kiteFundsSvc.equityAvailable();
    if (n != null && n > 0) this.capitalRs = n;
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

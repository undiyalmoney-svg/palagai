import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { KiteSessionService } from '../../../core/kite/kite-session.service';
import { CapitalPreferenceService } from '../../../core/services/capital-preference.service';
import { KiteFundsService } from '../../../core/services/kite-funds.service';
import { DEFAULT_TRADING_CAPITAL_RS } from '../../../core/paper-desk/capital-plan.util';
import { lotsFromAvailableFunds } from '../../../core/paper-desk/lots-from-funds';
import {
  computeProtectiveSlTrigger,
  roundOptionPremiumTick,
} from '../../../core/live-desk/option-sl-premium.util';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { AuthService } from '../../../core/auth/auth.service';

interface PaperTrade {
  instrumentName?: string;
  selectedInstrument?: string;
  side?: string;
  sideLabel?: string;
  direction?: string;
  entryTime?: string;
  exitTime?: string;
  entryHm?: string | null;
  exitHm?: string | null;
  entryClock?: string | null;
  exitClock?: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  indexEntry?: number | null;
  indexExit?: number | null;
  exitReason?: string;
  open?: boolean;
  optionPnlRs?: number | null;
  netOptionPnlRs?: number | null;
  optionStrike?: number | null;
  optionEntryPremium?: number | null;
  optionExitPremium?: number | null;
  optionSymbol?: string | null;
  option?: { tradingSymbol?: string; symbol?: string; strike?: number } | null;
  slTrigger?: number | null;
  slPrice?: number | null;
  slOn?: boolean;
  slOrderId?: string | null;
  indexStop?: number | null;
  stopPts?: number | null;
  entryOhlc?: { open: number; high: number; low: number; close: number } | null;
  exitOhlc?: { open: number; high: number; low: number; close: number } | null;
  premiumSource?: string | null;
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
  capitalSource?: 'actual' | 'mine';
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
  running?: boolean;
  message?: string;
  liveMoney?: boolean;
  realOrders?: boolean;
  lastError?: string | null;
  liveAssistant?: { ok?: boolean; checks?: Array<{ id?: string; ok: boolean; detail: string }> };
  events?: Array<{ at?: string; action?: string; detail?: string }>;
  totals?: { netRs?: number; trades?: number };
  trades?: PaperTrade[];
  kitePnl?: { closedRs?: number; openRs?: number; netRs?: number };
  positions?: Array<{
    instrumentId?: string;
    symbol?: string;
    status?: string;
    quantity?: number;
    entryTime?: string | null;
    entryPremium?: number | null;
    slTrigger?: number | null;
    slOrderId?: string | null;
    slOn?: boolean;
  }>;
}

function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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
  private readonly capitalPreference = inject(CapitalPreferenceService);
  protected readonly kiteFundsSvc = inject(KiteFundsService);
  private readonly uiDialog = inject(UiDialogService);
  private readonly auth = inject(AuthService);
  private readonly liveApiBase =
    (environment as { liveApiBaseUrl?: string }).liveApiBaseUrl || '/api/live';

  protected fromDate = '';
  protected toDate = '';
  protected today = false;
  protected liveMoney = false;
  protected fundSource: 'actual' | 'mine' = 'actual';
  protected capitalRs = DEFAULT_TRADING_CAPITAL_RS;
  protected mineFundText = String(DEFAULT_TRADING_CAPITAL_RS);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly paper = signal<PaperResult | null>(null);
  protected readonly live = signal<LiveStatus | null>(null);
  protected readonly liveAssistant = signal<Array<{ id?: string; ok: boolean; detail: string }>>([]);

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly allowLiveMoney =
    (environment as { allowLiveMoney?: boolean }).allowLiveMoney !== false;

  ngOnInit(): void {
    const uid = this.auth.currentUser()?.id;
    if (uid) this.kiteSession.bindSiteUser(uid);
    this.capitalRs = this.capitalPreference.get();
    this.mineFundText = String(this.capitalRs);
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

  protected controlsLocked(): boolean {
    return this.liveMoney || this.busy();
  }

  protected liveHelp(): Array<{ ok: boolean; detail: string }> {
    const rows: Array<{ ok: boolean; detail: string }> = [...this.liveAssistant()];
    const s = this.live();
    if (s?.lastError && !rows.some((r) => r.detail === s.lastError)) {
      rows.push({ ok: false, detail: String(s.lastError) });
    }
    for (const ev of s?.events || []) {
      if (String(ev.action || '').toUpperCase() !== 'ERROR') continue;
      const detail = String(ev.detail || '');
      if (detail && !rows.some((r) => r.detail === detail)) {
        rows.push({ ok: false, detail });
      }
    }
    return rows;
  }

  protected onLiveMoneyChange(): void {
    if (this.liveMoney) this.fundSource = 'actual';
  }

  protected fundMode(): 'actual' | 'mine' {
    return this.liveMoney ? 'actual' : this.fundSource;
  }

  protected systemLots(): number {
    return lotsFromAvailableFunds(this.sizingCapitalRs());
  }

  protected actualFundRs(): number {
    return this.availableFundsRs() || 0;
  }

  protected onMineTyped(raw: string): void {
    this.mineFundText = raw;
    const n = Math.floor(Number(String(raw).replace(/,/g, '').replace(/[^\d]/g, '')));
    if (Number.isFinite(n) && n > 0) this.capitalRs = n;
  }

  protected onCapitalChange(): void {
    const n = Math.max(10_000, Math.floor(Number(this.capitalRs) || DEFAULT_TRADING_CAPITAL_RS));
    this.capitalRs = n;
    this.mineFundText = String(n);
    this.capitalPreference.set(n);
  }

  protected setRangeDays(days: number): void {
    this.today = false;
    this.toDate = istToday();
    const t = new Date(`${this.toDate}T00:00:00+05:30`);
    t.setDate(t.getDate() - Math.max(1, days));
    this.fromDate = t.toISOString().slice(0, 10);
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
    if (this.fundMode() === 'mine') {
      return Math.max(0, Math.floor(Number(this.capitalRs) || 0));
    }
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

  protected optionKind(t: PaperTrade): 'CE' | 'PE' | '' {
    const dir = String(t.direction || '').toUpperCase();
    if (dir === 'CE' || dir === 'PE') return dir;
    const blob = `${t.selectedInstrument || ''} ${t.optionSymbol || ''} ${t.option?.tradingSymbol || ''}`.toUpperCase();
    if (/\bCE\b/.test(blob) || /CE$/.test(blob.trim())) return 'CE';
    if (/\bPE\b/.test(blob) || /PE$/.test(blob.trim())) return 'PE';
    return '';
  }

  protected tradeSide(t: PaperTrade): string {
    if (t.sideLabel) return t.sideLabel;
    const kind = this.optionKind(t);
    if (kind) return `${kind} BUY`;
    return t.side || t.direction || '';
  }

  protected tradeSymbol(t: PaperTrade): string {
    return t.optionSymbol || t.option?.tradingSymbol || t.option?.symbol || '';
  }

  protected optionStrike(t: PaperTrade): number | null {
    if (t.optionStrike != null && Number.isFinite(Number(t.optionStrike))) {
      return Math.round(Number(t.optionStrike));
    }
    if (t.option?.strike != null && Number.isFinite(Number(t.option.strike))) {
      return Math.round(Number(t.option.strike));
    }
    const px = Number(t.indexEntry);
    if (!Number.isFinite(px) || px < 10000) return null;
    const name = `${t.instrumentName || ''} ${t.selectedInstrument || ''}`.toLowerCase();
    const step = name.includes('bank') ? 100 : 50;
    return Math.round(px / step) * step;
  }

  protected optionFillPrice(t: PaperTrade, which: 'entry' | 'exit'): number | null {
    const ohlc = which === 'entry' ? t.entryOhlc : t.exitOhlc;
    if (ohlc && Number(ohlc.close) > 0 && Number(ohlc.close) < 10000) return Number(ohlc.close);
    const prem = which === 'entry' ? t.optionEntryPremium : t.optionExitPremium;
    if (prem != null && Number(prem) > 0 && Number(prem) < 10000) return Number(prem);
    const px = which === 'entry' ? t.entryPrice : t.exitPrice;
    const idx = which === 'entry' ? t.indexEntry : t.indexExit;
    const n = Number(px);
    if (Number.isFinite(n) && n > 0 && n < 10000) return n;
    if (Number.isFinite(Number(idx)) && Number(idx) >= 10000) return null;
    return Number.isFinite(n) && n > 0 && n < 10000 ? n : null;
  }

  protected ohlcLine(t: PaperTrade, which: 'entry' | 'exit'): string | null {
    const ohlc = which === 'entry' ? t.entryOhlc : t.exitOhlc;
    if (!ohlc) return null;
    const parts = [ohlc.open, ohlc.high, ohlc.low, ohlc.close].map((n) => Number(n));
    if (parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
    return parts.map((n) => n.toFixed(2)).join(' / ');
  }

  protected optionLabel(t: PaperTrade): string {
    const kind = this.optionKind(t);
    const strike = this.optionStrike(t);
    if (strike != null && kind) return `${strike} ${kind}`;
    return this.selectedInstrument(t);
  }

  protected formatTradeWhen(iso?: string | null, clock?: string | null): string {
    const parts = this.formatIstParts(iso);
    const hms = clock && /\d:\d{2}:\d{2}/.test(clock) ? clock : parts?.clock;
    if (parts?.date && hms) return `${parts.date}, ${hms}`;
    return hms || parts?.date || '—';
  }

  protected selectedInstrument(t: PaperTrade): string {
    const kite = t.option?.tradingSymbol || t.option?.symbol || '';
    if (kite && /\d{4,}(CE|PE)$/i.test(kite)) return kite;
    const kind = this.optionKind(t);
    const strike = this.optionStrike(t);
    if (t.instrumentName && strike != null && kind) {
      return `${t.instrumentName} ${strike} ${kind}`;
    }
    const raw = String(t.selectedInstrument || t.optionSymbol || '')
      .replace(/\s*\(index×lot\)\s*$/i, '')
      .trim();
    if (raw) return raw;
    if (t.instrumentName && kind) return `${t.instrumentName} ATM ${kind}`;
    return t.instrumentName || '—';
  }

  protected formatIstParts(value?: string | null): { date: string; clock: string } | null {
    if (!value) return null;
    const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    const hm = String(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let hour: number;
    let min: string;
    let sec: string;
    let date = '';
    if (iso) {
      date = `${Number(iso[3])} ${months[Number(iso[2]) - 1]} ${iso[1]}`;
      hour = Number(iso[4]);
      min = iso[5];
      sec = (iso[6] || '00').padStart(2, '0');
    } else if (hm) {
      hour = Number(hm[1]);
      min = hm[2];
      sec = (hm[3] || '00').padStart(2, '0');
    } else {
      return null;
    }
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour %= 12;
    if (hour === 0) hour = 12;
    return { date, clock: `${hour}:${min}:${sec} ${ampm}` };
  }

  protected formatIstDate(value?: string | null): string {
    return this.formatIstParts(value)?.date || '—';
  }

  protected formatIstClock(value?: string | null, fallback?: string | null): string {
    if (fallback && /\d:\d{2}:\d{2}/.test(fallback)) return fallback;
    const parts = this.formatIstParts(value);
    if (parts?.clock) return parts.clock;
    return '—';
  }

  protected formatIst(value?: string | null): string {
    const parts = this.formatIstParts(value);
    if (!parts) return value ? String(value) : '—';
    return parts.date ? `${parts.date}, ${parts.clock}` : parts.clock;
  }

  protected formatPrice(value?: number | null): string {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected tradeSl(t: PaperTrade): number | null {
    for (const v of [t.slTrigger, t.slPrice]) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const fill = this.optionFillPrice(t, 'entry');
    if (!(fill && fill > 0)) return null;
    const bank = /bank/i.test(`${t.instrumentName || ''} ${t.selectedInstrument || ''}`);
    const lots = Math.max(1, Number(t.lots) || 1);
    const lotUnits = (bank ? 30 : 65) * lots;
    const indexRisk =
      t.indexStop != null && t.indexEntry != null
        ? Math.abs(Number(t.indexEntry) - Number(t.indexStop))
        : Number(t.stopPts) || 0;
    let trigger = computeProtectiveSlTrigger({
      fillPremium: fill,
      indexRiskPts: Math.max(0, indexRisk),
      exchange: 'NFO',
      tradingSymbol: this.tradeSymbol(t),
      ltp: fill,
      maxLossRs: bank ? 0 : 5000 * lots,
      lotUnits,
    });
    if (!(trigger > 0)) trigger = roundOptionPremiumTick(fill * 0.9);
    if (trigger >= fill) trigger = roundOptionPremiumTick(Math.max(0.05, fill * 0.9));
    return trigger > 0 ? trigger : null;
  }

  protected slLabel(t: PaperTrade): string {
    const sl = this.tradeSl(t);
    return sl != null ? `₹${this.formatPrice(sl)}` : '—';
  }

  protected resultBoard(): PaperResult | null {
    if (this.liveMoney) {
      const live = this.live();
      if (!live) return null;
      const trades = live.trades?.length ? live.trades : this.tradesFromLive(live);
      const running = live.status === 'running' || !!live.running;
      if (!running && !trades.length) return null;
      const net = Number(live.kitePnl?.netRs);
      const profit = this.paperProfit({ trades });
      const loss = this.paperLoss({ trades });
      return {
        fromDate: istToday(),
        toDate: istToday(),
        liveMoney: true,
        trades,
        totals: {
          netRs: Number.isFinite(net) ? net : this.paperNet({ trades }),
          grossProfitRs: profit,
          grossLossRs: loss,
        },
        note: live.message || undefined,
      };
    }
    return this.paper();
  }

  protected tradesFromLive(s: LiveStatus): PaperTrade[] {
    return (s.positions || []).map((p) => ({
      instrumentName: p.instrumentId === 'bank-nifty' ? 'Bank Nifty' : 'Nifty 50',
      selectedInstrument: p.symbol || null,
      optionSymbol: p.symbol || null,
      entryTime: p.entryTime || undefined,
      entryPrice: p.entryPremium ?? null,
      optionEntryPremium: p.entryPremium ?? null,
      slTrigger: p.slTrigger ?? null,
      slOn: !!p.slOn,
      lots: 1,
      open: p.status === 'open',
      exitReason: p.status === 'open' ? (p.slOn ? 'OPEN' : 'OPEN · SL missing') : p.status,
    }));
  }

  protected isOpenTrade(t: PaperTrade): boolean {
    return !!(t.open || String(t.exitReason || '').toUpperCase().startsWith('OPEN'));
  }

  protected async run(): Promise<void> {
    this.error.set('');
    this.liveAssistant.set([]);
    if (this.liveMoney) {
      this.fundSource = 'actual';
    } else {
      this.applyToday();
      if (!this.fromDate || !this.toDate || this.fromDate > this.toDate) {
        this.error.set('Pick a From date and To date, or check Today.');
        return;
      }
    }
    if (this.liveMoney && !this.allowLiveMoney) {
      this.error.set('Live money is disabled in this build.');
      return;
    }
    if (this.liveMoney) {
      const ok = await this.uiDialog.confirm({
        title: 'Place live Kite orders?',
        message:
          'Live places real MIS buys on Nifty + Bank S/R signals (one ATM CE or PE). It does not sell a straddle. Day ±₹3,500. Crude stays off.',
        confirmLabel: 'Start live',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) return;
    }
    await this.kiteFundsSvc.pushToken();
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
      capitalSource: 'actual' | 'mine';
      engine: string;
    } = {
      fromDate: this.fromDate,
      toDate: this.toDate,
      today: this.liveMoney ? true : this.today,
      liveMoney: this.liveMoney,
      realOrders: this.liveMoney,
      lots: this.systemLots(),
      niftyLots: this.systemLots(),
      capitalRs: this.capitalRs,
      capitalSource: this.fundMode(),
      engine: 'sr-desk',
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
        this.liveAssistant.set(res.liveAssistant?.checks || []);
        this.startPoll();
      } else {
        this.paper.set(res);
        this.live.set(null);
        this.clearPoll();
        if (res.kiteFunds && (res.kiteFunds.capitalRs || res.kiteFunds.equityCash != null)) {
          this.kiteFundsSvc.apply(res.kiteFunds);
        }
      }
    } catch (err) {
      this.error.set(this.fmtErr(err));
      this.applyAssistantFromErr(err);
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
  }

  private async refreshLiveStatus(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<LiveStatus>(`${this.liveApiBase}/status`));
      this.live.set(s);
      const checks = s?.liveAssistant?.checks;
      if (checks?.length) this.liveAssistant.set(checks);
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

  private applyAssistantFromErr(err: unknown): void {
    if (!(err instanceof HttpErrorResponse)) return;
    const body = err.error as LiveStatus | { liveAssistant?: LiveStatus['liveAssistant'] };
    const checks = body && typeof body === 'object' ? body.liveAssistant?.checks : null;
    if (checks?.length) this.liveAssistant.set(checks);
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

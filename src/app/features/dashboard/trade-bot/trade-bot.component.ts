import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { firstValueFrom, timeout, Subscription } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth/auth.service';
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
import { toErrorText } from '../../../core/utils/kite-error.util';
import { SrStructureChartComponent, SrChartBar, SrStructureBox } from './sr-structure-chart.component';

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
  quantity?: number | null;
  level?: number | null;
  wallHi?: number | null;
  wallLo?: number | null;
  structure?: SrStructureBox | null;
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
  deskChart?: { books?: Array<{ id?: string; label?: string; days?: Record<string, SrChartBar[]>; trades?: PaperTrade[] }> };
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
    trades?: PaperTrade[];
    chart?: { id?: string; label?: string; days?: Record<string, SrChartBar[]>; trades?: PaperTrade[] };
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
  lastTickAt?: string | null;
  liveAssistant?: { ok?: boolean; checks?: Array<{ id?: string; ok: boolean; detail: string }> };
  events?: Array<{ at?: string; action?: string; detail?: string }>;
  totals?: { netRs?: number; trades?: number };
  trades?: PaperTrade[];
  kitePnl?: { closedRs?: number; openRs?: number; netRs?: number };
  deskChart?: PaperResult['deskChart'];
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

const TRADE_COL_STORE = 'palagai_trade_bot_cols';
const CRUDE_COL_STORE = 'palagai_crude_bot_cols';
const TRADE_COLS = [
  { id: 'entryTime', label: 'Entry time' },
  { id: 'exitTime', label: 'Exit time' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'option', label: 'Option' },
  { id: 'qty', label: 'Qty' },
  { id: 'side', label: 'Side' },
  { id: 'in', label: 'In' },
  { id: 'sl', label: 'SL ₹' },
  { id: 'out', label: 'Out' },
  { id: 'lots', label: 'Lots' },
  { id: 'pnl', label: '₹' },
  { id: 'why', label: 'Why' },
] as const;
type TradeColId = (typeof TRADE_COLS)[number]['id'];

@Component({
  selector: 'app-trade-bot',
  standalone: true,
  imports: [FormsModule, DecimalPipe, MatButtonModule, SrStructureChartComponent],
  templateUrl: './trade-bot.component.html',
  styleUrl: './trade-bot.component.css',
})
export class TradeBotComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly kiteSession = inject(KiteSessionService);
  private readonly capitalPreference = inject(CapitalPreferenceService);
  protected readonly kiteFundsSvc = inject(KiteFundsService);
  private readonly uiDialog = inject(UiDialogService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  protected readonly deskKind = toSignal(
    this.route.data.pipe(map((d) => (d['desk'] === 'crude' ? 'crude' : 'trade'))),
    { initialValue: this.route.snapshot.data['desk'] === 'crude' ? 'crude' : 'trade' },
  );
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
  protected readonly tradeCols = TRADE_COLS;
  protected readonly hiddenCols = signal<Set<string>>(new Set());
  protected readonly selectedTradeKey = signal<string>('');

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private deskSub: Subscription | null = null;

  protected readonly allowLiveMoney =
    (environment as { allowLiveMoney?: boolean }).allowLiveMoney !== false;

  ngOnInit(): void {
    const uid = this.auth.currentUser()?.id;
    if (uid) this.kiteSession.bindSiteUser(uid);
    this.capitalRs = this.capitalPreference.get();
    this.mineFundText = String(this.capitalRs);
    this.loadHiddenCols();
    this.deskSub = this.route.data.subscribe(() => {
      this.paper.set(null);
      this.live.set(null);
      this.error.set('');
      this.liveAssistant.set([]);
      this.loadHiddenCols();
      void this.refreshLiveStatus();
    });
    void this.refreshKiteFunds();
  }

  ngOnDestroy(): void {
    this.clearPoll();
    this.deskSub?.unsubscribe();
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

  protected liveSessionOn(): boolean {
    const s = this.live();
    return this.liveMoney || this.liveIsRunning(s);
  }

  protected liveIsRunning(s?: LiveStatus | null): boolean {
    if (!s) return false;
    return s.status === 'running' || !!s.running || s.liveMoney === true;
  }

  /** Newest 40 — the payload used to be 80 and the template took slice(0, 40). */
  protected liveLogEvents(s: LiveStatus): Array<{ at?: string; action?: string; detail?: string }> {
    const ev = s.events || [];
    return ev.slice(-40);
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
    return lotsFromAvailableFunds(this.sizingCapitalRs(), this.isCrudeDesk() ? 'crude' : 'index');
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

  protected isCrudeDesk(): boolean {
    return this.deskKind() === 'crude';
  }

  protected deskTitle(): string {
    return this.isCrudeDesk() ? 'Crude Bot' : 'Trade Bot';
  }

  protected deskLede(): string {
    return this.isCrudeDesk()
      ? 'Only Crude Oil Mini ATM PE after NSE close. Session OR 09:00–09:30 (skip if wider than 60 pts), confirm, 16:00–19:00, max 2/day. Afternoon CE is off. Paper ₹ is Mini points × ₹10 × lots. In/Out are the Mini future prints for that ₹. Live buys one ATM PE from Kite — never the future print.'
      : 'Only Nifty 50 and Bank Nifty. With-trend S/R wall break + retest, up to two ATM CE or PE per book per day (qty 65 / 30, MIS). Holds ~30 minutes (6×5m TIME) unless the rupee stop hits first (Nifty ₹5,000 / Bank ₹2,500), the trade makes no +12 index pts by bar 4 (give-up), or the index completes the measured-move the chart draws. Bank does not buy CE below the day open or PE above it. Not FAIL on a 1-bar close through the wall, not a +20 index TARGET. Paper ₹ is CE/PE × lot. Live rests an option SL.';
  }

  protected tradesHint(): string {
    return this.isCrudeDesk()
      ? 'Paper ₹ is Mini points × ₹10 × lots (see Why for fut pts). In/Out are the future prints. Option premium is the small OHLC under In/Out. Hide extra columns if the table is wide; scroll sideways for the rest.'
      : 'Yes — every fill has a protective SL. Paper ₹ is CE/PE × lot like Live. Pink/teal boxes are the engine wall, not a UI overlay. Live takes the same engine row Paper is in (enter if still OPEN, stay flat if Paper already exited). Hide extra columns if the table is wide; scroll sideways for the rest.';
  }

  protected colStoreKey(): string {
    return this.isCrudeDesk() ? CRUDE_COL_STORE : TRADE_COL_STORE;
  }

  protected instrumentRows(p: PaperResult) {
    if (p.instruments?.length) {
      if (this.isCrudeDesk()) {
        return p.instruments.filter((r) => r.id === 'crude' || r.id === 'crude-oil-mini');
      }
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
    for (const id of this.isCrudeDesk() ? ['crude'] : ['nifty', 'bank']) {
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
    const fromField = Number(t.optionStrike);
    if (fromField > 0) return Math.round(fromField);
    const nested = Number(t.option?.strike);
    if (nested > 0) return Math.round(nested);
    const fromSym = String(t.optionSymbol || t.option?.tradingSymbol || '').match(/(\d{3,5})(CE|PE)$/i);
    if (fromSym && Number(fromSym[1]) > 0) return Number(fromSym[1]);
    const px = Number(t.indexEntry);
    if (!Number.isFinite(px) || px <= 0) return null;
    const name = `${t.instrumentName || ''} ${t.selectedInstrument || ''}`.toLowerCase();
    const crude = this.isCrudeDesk() || name.includes('crude');
    if (!crude && px < 10000) return null;
    const step = name.includes('bank') ? 100 : crude ? 50 : 50;
    return Math.round(px / step) * step;
  }

  protected optionFillPrice(t: PaperTrade, which: 'entry' | 'exit'): number | null {
    const ohlc = which === 'entry' ? t.entryOhlc : t.exitOhlc;
    if (ohlc && Number(ohlc.close) > 0 && Number(ohlc.close) < 2500) return Number(ohlc.close);
    const prem = which === 'entry' ? t.optionEntryPremium : t.optionExitPremium;
    const px = which === 'entry' ? t.entryPrice : t.exitPrice;
    const idx = which === 'entry' ? t.indexEntry : t.indexExit;
    const pick = (n: number | null | undefined) => {
      const v = Number(n);
      if (!Number.isFinite(v) || v <= 0 || v >= 2500) return null;
      if (/FUT/i.test(this.tradeSymbol(t) + ' ' + (t.selectedInstrument || ''))) return null;
      if (Number(idx) > 0 && v > Number(idx) * 0.35) return null;
      return v;
    };
    return pick(ohlc?.close) ?? pick(prem) ?? pick(px);
  }

  protected indexFillPrice(t: PaperTrade, which: 'entry' | 'exit'): number | null {
    const v = Number(which === 'entry' ? t.indexEntry : t.indexExit);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  protected displayFillPrice(t: PaperTrade, which: 'entry' | 'exit'): number | null {
    if (this.isCrudeDesk()) return this.indexFillPrice(t, which);
    return this.optionFillPrice(t, which);
  }

  protected ohlcLine(t: PaperTrade, which: 'entry' | 'exit'): string | null {
    const ohlc = which === 'entry' ? t.entryOhlc : t.exitOhlc;
    if (!ohlc) return null;
    const parts = [ohlc.open, ohlc.high, ohlc.low, ohlc.close].map((n) => Number(n));
    if (parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
    if (Math.max(...parts) - Math.min(...parts) < 0.001) return null;
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
    const fill = this.optionFillPrice(t, 'entry');
    for (const v of [t.slTrigger, t.slPrice]) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (fill && n >= fill) continue;
      if (n >= 2500) continue;
      return n;
    }
    if (!(fill && fill > 0)) return null;
    const name = `${t.instrumentName || ''} ${t.selectedInstrument || ''}`.toLowerCase();
    const bank = /bank/i.test(name);
    const crude = this.isCrudeDesk() || name.includes('crude');
    const lots = Math.max(1, Number(t.lots) || 1);
    const lotUnits = (bank ? 30 : crude ? 10 : 65) * lots;
    const indexRisk =
      t.indexStop != null && t.indexEntry != null
        ? Math.abs(Number(t.indexEntry) - Number(t.indexStop))
        : Number(t.stopPts) || 0;
    let trigger = computeProtectiveSlTrigger({
      fillPremium: fill,
      indexRiskPts: Math.max(0, indexRisk),
      exchange: crude ? 'MCX' : 'NFO',
      tradingSymbol: this.tradeSymbol(t),
      ltp: fill,
      maxLossRs: (bank ? 0 : crude ? 2500 : 5000) * lots,
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

  protected colOn(id: string): boolean {
    return !this.hiddenCols().has(id);
  }

  protected toggleCol(id: string): void {
    const next = new Set(this.hiddenCols());
    if (next.has(id)) next.delete(id);
    else {
      const visible = TRADE_COLS.filter((c) => !next.has(c.id)).length;
      if (visible <= 1) return;
      next.add(id);
    }
    this.hiddenCols.set(next);
    this.saveHiddenCols();
  }

  protected visibleColCount(): number {
    return TRADE_COLS.filter((c) => this.colOn(c.id)).length;
  }

  private loadHiddenCols(): void {
    try {
      const raw = localStorage.getItem(this.colStoreKey());
      if (!raw) return;
      const ids = JSON.parse(raw) as string[];
      if (!Array.isArray(ids)) return;
      const allowed = new Set(TRADE_COLS.map((c) => c.id));
      this.hiddenCols.set(new Set(ids.filter((id) => allowed.has(id as TradeColId))));
    } catch {
      /* ignore */
    }
  }

  private saveHiddenCols(): void {
    try {
      localStorage.setItem(this.colStoreKey(), JSON.stringify([...this.hiddenCols()]));
    } catch {
      /* ignore */
    }
  }

  protected tradeKey(t: PaperTrade, index: number): string {
    return `${t.instrumentName || ''}|${t.entryTime || t.entryHm || ''}|${index}`;
  }

  protected tradeQty(t: PaperTrade): number {
    const q = Number(t.quantity);
    if (Number.isFinite(q) && q > 0) return q;
    const lots = Math.max(1, Number(t.lots) || 1);
    const name = `${t.instrumentName || ''} ${t.selectedInstrument || ''}`.toLowerCase();
    if (/bank/i.test(name)) return 30 * lots;
    if (this.isCrudeDesk() || name.includes('crude')) return 10 * lots;
    return 65 * lots;
  }

  protected selectTrade(t: PaperTrade, index: number): void {
    this.selectedTradeKey.set(this.tradeKey(t, index));
  }

  protected chartModel(): { bars: SrChartBar[]; structure: SrStructureBox | null; title: string; subtitle: string } | null {
    if (this.isCrudeDesk()) return null;
    const board = this.resultBoard();
    if (!board) return null;
    const trades = board.trades || [];
    const key = this.selectedTradeKey();
    let picked = trades.find((t, i) => this.tradeKey(t, i) === key);
    if (!picked) picked = trades.find((t) => t.structure) || trades[0];
    if (!picked) return null;
    const day = String(picked.entryTime || picked.exitTime || board.toDate || '').slice(0, 10);
    const books = [
      ...(board.deskChart?.books || []),
      ...((board.books || []).map((b) => b.chart).filter(Boolean) as NonNullable<PaperResult['books']>[number]['chart'][]),
    ];
    const live = this.live();
    if (live?.deskChart?.books) books.push(...live.deskChart.books);
    const name = picked.instrumentName || '';
    const book = books.find((b) => b && (b.label === name || (name.includes('Bank') && b.id === 'bank') || (!name.includes('Bank') && (b.id === 'nifty' || b.label === 'Nifty 50'))));
    const bars = (day && book?.days?.[day]) || Object.values(book?.days || {})[0] || [];
    const structure = picked.structure
      || (book?.trades || []).find((row) => String(row.entryTime || '') === String(picked.entryTime || picked.entryHm || ''))?.structure
      || null;
    if (!bars.length && !structure) return null;
    const why = picked.exitReason || (picked.open ? 'OPEN' : '');
    return {
      bars,
      structure: structure || null,
      title: `${name || 'Index'} 5m`,
      subtitle: `${picked.optionSymbol || picked.selectedInstrument || ''} · ${why}`.trim(),
    };
  }

  protected resultBoard(): PaperResult | null {
    const live = this.live();
    const showLive =
      this.liveMoney
      || this.liveIsRunning(live)
      || (!this.paper() && !!(live?.trades?.length || live?.events?.length || live?.positions?.length));
    if (showLive && live) {
      const trades = live.trades?.length ? live.trades : this.tradesFromLive(live);
      const running = this.liveIsRunning(live);
      if (!running && !trades.length && !live.events?.length) return this.paper();
      const net = Number(live.kitePnl?.netRs);
      const profit = this.paperProfit({ trades });
      const loss = this.paperLoss({ trades });
      return {
        fromDate: istToday(),
        toDate: istToday(),
        liveMoney: true,
        trades,
        deskChart: live.deskChart,
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
      selectedInstrument: p.symbol || undefined,
      optionSymbol: p.symbol || undefined,
      entryTime: p.entryTime || undefined,
      entryPrice: p.entryPremium ?? null,
      optionEntryPremium: p.entryPremium ?? null,
      slTrigger: p.slTrigger ?? null,
      slOn: !!p.slOn,
      lots: 1,
      open: p.status === 'open',
      exitReason: p.status === 'open' ? (p.slOn ? 'OPEN' : 'OPEN · SL missing') : (p.status || undefined),
    }));
  }

  protected isOpenTrade(t: PaperTrade): boolean {
    return !!(t.open || String(t.exitReason || '').toUpperCase().startsWith('OPEN'));
  }

  protected tradePnlRs(t: PaperTrade): number | null {
    const n = t.netOptionPnlRs ?? t.optionPnlRs;
    if (n == null || n === ('' as unknown)) return null;
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
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
        title: this.isCrudeDesk() ? 'Place live Crude Mini orders?' : 'Place live Kite orders?',
        message: this.isCrudeDesk()
          ? 'Live places a real MIS buy on one Crude Oil Mini ATM CE or PE when the Nifty/Bank-style retest fires. Not the future print. Not Nifty or Bank. Protective option SL. Day ±₹3,500.'
          : 'Live places real MIS buys on Nifty + Bank S/R wall-break + retest (up to two ATM CE or PE per book per day, S/R box hold). It does not sell a straddle. Day ±₹3,500. Crude stays off.',
        confirmLabel: 'Start live',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this.busy.set(true);
    this.cdr.detectChanges();
    try {
      if (this.liveMoney) {
        await this.kiteFundsSvc.refresh();
      }

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
        engine: this.isCrudeDesk() ? 'crude-desk' : 'sr-desk',
      };
      const kite = this.kiteSession.getAuthorizationHeader();
      const headers: Record<string, string> = kite ? { 'X-Kite-Authorization': kite } : {};

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
    this.cdr.detectChanges();
    this.error.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<LiveStatus>(`${this.liveApiBase}/stop`, this.isCrudeDesk() ? { engine: 'crude-desk' } : {}),
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
      const s = await firstValueFrom(
        this.http.get<LiveStatus>(
          this.isCrudeDesk() ? `${this.liveApiBase}/status?desk=crude` : `${this.liveApiBase}/status`,
        ),
      );
      this.live.set(s);
      const checks = s?.liveAssistant?.checks;
      if (checks?.length) this.liveAssistant.set(checks);
      this.attachLiveFromStatus(s);
      this.cdr.detectChanges();
    } catch {
      /* idle / not signed in for auto module */
    }
  }

  private attachLiveFromStatus(s: LiveStatus): void {
    if (this.liveIsRunning(s)) {
      this.liveMoney = true;
      this.fundSource = 'actual';
      this.startPoll();
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
      const body = err.error as { message?: unknown; error?: unknown } | string | null;
      const fromBody = toErrorText(
        body && typeof body === 'object'
          ? body.message ?? body.error ?? body
          : body,
      );
      if (fromBody) return fromBody;
      if (err.status === 504 || err.status === 502) {
        return 'Paper timed out reaching the trading server. Use Last 60 days, or retry.';
      }
      if (err.status === 0) return 'Paper: network error — Get Token and retry.';
      return `Paper failed (HTTP ${err.status}).`;
    }
    const text = toErrorText(err);
    if (/Timeout/i.test(text)) {
      return 'Paper timed out in the browser. Use Last 60 days, or retry.';
    }
    return text || 'Paper request failed.';
  }
}

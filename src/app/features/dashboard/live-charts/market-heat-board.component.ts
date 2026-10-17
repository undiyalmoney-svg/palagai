import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { MarketDeskApiService } from '../../../core/market-desk/market-desk-api.service';
import {
  BehaviourFlow,
  DEFAULT_DESK_SETTINGS,
  MarketBehaviour,
  MarketDeskAlert,
  MarketDeskCandles,
  MarketDeskSettings,
  MarketDeskSnapshot,
  MarketIndexCard,
} from '../../../core/market-desk/market-desk.models';
import { DeskCandleChartComponent } from './desk-candle-chart.component';
import { NeuralFlowComponent } from './neural-flow.component';

type DeskFilter =
  | 'all'
  | 'bullish'
  | 'bearish'
  | 'sideways'
  | 'break15'
  | 'break60'
  | 'agree';

const SETTINGS_KEY = 'palagai.market-desk.settings';
const ALERT_KEY = 'palagai.market-desk.alerts';
const RUNNING_KEY = 'palagai.market-desk.running';

@Component({
  selector: 'app-market-heat-board',
  standalone: true,
  imports: [DecimalPipe, RouterLink, DeskCandleChartComponent, NeuralFlowComponent],
  templateUrl: './market-heat-board.component.html',
  styleUrl: './market-heat-board.component.css',
})
export class MarketHeatBoardComponent implements OnInit {
  private readonly api = inject(MarketDeskApiService);
  private readonly auth = inject(AuthService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  protected readonly snap = signal<MarketDeskSnapshot | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly clock = signal('');
  protected readonly query = signal('');
  protected readonly sortPct = signal(true);
  protected readonly filter = signal<DeskFilter>('all');
  protected readonly showSettings = signal(false);
  protected readonly settings = signal<MarketDeskSettings>(this.loadSettings());
  protected readonly selected = signal<string>('NIFTY50');
  protected readonly primary = signal<'5minute' | '15minute' | '60minute' | 'day'>(this.loadSettings().primaryTimeframe);
  protected readonly chartIv = signal<'5minute' | '15minute' | '60minute' | 'day'>('15minute');
  protected readonly timeframes = [
    { id: '5minute' as const, label: '5m' },
    { id: '15minute' as const, label: '15m' },
    { id: '60minute' as const, label: '1h' },
    { id: 'day' as const, label: 'Daily' },
  ];
  protected readonly chartSymbol = signal<string | null>(null);
  protected readonly chart = signal<MarketDeskCandles | null>(null);
  protected readonly chartLoading = signal(false);
  protected readonly feed = signal<MarketDeskAlert[]>([]);
  protected readonly running = signal(this.loadRunning());

  protected readonly tiles = computed(() => {
    const snap = this.snap();
    if (!snap) return [];
    let rows = [...snap.stocks];
    const q = this.query().trim().toUpperCase();
    if (q) rows = rows.filter((r) => r.symbol.includes(q) || r.name.toUpperCase().includes(q));
    const f = this.filter();
    if (f === 'bullish') rows = rows.filter((r) => r.bias === 'bullish' || r.bias === 'mild-bull');
    if (f === 'bearish') rows = rows.filter((r) => r.bias === 'bearish' || r.bias === 'mild-bear');
    if (f === 'sideways') rows = rows.filter((r) => r.bias === 'sideways');
    if (f === 'break15') rows = rows.filter((r) => r.breakout15?.status === 'confirmed' || r.breakout15?.status === 'potential');
    if (f === 'break60') rows = rows.filter((r) => r.breakout60?.status === 'confirmed' || r.breakout60?.status === 'potential');
    if (f === 'agree') rows = rows.filter((r) => r.breakoutAgree);
    if (this.sortPct()) {
      rows.sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999) || a.symbol.localeCompare(b.symbol));
    } else {
      rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    return rows;
  });

  protected readonly stockCount = computed(() => this.snap()?.stocks?.length || 0);
  protected readonly showStocks = signal(true);

  protected readonly activeCard = computed(() => {
    const snap = this.snap();
    const id = this.selected();
    return snap?.indices.find((c) => c.id === id) || snap?.indices[0] || null;
  });

  protected readonly active = computed(() => {
    const card = this.activeCard();
    return card ? this.cardBehaviour(card) : null;
  });

  protected readonly activePrice = computed(() => this.activeCard() || this.active());

  protected readonly flow = computed<BehaviourFlow>(() => this.active()?.flow || 'wait');

  protected readonly timeline = computed(() => this.active()?.timeline || []);

  protected readonly tfRows = computed(() => {
    const t = this.active()?.timeframes;
    if (!t) return [];
    return [t.m5, t.m15, t.h1, t.day];
  });

  protected readonly marketClosed = computed(() => {
    const s = this.snap()?.session;
    if (!s) return false;
    const crude = this.selected() === 'CRUDEOILM';
    if (crude) return s.crudeOpen === false || (s.crudeOpen == null && !s.open);
    if (s.cashOpen != null) return !s.cashOpen;
    return s.open === false || s.status === 'closed' || s.status === 'holiday';
  });

  private poll: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private lastRender = 0;

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
    if (this.running()) {
      void this.refresh();
      this.armPoll();
    }
    this.destroyRef.onDestroy(() => {
      if (this.poll) clearInterval(this.poll);
      if (this.clockTimer) clearInterval(this.clockTimer);
    });
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const snap = await this.api.snapshot(this.settings());
      this.snap.set(snap);
      this.error.set(null);
      this.mergeAlerts(snap.alerts || []);
      if (!this.selected() && snap.indices[0]) this.selected.set(snap.indices[0].id);
      if (this.chartSymbol()) void this.loadChart();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'Market desk is unavailable.';
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  protected isPublic(): boolean {
    return this.auth?.isPublic() === true;
  }

  protected startDesk(): void {
    if (this.running()) {
      void this.refresh();
      return;
    }
    this.running.set(true);
    this.saveRunning(true);
    this.armPoll();
    void this.refresh();
  }

  protected stopDesk(): void {
    this.running.set(false);
    this.saveRunning(false);
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  protected setFilter(id: DeskFilter): void {
    this.filter.set(this.filter() === id ? 'all' : id);
  }

  protected select(id: string): void {
    this.selected.set(id);
  }

  protected openChart(symbol: string): void {
    this.chartSymbol.set(symbol);
    void this.loadChart();
  }

  protected sessionLabel(): string {
    if (!this.running()) return 'Stopped';
    if (this.marketClosed()) return 'Market is closed';
    return this.snap()?.session?.label || 'Session open';
  }

  protected closedHint(): string {
    return this.selected() === 'CRUDEOILM'
      ? 'Crude Oil Mini trades 09:00–23:30 IST on weekdays.'
      : 'Cash indices trade 09:15–15:30 IST on weekdays.';
  }

  protected setPrimary(iv: '5minute' | '15minute' | '60minute' | 'day'): void {
    this.primary.set(iv);
    this.patchSetting('primaryTimeframe', iv);
  }

  protected nodeCopy(): string {
    const b = this.active();
    if (!b) return 'Market flow visualization';
    return `${b.name || b.instrument} ${b.nodeLabel}`;
  }

  protected shortName(card: MarketIndexCard): string {
    if (card.id === 'NIFTY50') return 'Nifty 50';
    if (card.id === 'BANKNIFTY') return 'Bank Nifty';
    if (card.id === 'SENSEX') return 'Sensex';
    if (card.id === 'CRUDEOILM') return 'Crude Oil Mini';
    return card.name;
  }

  protected cardBehaviour(card: MarketIndexCard): MarketBehaviour {
    if (card.behaviour) return card.behaviour;
    return fallbackBehaviour(card);
  }

  protected cardFlow(card: MarketIndexCard): BehaviourFlow {
    return this.cardBehaviour(card).flow;
  }

  protected absChange(card: MarketIndexCard): string {
    if (!Number.isFinite(card.change)) return '—';
    const n = card.change as number;
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
  }

  protected fmtPx(n: number | null | undefined): string {
    if (!Number.isFinite(n)) return '—';
    return (n as number).toFixed(2);
  }

  protected eventLabel(type: string): string {
    return type.replace(/-/g, ' ');
  }

  protected tfShort(iv: string): string {
    if (iv === '5minute') return '5 minutes';
    if (iv === '15minute') return '15 minutes';
    if (iv === '60minute') return '1 hour';
    if (iv === 'day') return 'Daily';
    return iv;
  }

  protected toggleStocks(ev: Event): void {
    ev.preventDefault();
    this.showStocks.set(!this.showStocks());
  }

  protected setInterval(iv: '5minute' | '15minute' | '60minute' | 'day'): void {
    this.chartIv.set(iv);
    void this.loadChart();
  }

  protected closeChart(): void {
    this.chartSymbol.set(null);
    this.chart.set(null);
  }

  protected patchSetting<K extends keyof MarketDeskSettings>(key: K, value: MarketDeskSettings[K]): void {
    const next = { ...this.settings(), [key]: value };
    this.settings.set(next);
    this.saveSettings(next);
    this.armPoll();
    void this.refresh();
  }

  protected lamp(bias: string | null | undefined): 'up' | 'down' | 'side' | 'wait' {
    if (bias === 'bullish' || bias === 'mild-bull') return 'up';
    if (bias === 'bearish' || bias === 'mild-bear') return 'down';
    if (bias === 'sideways' || bias === 'mixed') return 'side';
    return 'wait';
  }

  protected lampLabel(bias: string | null | undefined): string {
    const lamp = this.lamp(bias);
    if (lamp === 'up') return 'UP';
    if (lamp === 'down') return 'DOWN';
    if (lamp === 'side') return bias === 'mixed' ? 'MIXED' : 'SIDE';
    return 'WAIT';
  }

  protected tfLamp(trend: string | null | undefined): 'up' | 'down' | 'side' | 'wait' {
    if (trend === 'bullish') return 'up';
    if (trend === 'bearish') return 'down';
    if (trend === 'sideways' || trend === 'mixed') return 'side';
    return 'wait';
  }

  protected tfLabel(trend: string | null | undefined): string {
    const lamp = this.tfLamp(trend);
    if (lamp === 'up') return 'UP';
    if (lamp === 'down') return 'DOWN';
    if (lamp === 'side') return trend === 'mixed' ? 'MIX' : 'SIDE';
    return 'WAIT';
  }

  protected bucket(pct: number | null | undefined): string {
    if (!Number.isFinite(pct)) return 'na';
    const n = pct as number;
    if (n >= 3) return 'above-3';
    if (n >= 1) return '3-to-1';
    if (n > -1) return '1-to--1';
    if (n > -3) return '-1-to--3';
    return 'below--3';
  }

  protected pctDir(pct: number | null | undefined): 'up' | 'down' | 'flat' {
    if (!Number.isFinite(pct) || Math.abs(pct as number) < 0.05) return 'flat';
    return (pct as number) > 0 ? 'up' : 'down';
  }

  protected fmtPct(n: number | null | undefined): string {
    if (!Number.isFinite(n)) return '—';
    const v = n as number;
    return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
  }

  protected emptyCopy(): string {
    if (this.error()) return 'Stock quotes did not load. Refresh the desk.';
    return 'Waiting for Nifty 50 quotes…';
  }

  protected freshnessLabel(s: string): string {
    if (s === 'fresh') return 'Fresh';
    if (s === 'stale') return 'Stale';
    return 'Missing';
  }

  protected fmtIst(iso: string | null | undefined, withSeconds = true): string {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined,
      hourCycle: 'h23',
    }).format(new Date(iso));
  }

  private async loadChart(): Promise<void> {
    const symbol = this.chartSymbol();
    if (!symbol) return;
    this.chartLoading.set(true);
    try {
      this.chart.set(await this.api.candles(symbol, this.chartIv()));
    } catch {
      this.chart.set({ candles: [], message: 'Historical access failed or is restricted.' });
    } finally {
      this.chartLoading.set(false);
    }
  }

  private loadRunning(): boolean {
    if (!this.isBrowser) return true;
    try {
      const raw = localStorage.getItem(RUNNING_KEY);
      if (raw == null) return true;
      return raw !== '0' && raw !== 'false';
    } catch {
      return true;
    }
  }

  private saveRunning(on: boolean): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(RUNNING_KEY, on ? '1' : '0');
    } catch {
      // ignore
    }
  }

  private armPoll(): void {
    if (!this.running()) return;
    if (this.poll) clearInterval(this.poll);
    const ms = Math.max(1000, this.settings().uiRefreshMs || 5000);
    this.poll = setInterval(() => {
      const now = Date.now();
      if (now - this.lastRender < 900) return;
      this.lastRender = now;
      void this.refresh();
    }, ms);
  }

  private tickClock(): void {
    this.clock.set(
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()) + ' IST',
    );
  }

  private mergeAlerts(incoming: MarketDeskAlert[]): void {
    if (!incoming.length) return;
    const prev = this.feed();
    const seen = new Set(prev.map((a) => `${a.symbol}:${a.type}:${a.closeTime || ''}`));
    const next = incoming.filter((a) => !seen.has(`${a.symbol}:${a.type}:${a.closeTime || ''}`));
    if (!next.length) return;
    this.feed.set([...next, ...prev].slice(0, 30));
    if (this.isBrowser) {
      try {
        localStorage.setItem(ALERT_KEY, JSON.stringify(this.feed().slice(0, 20)));
      } catch {
        // ignore
      }
    }
  }

  private loadSettings(): MarketDeskSettings {
    if (!this.isBrowser) return { ...DEFAULT_DESK_SETTINGS };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_DESK_SETTINGS };
      return { ...DEFAULT_DESK_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_DESK_SETTINGS };
    }
  }

  private saveSettings(s: MarketDeskSettings): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      // ignore
    }
  }
}

function fallbackBehaviour(card: MarketIndexCard): MarketBehaviour {
  const bull = card.bias === 'bullish' || card.bias === 'mild-bull';
  const bear = card.bias === 'bearish' || card.bias === 'mild-bear';
  const dir = bull ? 'bullish' : bear ? 'bearish' : card.bias === 'sideways' ? 'sideways' : 'insufficient';
  const flow: BehaviourFlow = bull ? 'bull' : bear ? 'bear' : dir === 'sideways' ? 'side' : 'wait';
  const tf = (key: string, label: string, direction: string, missing = false): MarketBehaviour['timeframes']['m15'] => ({
    key,
    label,
    trend: direction,
    direction,
    missing,
    provisional: true,
  });
  return {
    instrument: card.id,
    name: card.name,
    ltp: card.ltp,
    change: card.change,
    changePct: card.changePct,
    classification: dir === 'insufficient' ? 'insufficient' : dir === 'sideways' ? 'sideways' : dir === 'bullish' ? 'uptrend' : 'downtrend',
    classificationLabel: card.biasLabel || 'Waiting for candles',
    direction: dir,
    nodeLabel: bull ? 'BULLISH' : bear ? 'BEARISH' : dir === 'sideways' ? 'SIDEWAYS' : 'WAIT',
    flow,
    trendStrength: card.strength,
    trendStrengthLabel: card.strengthLabel,
    evidenceStrength: 'low',
    evidenceStrengthLabel: 'Low — waiting for the behaviour engine',
    confirmed: card.confirmed,
    provisional: !card.confirmed,
    primaryTimeframe: '15minute',
    timeframes: {
      m5: tf('m5', '5-minute', 'insufficient', true),
      m15: tf('m15', '15-minute', card.m15Trend || 'insufficient', card.m15Trend === 'insufficient'),
      h1: tf('h1', '1-hour', card.h1Trend || 'insufficient', card.h1Trend === 'insufficient'),
      day: tf('day', 'Daily', card.dayTrend || dir, false),
    },
    alignment: { status: card.agreement, label: card.agreement, bulls: 0, bears: 0, sides: 0, available: 0, conflicts: [] },
    structure: null,
    range: null,
    breakout: { status: 'none', direction: null, level: null },
    reversal: { status: 'none', side: null, timeframe: null },
    momentum: { state: 'insufficient', label: 'Insufficient evidence' },
    volatility: { state: 'insufficient', label: 'Insufficient evidence' },
    transition: { stage: 0, label: 'No transition in progress', confirmed: [], required: [] },
    explanation: {
      behaviour: card.biasLabel,
      higherTf: card.dayTrend,
      intraday: card.m15Trend,
      momentum: 'Insufficient evidence',
      structure: 'Unclear',
      breakout: 'No confirmed breakout',
      reversal: 'Not confirmed',
      supporting: ['Day move is shown until Kite candles arrive.'],
      conflicting: ['15-minute and 1-hour behaviour is unavailable.'],
      confirmation: 'Completed 15-minute and 1-hour candles.',
      invalidation: 'Treat this as a quote-only placeholder.',
    },
    levels: { support: null, resistance: null, invalidation: 'Waiting for candles.' },
    timeline: [],
    lastUpdateAt: new Date().toISOString(),
    sample: true,
  };
}

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { realisticFill } from '../../../core/paper-desk/execution-model.util';
import { istDay } from '../../../core/paper-desk/live-paper.engine';
import { LivePaperService } from '../../../core/paper-desk/live-paper.service';
import { PaperLedgerService } from '../../../core/paper-desk/paper-ledger.service';
import { PaperTrade, PeriodKind, RealisticFill } from '../../../core/paper-desk/paper-analytics.models';
import {
  GATES,
  SCENARIO_MIN_DAYS,
  SCENARIO_MIN_TRADES,
  breakdownBy,
  computeMetrics,
  dailySeries,
  equityCurve,
  evaluateReadiness,
  groupByPeriod,
  projectScenarios,
  round2,
} from '../../../core/paper-desk/paper-analytics.util';
import {
  LEAKAGE_CONTROLS,
  RESEARCH_BUCKETS,
  RESEARCH_FINDINGS,
  RESEARCH_SOURCE,
  RESEARCH_SPLIT,
} from '../../../core/paper-desk/validation-research.data';

export type AnalyticsView = 'signals' | 'performance' | 'compare' | 'validation' | 'trades';
type Range = 'today' | '7d' | '30d' | 'all';
type Basis = 'realistic' | 'paper';

interface Row {
  t: PaperTrade;
  real: RealisticFill;
  /** Net P&L under the selected basis. */
  net: number;
}

const CHART_W = 640;
const CHART_H = 170;

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function istMinuteOf(iso: string): number | null {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

@Component({
  selector: 'app-paper-analytics',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './paper-analytics.component.html',
  styleUrl: './paper-analytics.component.css',
})
export class PaperAnalyticsComponent {
  readonly view = input.required<AnalyticsView>();

  protected readonly paper = inject(LivePaperService);
  protected readonly ledger = inject(PaperLedgerService);

  protected readonly range = signal<Range>('all');
  protected readonly basis = signal<Basis>('realistic');
  protected readonly period = signal<PeriodKind>('day');
  protected readonly selectedId = signal<string>('');

  protected readonly ranges: { id: Range; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: 'all', label: 'All' },
  ];
  protected readonly periods: { id: PeriodKind; label: string }[] = [
    { id: 'day', label: 'Daily' },
    { id: 'week', label: 'Weekly' },
    { id: 'month', label: 'Monthly' },
  ];

  protected readonly gates = GATES;
  protected readonly scenarioMinTrades = SCENARIO_MIN_TRADES;
  protected readonly scenarioMinDays = SCENARIO_MIN_DAYS;
  protected readonly research = RESEARCH_BUCKETS;
  protected readonly researchFindings = RESEARCH_FINDINGS;
  protected readonly researchSource = RESEARCH_SOURCE;
  protected readonly researchSplit = RESEARCH_SPLIT;
  protected readonly leakage = LEAKAGE_CONTROLS;

  private readonly allRows = computed<Omit<Row, 'net'>[]>(() =>
    this.ledger.state().trades.map((t) => ({ t, real: realisticFill(t) })),
  );

  protected readonly rows = computed<Row[]>(() => {
    const today = istDay();
    const r = this.range();
    const from = r === 'today' ? today : r === '7d' ? shiftDay(today, -6) : r === '30d' ? shiftDay(today, -29) : '';
    const basis = this.basis();
    return this.allRows()
      .filter((x) => !from || x.t.day >= from)
      .map((x) => ({ ...x, net: basis === 'paper' ? x.t.paperNetRs : x.real.netRs }));
  });

  protected readonly nets = computed(() => this.rows().map((r) => r.net));
  protected readonly metrics = computed(() => computeMetrics(this.nets()));
  protected readonly curve = computed(() => equityCurve(this.nets()));
  protected readonly currentDrawdownRs = computed(() => this.curve().at(-1)?.drawdownRs ?? 0);

  protected readonly periodRows = computed(() =>
    groupByPeriod(
      this.rows().map((r) => ({ day: r.t.day, netRs: r.net })),
      this.period(),
    ),
  );
  protected readonly periodBars = computed(() => this.periodRows().slice(-30));

  protected readonly daily = computed(() =>
    dailySeries(
      this.rows().map((r) => ({ day: r.t.day, netRs: r.net })),
      this.observedInRange(),
    ),
  );
  protected readonly worstDay = computed(() => {
    const d = this.daily().filter((x) => x.trades > 0);
    return d.length ? Math.min(...d.map((x) => x.netRs)) : null;
  });
  protected readonly bestDay = computed(() => {
    const d = this.daily().filter((x) => x.trades > 0);
    return d.length ? Math.max(...d.map((x) => x.netRs)) : null;
  });

  /** Projections always use every recorded execution-adjusted trade, regardless of the range filter. */
  private readonly allRealNets = computed(() => this.allRows().map((r) => r.real.netRs));
  private readonly allRealDaily = computed(() =>
    dailySeries(
      this.allRows().map((r) => ({ day: r.t.day, netRs: r.real.netRs })),
      this.ledger.state().observedDays,
    ),
  );
  protected readonly scenarios = computed(() => projectScenarios(this.allRealNets(), this.allRealDaily()));

  protected readonly okScenario = computed(() => {
    const s = this.scenarios();
    return s.status === 'ok' ? s : null;
  });
  protected readonly scenarioReason = computed(() => {
    const s = this.scenarios();
    return s.status === 'insufficient' ? s.reason : '';
  });

  protected readonly readiness = computed(() =>
    evaluateReadiness({
      realisticNets: this.allRealNets(),
      quotedCount: this.allRows().filter((r) => r.real.quality === 'quoted').length,
      observedDays: this.ledger.state().observedDays.length,
    }),
  );
  protected readonly hasActiveSignal = computed(() =>
    this.paper.session().books.some((b) => b.side !== 'flat' || !!b.pendingDir),
  );
  protected readonly forwardTrades = computed(() => this.allRows().length);
  protected readonly forwardDays = computed(() => this.ledger.state().observedDays.length);

  protected readonly cost = computed(() => {
    const rs = this.rows();
    const n = rs.length;
    const charges = rs.reduce((s, r) => s + r.real.chargesRs, 0);
    const spread = rs.reduce((s, r) => s + r.real.spreadSlipRs, 0);
    const paperNet = rs.reduce((s, r) => s + r.t.paperNetRs, 0);
    const realNet = rs.reduce((s, r) => s + r.real.netRs, 0);
    const realGross = rs.reduce((s, r) => s + r.real.grossRs, 0);
    const paperCharges = n * 50;
    return {
      n,
      paperNet: round2(paperNet),
      realNet: round2(realNet),
      realGross: round2(realGross),
      charges: round2(charges),
      paperCharges,
      spread: round2(spread),
      difference: round2(paperNet - realNet),
      avgCharges: n ? round2(charges / n) : null,
      avgSpread: n ? round2(spread / n) : null,
      quoted: rs.filter((r) => r.real.quality === 'quoted').length,
      modelled: rs.filter((r) => r.real.quality === 'modelled').length,
    };
  });

  protected readonly byStructure = computed(() => breakdownBy(this.rows(), (r) => r.t.structure, (r) => r.net));
  protected readonly byBook = computed(() => breakdownBy(this.rows(), (r) => r.t.label, (r) => r.net));
  protected readonly bySide = computed(() => breakdownBy(this.rows(), (r) => r.t.optionType, (r) => r.net));
  protected readonly bySession = computed(() =>
    breakdownBy(
      this.rows(),
      (r) => {
        const m = istMinuteOf(r.t.entryAt);
        return m == null ? 'unknown' : m < 12 * 60 ? 'before 12:00' : 'after 12:00';
      },
      (r) => r.net,
    ),
  );

  protected readonly tradeList = computed(() => [...this.rows()].reverse());
  protected readonly selected = computed(() => this.rows().find((r) => r.t.id === this.selectedId()) ?? null);
  protected readonly recentSignals = computed(() =>
    [...this.allRows()]
      .filter((r) => r.t.signal)
      .reverse()
      .slice(0, 6),
  );

  protected readonly equityPath = computed(() => this.path(this.curve().map((p) => p.cumRs)));
  protected readonly drawdownPath = computed(() => this.path(this.curve().map((p) => -p.drawdownRs)));
  protected readonly zeroY = computed(() => this.scaleY(0, this.curve().flatMap((p) => [p.cumRs, -p.drawdownRs, 0])));

  protected readonly chartW = CHART_W;
  protected readonly chartH = CHART_H;

  protected readonly barScale = computed(() => {
    const vals = this.periodBars().map((p) => Math.abs(p.netRs));
    return Math.max(1, ...vals);
  });

  private observedInRange(): string[] {
    const today = istDay();
    const r = this.range();
    const from = r === 'today' ? today : r === '7d' ? shiftDay(today, -6) : r === '30d' ? shiftDay(today, -29) : '';
    return this.ledger.state().observedDays.filter((d) => !from || d >= from);
  }

  private bounds(values: number[]): { lo: number; hi: number } {
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    return hi === lo ? { lo: lo - 1, hi: hi + 1 } : { lo, hi };
  }

  private scaleY(v: number, all: number[]): number {
    const { lo, hi } = this.bounds(all);
    return 10 + (1 - (v - lo) / (hi - lo)) * (CHART_H - 20);
  }

  private path(values: number[]): string {
    if (!values.length) return '';
    const all = this.curve().flatMap((p) => [p.cumRs, -p.drawdownRs, 0]);
    const step = values.length > 1 ? (CHART_W - 20) / (values.length - 1) : 0;
    return values
      .map((v, i) => `${i ? 'L' : 'M'}${(10 + i * step).toFixed(1)},${this.scaleY(v, all).toFixed(1)}`)
      .join(' ');
  }

  protected pick(range: Range): void {
    this.range.set(range);
  }

  protected inr(n: number | null | undefined): string {
    if (n == null || Number.isNaN(n)) return '—';
    const sign = n > 0 ? '+' : n < 0 ? '−' : '';
    const abs = Math.abs(n);
    return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: abs >= 100 ? 0 : 1 })}`;
  }

  protected plain(n: number | null | undefined, digits = 2): string {
    return n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: digits });
  }

  protected tone(n: number | null | undefined): string {
    return n == null ? '' : n > 0 ? 'mp-up' : n < 0 ? 'mp-down' : '';
  }

  protected barHeight(n: number): number {
    return Math.max(2, (Math.abs(n) / this.barScale()) * 60);
  }

  protected istTime(iso: string | undefined | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  }

  protected istStamp(iso: string | undefined | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  }

  protected contract(t: PaperTrade): string {
    if (!t.optionType || t.strike == null) return t.optionSymbol || '—';
    return `${t.label} ${t.strike} ${t.optionType}`;
  }

  protected stale(): boolean {
    const s = this.paper.session();
    if (!s.running) return false;
    const age = Date.now() - new Date(s.asOf).getTime();
    return Number.isFinite(age) && age > 45_000;
  }

  protected streakLabel(): string {
    const s = this.metrics().currentStreak;
    return s.kind === 'none' ? '—' : `${s.length} ${s.kind === 'win' ? 'win' : 'loss'}${s.length > 1 ? (s.kind === 'win' ? 's' : 'es') : ''}`;
  }

  protected progress(n: number, goal: number): number {
    return Math.min(100, Math.round((n / goal) * 100));
  }

  protected select(id: string): void {
    this.selectedId.set(this.selectedId() === id ? '' : id);
  }

  protected downloadDailyReport(): void {
    if (typeof document === 'undefined') return;
    const header = 'day,trades,net_inr_selected_basis\n';
    const body = this.daily()
      .map((d) => `${d.day},${d.trades},${d.netRs}`)
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paper14k-daily-report-${istDay()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

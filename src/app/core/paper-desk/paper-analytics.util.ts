/**
 * Pure P&L analytics for the forward-paper ledger. No I/O, no randomness except a seeded bootstrap.
 * Every figure is computed from closed trades in the order they closed; nothing is filtered or hidden.
 */
import {
  GateCheck,
  PerformanceMetrics,
  PeriodKind,
  PeriodRow,
  ReadinessResult,
  ScenarioResult,
} from './paper-analytics.models';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeMetrics(pnls: readonly number[]): PerformanceMetrics {
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let gp = 0;
  let gl = 0;
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let curW = 0;
  let curL = 0;
  let maxW = 0;
  let maxL = 0;
  let best: number | null = null;
  let worst: number | null = null;
  let last: 'win' | 'loss' | 'none' = 'none';
  for (const p of pnls) {
    cum += p;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    best = best == null ? p : Math.max(best, p);
    worst = worst == null ? p : Math.min(worst, p);
    if (p > 0) {
      wins += 1;
      gp += p;
      curW += 1;
      curL = 0;
      last = 'win';
    } else if (p < 0) {
      losses += 1;
      gl += -p;
      curL += 1;
      curW = 0;
      last = 'loss';
    } else {
      flats += 1;
      curW = 0;
      curL = 0;
      last = 'none';
    }
    maxW = Math.max(maxW, curW);
    maxL = Math.max(maxL, curL);
  }
  const n = pnls.length;
  const net = gp - gl;
  const avgWin = wins ? gp / wins : null;
  const avgLoss = losses ? gl / losses : null;
  return {
    trades: n,
    wins,
    losses,
    flats,
    winRatePct: n ? round2((wins / n) * 100) : null,
    grossProfitRs: round2(gp),
    grossLossRs: round2(gl),
    netRs: round2(net),
    avgWinRs: avgWin == null ? null : round2(avgWin),
    avgLossRs: avgLoss == null ? null : round2(avgLoss),
    riskReward: avgWin != null && avgLoss != null && avgLoss > 0 ? round2(avgWin / avgLoss) : null,
    profitFactor: gl > 0 ? round2(gp / gl) : null,
    expectancyRs: n ? round2(net / n) : null,
    maxDrawdownRs: round2(maxDd),
    maxConsecWins: maxW,
    maxConsecLosses: maxL,
    currentStreak: last === 'win' ? { kind: 'win', length: curW } : last === 'loss' ? { kind: 'loss', length: curL } : { kind: 'none', length: 0 },
    bestTradeRs: best == null ? null : round2(best),
    worstTradeRs: worst == null ? null : round2(worst),
  };
}

export interface EquityPoint {
  index: number;
  cumRs: number;
  drawdownRs: number;
}

export function equityCurve(pnls: readonly number[]): EquityPoint[] {
  let cum = 0;
  let peak = 0;
  return pnls.map((p, i) => {
    cum += p;
    peak = Math.max(peak, cum);
    return { index: i + 1, cumRs: round2(cum), drawdownRs: round2(peak - cum) };
  });
}

/** ISO-8601 week key (Monday start), e.g. 2026-W45. */
export function isoWeekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function periodKey(day: string, kind: PeriodKind): string {
  if (kind === 'day') return day;
  if (kind === 'month') return day.slice(0, 7);
  return isoWeekKey(day);
}

export function groupByPeriod(rows: readonly { day: string; netRs: number }[], kind: PeriodKind): PeriodRow[] {
  const map = new Map<string, PeriodRow>();
  for (const r of rows) {
    const key = periodKey(r.day, kind);
    const row = map.get(key) ?? { key, trades: 0, wins: 0, netRs: 0 };
    row.trades += 1;
    if (r.netRs > 0) row.wins += 1;
    row.netRs = round2(row.netRs + r.netRs);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Daily P&L for every day the desk was observed running, including days with no trade (zero). */
export function dailySeries(
  rows: readonly { day: string; netRs: number }[],
  observedDays: readonly string[],
): { day: string; netRs: number; trades: number }[] {
  const map = new Map<string, { day: string; netRs: number; trades: number }>();
  for (const d of observedDays) map.set(d, { day: d, netRs: 0, trades: 0 });
  for (const r of rows) {
    const row = map.get(r.day) ?? { day: r.day, netRs: 0, trades: 0 };
    row.netRs = round2(row.netRs + r.netRs);
    row.trades += 1;
    map.set(r.day, row);
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function meanAndSe(xs: readonly number[]): { mean: number; sd: number; se: number } {
  const n = xs.length;
  if (!n) return { mean: 0, sd: 0, se: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  if (n < 2) return { mean, sd: 0, se: 0 };
  const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(v);
  return { mean, sd, se: sd / Math.sqrt(n) };
}

export const SCENARIO_MIN_TRADES = 30;
export const SCENARIO_MIN_DAYS = 10;
const Z90 = 1.645;

/**
 * Estimates, not forecasts: resamples the observed daily P&L (days are the independent unit) to build
 * worst (5th pct), base (median) and best (95th pct) outcomes over a horizon. Refuses with too little data.
 */
export function projectScenarios(
  tradeNets: readonly number[],
  daily: readonly { netRs: number }[],
  horizonDays = 20,
  simulations = 2000,
  seed = 20261103,
): ScenarioResult {
  if (tradeNets.length < SCENARIO_MIN_TRADES) {
    return {
      status: 'insufficient',
      reason: `Needs at least ${SCENARIO_MIN_TRADES} closed trades; have ${tradeNets.length}.`,
    };
  }
  if (daily.length < SCENARIO_MIN_DAYS) {
    return {
      status: 'insufficient',
      reason: `Needs at least ${SCENARIO_MIN_DAYS} observed trading days; have ${daily.length}.`,
    };
  }
  const { mean, se } = meanAndSe(tradeNets);
  const tradesPerDay = tradeNets.length / daily.length;
  const rand = mulberry32(seed);
  const sums: number[] = [];
  for (let s = 0; s < simulations; s++) {
    let total = 0;
    for (let d = 0; d < horizonDays; d++) total += daily[Math.floor(rand() * daily.length)].netRs;
    sums.push(total);
  }
  sums.sort((a, b) => a - b);
  return {
    status: 'ok',
    horizonDays,
    expectedPerTradeRs: round2(mean),
    perTradeCi90: [round2(mean - Z90 * se), round2(mean + Z90 * se)],
    tradesPerDay: round2(tradesPerDay),
    expectedPerDayRs: round2(mean * tradesPerDay),
    rows: [
      { label: 'worst', rs: round2(percentile(sums, 0.05)) },
      { label: 'base', rs: round2(percentile(sums, 0.5)) },
      { label: 'best', rs: round2(percentile(sums, 0.95)) },
    ],
    simulations,
  };
}

export interface ConditionRow {
  group: string;
  trades: number;
  winRatePct: number | null;
  netRs: number;
  expectancyRs: number | null;
  profitFactor: number | null;
}

export function breakdownBy<T>(
  rows: readonly T[],
  keyOf: (r: T) => string,
  netOf: (r: T) => number,
): ConditionRow[] {
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const k = keyOf(r) || 'unknown';
    const arr = buckets.get(k) ?? [];
    arr.push(netOf(r));
    buckets.set(k, arr);
  }
  return [...buckets.entries()]
    .map(([group, nets]) => {
      const m = computeMetrics(nets);
      return {
        group,
        trades: m.trades,
        winRatePct: m.winRatePct,
        netRs: m.netRs,
        expectancyRs: m.expectancyRs,
        profitFactor: m.profitFactor,
      };
    })
    .sort((a, b) => b.trades - a.trades || (a.group < b.group ? -1 : 1));
}

export const GATES = {
  minTrades: 100,
  minDays: 20,
  minProfitFactor: 1.3,
  maxDrawdownRs: 1260,
  minQuotedShare: 0.8,
} as const;

/**
 * Forward-test gates on EXECUTION-ADJUSTED results. Passing every gate only means "worth a small live test";
 * it is never a profit guarantee.
 */
export function evaluateReadiness(input: {
  realisticNets: readonly number[];
  quotedCount: number;
  observedDays: number;
}): ReadinessResult {
  const n = input.realisticNets.length;
  const m = computeMetrics(input.realisticNets);
  const { mean, se } = meanAndSe(input.realisticNets);
  const lower = mean - Z90 * se;
  const quotedShare = n ? input.quotedCount / n : 0;
  const checks: GateCheck[] = [
    {
      label: `At least ${GATES.minTrades} forward trades`,
      pass: n >= GATES.minTrades,
      detail: `${n} closed`,
    },
    {
      label: `At least ${GATES.minDays} observed trading days`,
      pass: input.observedDays >= GATES.minDays,
      detail: `${input.observedDays} days`,
    },
    {
      label: 'Execution-adjusted expectancy above zero',
      pass: n > 0 && mean > 0,
      detail: n ? `₹${round2(mean)} per trade` : 'no trades',
    },
    {
      label: 'Lower 90% bound of expectancy above zero',
      pass: n >= 2 && lower > 0,
      detail: n >= 2 ? `₹${round2(lower)}` : 'needs 2+ trades',
    },
    {
      label: `Profit factor at least ${GATES.minProfitFactor}`,
      pass: m.profitFactor != null && m.profitFactor >= GATES.minProfitFactor,
      detail: m.profitFactor == null ? 'n/a' : String(m.profitFactor),
    },
    {
      label: `Max drawdown within ₹${GATES.maxDrawdownRs.toLocaleString('en-IN')}`,
      pass: n > 0 && m.maxDrawdownRs <= GATES.maxDrawdownRs,
      detail: `₹${m.maxDrawdownRs}`,
    },
    {
      label: `At least ${GATES.minQuotedShare * 100}% of fills use observed bid/ask`,
      pass: n > 0 && quotedShare >= GATES.minQuotedShare,
      detail: `${Math.round(quotedShare * 100)}%`,
    },
  ];
  const sampleOk = checks[0].pass && checks[1].pass;
  const verdict = !sampleOk ? 'insufficient' : checks.every((c) => c.pass) ? 'candidate' : 'not-ready';
  return { verdict, checks };
}

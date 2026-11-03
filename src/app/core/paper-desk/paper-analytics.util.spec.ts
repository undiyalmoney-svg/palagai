import { describe, expect, it } from 'vitest';
import {
  breakdownBy,
  computeMetrics,
  dailySeries,
  equityCurve,
  evaluateReadiness,
  groupByPeriod,
  isoWeekKey,
  meanAndSe,
  projectScenarios,
} from './paper-analytics.util';

describe('computeMetrics', () => {
  const pnls = [100, -50, 200, -30, -20, 150, 0, -10];

  it('counts wins, losses and flats and never hides a losing trade', () => {
    const m = computeMetrics(pnls);
    expect(m.trades).toBe(8);
    expect(m.wins).toBe(3);
    expect(m.losses).toBe(4);
    expect(m.flats).toBe(1);
    expect(m.wins + m.losses + m.flats).toBe(m.trades);
    expect(m.winRatePct).toBe(37.5);
  });

  it('computes gross profit, gross loss, net, averages, payoff and profit factor', () => {
    const m = computeMetrics(pnls);
    expect(m.grossProfitRs).toBe(450);
    expect(m.grossLossRs).toBe(110);
    expect(m.netRs).toBe(340);
    expect(m.netRs).toBe(m.grossProfitRs - m.grossLossRs);
    expect(m.avgWinRs).toBe(150);
    expect(m.avgLossRs).toBe(27.5);
    expect(m.riskReward).toBe(5.45);
    expect(m.profitFactor).toBe(4.09);
    expect(m.expectancyRs).toBe(42.5);
    expect(m.bestTradeRs).toBe(200);
    expect(m.worstTradeRs).toBe(-50);
  });

  it('measures max drawdown peak to trough from a zero start', () => {
    expect(computeMetrics(pnls).maxDrawdownRs).toBe(50);
    expect(computeMetrics([-100, -50, 300, -200]).maxDrawdownRs).toBe(200);
    expect(computeMetrics([100, 100]).maxDrawdownRs).toBe(0);
    expect(computeMetrics([-40, -60]).maxDrawdownRs).toBe(100);
  });

  it('tracks consecutive wins and losses; a flat trade breaks a streak', () => {
    const m = computeMetrics(pnls);
    expect(m.maxConsecWins).toBe(1);
    expect(m.maxConsecLosses).toBe(2);
    expect(m.currentStreak).toEqual({ kind: 'loss', length: 1 });
    const run = computeMetrics([5, 6, 7, -1, -2, -3, -4, 9]);
    expect(run.maxConsecWins).toBe(3);
    expect(run.maxConsecLosses).toBe(4);
    expect(run.currentStreak).toEqual({ kind: 'win', length: 1 });
    expect(computeMetrics([5, 0, 6]).maxConsecWins).toBe(1);
  });

  it('returns null ratios instead of inventing numbers when a side is empty', () => {
    const none = computeMetrics([]);
    expect(none.winRatePct).toBeNull();
    expect(none.expectancyRs).toBeNull();
    expect(none.profitFactor).toBeNull();
    const allWins = computeMetrics([10, 20]);
    expect(allWins.profitFactor).toBeNull();
    expect(allWins.riskReward).toBeNull();
    expect(allWins.avgLossRs).toBeNull();
    expect(computeMetrics([-10, -20]).avgWinRs).toBeNull();
  });
});

describe('equityCurve', () => {
  it('accumulates net P&L and drawdown from the running peak', () => {
    const c = equityCurve([100, -150, 50]);
    expect(c.map((p) => p.cumRs)).toEqual([100, -50, 0]);
    expect(c.map((p) => p.drawdownRs)).toEqual([0, 150, 100]);
  });
});

describe('period grouping', () => {
  it('builds ISO week keys across year boundaries', () => {
    expect(isoWeekKey('2026-11-03')).toBe('2026-W45');
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
  });

  it('groups by day, week and month without dropping losers', () => {
    const rows = [
      { day: '2026-11-02', netRs: 100 },
      { day: '2026-11-02', netRs: -40 },
      { day: '2026-11-03', netRs: -10 },
      { day: '2026-11-10', netRs: 30 },
      { day: '2026-12-01', netRs: -5 },
    ];
    const d = groupByPeriod(rows, 'day');
    expect(d.find((r) => r.key === '2026-11-02')).toEqual({ key: '2026-11-02', trades: 2, wins: 1, netRs: 60 });
    const w = groupByPeriod(rows, 'week');
    expect(w.map((r) => [r.key, r.netRs])).toEqual([
      ['2026-W45', 50],
      ['2026-W46', 30],
      ['2026-W49', -5],
    ]);
    const m = groupByPeriod(rows, 'month');
    expect(m.map((r) => [r.key, r.trades, r.netRs])).toEqual([
      ['2026-11', 4, 80],
      ['2026-12', 1, -5],
    ]);
    expect(rows.reduce((s, r) => s + r.netRs, 0)).toBe(m.reduce((s, r) => s + r.netRs, 0));
  });

  it('keeps observed days with no trade as zero in the daily series', () => {
    const s = dailySeries([{ day: '2026-11-03', netRs: 50 }], ['2026-11-02', '2026-11-03']);
    expect(s).toEqual([
      { day: '2026-11-02', netRs: 0, trades: 0 },
      { day: '2026-11-03', netRs: 50, trades: 1 },
    ]);
  });
});

describe('projectScenarios', () => {
  const nets = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? -60 : 45));
  const daily = Array.from({ length: 12 }, (_, i) => ({ netRs: i % 4 === 0 ? -80 : 55 }));

  it('refuses to project from a thin sample', () => {
    expect(projectScenarios(nets.slice(0, 10), daily).status).toBe('insufficient');
    const r = projectScenarios(nets, daily.slice(0, 3));
    expect(r.status).toBe('insufficient');
  });

  it('is deterministic and orders worst <= base <= best', () => {
    const a = projectScenarios(nets, daily);
    const b = projectScenarios(nets, daily);
    expect(a).toEqual(b);
    if (a.status !== 'ok') throw new Error('expected ok');
    const [worst, base, best] = a.rows.map((r) => r.rs);
    expect(worst).toBeLessThanOrEqual(base);
    expect(base).toBeLessThanOrEqual(best);
    const mean = nets.reduce((s, x) => s + x, 0) / nets.length;
    expect(a.expectedPerTradeRs).toBeCloseTo(mean, 2);
    expect(a.tradesPerDay).toBeCloseTo(40 / 12, 2);
    expect(a.expectedPerDayRs).toBeCloseTo(mean * (40 / 12), 1);
    const [lo, hi] = a.perTradeCi90;
    expect(lo).toBeLessThan(a.expectedPerTradeRs);
    expect(hi).toBeGreaterThan(a.expectedPerTradeRs);
  });

  it('computes mean and standard error', () => {
    const { mean, sd, se } = meanAndSe([2, 4, 6]);
    expect(mean).toBe(4);
    expect(sd).toBe(2);
    expect(se).toBeCloseTo(2 / Math.sqrt(3), 9);
  });
});

describe('breakdownBy', () => {
  it('splits results by market condition', () => {
    const rows = [
      { s: 'trend', n: 100 },
      { s: 'trend', n: -40 },
      { s: 'range', n: -30 },
    ];
    const out = breakdownBy(rows, (r) => r.s, (r) => r.n);
    const trend = out.find((o) => o.group === 'trend')!;
    expect(trend.trades).toBe(2);
    expect(trend.netRs).toBe(60);
    expect(trend.winRatePct).toBe(50);
    expect(out.find((o) => o.group === 'range')!.netRs).toBe(-30);
  });
});

describe('evaluateReadiness', () => {
  it('says insufficient on a small forward sample even if every trade won', () => {
    const r = evaluateReadiness({ realisticNets: Array(20).fill(100), quotedCount: 20, observedDays: 5 });
    expect(r.verdict).toBe('insufficient');
    expect(r.checks[0].pass).toBe(false);
  });

  it('is not-ready when the sample is big enough but expectancy is negative', () => {
    const nets = Array.from({ length: 120 }, (_, i) => (i % 2 ? 40 : -60));
    const r = evaluateReadiness({ realisticNets: nets, quotedCount: 120, observedDays: 30 });
    expect(r.verdict).toBe('not-ready');
    expect(r.checks.find((c) => c.label.startsWith('Execution-adjusted'))!.pass).toBe(false);
  });

  it('only reaches candidate when every gate passes', () => {
    const nets = Array.from({ length: 120 }, (_, i) => (i % 4 === 0 ? -50 : 60 + (i % 5)));
    const ok = evaluateReadiness({ realisticNets: nets, quotedCount: 110, observedDays: 30 });
    expect(ok.verdict).toBe('candidate');
    const unverified = evaluateReadiness({ realisticNets: nets, quotedCount: 40, observedDays: 30 });
    expect(unverified.verdict).toBe('not-ready');
  });
});

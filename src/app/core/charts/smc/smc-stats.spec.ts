import { describe, expect, it } from 'vitest';
import { SmcAlertTracker } from './smc-alerts';
import { DEFAULT_SMC_CONFIG, resolveSmcConfig, sanitizeSmcConfig } from './smc.config';
import { computeSmcStats, splitSmcStats } from './smc-stats';
import { SmcAlertEvent, SmcTrade } from './smc.types';

function trade(over: Partial<SmcTrade>): SmcTrade {
  return {
    id: 'T',
    side: 'BUY',
    entryIndex: 0,
    entryDate: '2026-03-02T09:15:00+05:30',
    entryTs: 1,
    entryPrice: 100,
    sl: 99,
    slNow: 99,
    tp1: 101,
    tp2: 102,
    tpFinal: 103,
    risk: 1,
    rr: 3,
    units: 1,
    poi: [],
    triggerKind: 'CHoCH',
    triggerEventId: 'e',
    obId: null,
    status: 'closed',
    fills: [],
    remaining: 0,
    exitIndex: 5,
    exitDate: '',
    exitTs: 10,
    exitPrice: 100,
    exitReason: 'take_profit',
    rMultiple: 0,
    returnPct: 0,
    ...over,
  };
}

describe('computeSmcStats', () => {
  it('computes win rate, profit factor, drawdown and net return', () => {
    const trades = [
      trade({ id: 'a', rMultiple: 2, returnPct: 2, exitTs: 1 }),
      trade({ id: 'b', rMultiple: -1, returnPct: -1, exitTs: 2, side: 'SELL' }),
      trade({ id: 'c', rMultiple: -1, returnPct: -1, exitTs: 3 }),
      trade({ id: 'd', rMultiple: 3, returnPct: 3, exitTs: 4, rr: 2 }),
    ];
    const s = computeSmcStats(trades, 1);
    expect(s.totalTrades).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBe(50);
    expect(s.profitFactor).toBeCloseTo(5 / 2, 6);
    expect(s.avgR).toBeCloseTo(0.75, 6);
    expect(s.avgPlannedRr).toBeCloseTo(2.75, 6);
    expect(s.buySignals).toBe(3);
    expect(s.sellSignals).toBe(1);
    const equity = 1.02 * 0.99 * 0.99 * 1.03;
    expect(s.netReturnPct).toBeCloseTo((equity - 1) * 100, 6);
    expect(s.avgTradePct).toBeCloseTo(0.75, 6);
    // Peak after trade a (1.02), trough after trade c.
    expect(s.maxDrawdownPct).toBeCloseTo(((1.02 - 1.02 * 0.99 * 0.99) / 1.02) * 100, 6);
  });

  it('counts an open trade as a signal but not as a result', () => {
    const s = computeSmcStats(
      [trade({ status: 'open', rMultiple: null, returnPct: null, exitTs: null }), trade({ rMultiple: 1, returnPct: 1 })],
      1,
    );
    expect(s.totalTrades).toBe(1);
    expect(s.openTrades).toBe(1);
    expect(s.buySignals).toBe(2);
  });

  it('is empty-safe', () => {
    const s = computeSmcStats([], 1);
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.netReturnPct).toBe(0);
  });

  it('keeps live and backtest results apart', () => {
    const trades = [
      trade({ id: 'old', entryTs: 100, rMultiple: 2, returnPct: 2 }),
      trade({ id: 'today', entryTs: 1_000, rMultiple: -1, returnPct: -1 }),
    ];
    const split = splitSmcStats(trades, 1, 500);
    expect(split.backtest.totalTrades).toBe(1);
    expect(split.backtest.wins).toBe(1);
    expect(split.live.totalTrades).toBe(1);
    expect(split.live.losses).toBe(1);
    const past = splitSmcStats(trades, 1, null);
    expect(past.backtest.totalTrades).toBe(2);
    expect(past.live.totalTrades).toBe(0);
  });
});

describe('SmcAlertTracker', () => {
  const ev = (id: string, type: SmcAlertEvent['type'] = 'BUY'): SmcAlertEvent => ({
    id,
    type,
    index: 1,
    date: '',
    ts: 0,
    price: 1,
    message: id,
  });

  it('treats the first batch as history and announces nothing', () => {
    const t = new SmcAlertTracker();
    expect(t.ingest('nifty|15m', [ev('a'), ev('b')])).toEqual([]);
  });

  it('announces each new event exactly once', () => {
    const t = new SmcAlertTracker();
    t.ingest('s', [ev('a')]);
    expect(t.ingest('s', [ev('a'), ev('b')]).map((e) => e.id)).toEqual(['b']);
    expect(t.ingest('s', [ev('a'), ev('b')])).toEqual([]);
    expect(t.ingest('s', [ev('a'), ev('b'), ev('c')]).map((e) => e.id)).toEqual(['c']);
  });

  it('keeps streams independent and honours the enabled types', () => {
    const t = new SmcAlertTracker();
    t.ingest('a', []);
    t.ingest('b', []);
    expect(t.ingest('a', [ev('x', 'BUY')]).length).toBe(1);
    expect(t.ingest('b', [ev('x', 'SELL')], new Set(['BUY'])).length).toBe(0);
    expect(t.ingest('b', [ev('x', 'SELL')], new Set(['SELL'])).length).toBe(0);
  });
});

describe('SMC config', () => {
  it('layers market preset and user overrides over the defaults', () => {
    const bank = resolveSmcConfig('bank');
    expect(bank.eqTolAtr).toBe(0.12);
    expect(bank.minRR).toBe(DEFAULT_SMC_CONFIG.minRR);
    expect(resolveSmcConfig('bank', { minRR: 3 }).minRR).toBe(3);
  });

  it('defaults to a 1:2 minimum reward and one open position', () => {
    expect(DEFAULT_SMC_CONFIG.minRR).toBe(2);
    expect(DEFAULT_SMC_CONFIG.maxOpenPositions).toBe(1);
  });

  it('clamps nonsense input and keeps partials summing to 100', () => {
    const c = sanitizeSmcConfig({
      ...DEFAULT_SMC_CONFIG,
      minRR: -4,
      swingLength: 0,
      maxOpenPositions: 99,
      partialPct: [1, 1, 2],
      riskPerTradePct: Number.NaN,
    });
    expect(c.minRR).toBeGreaterThan(0);
    expect(c.swingLength).toBe(1);
    expect(c.maxOpenPositions).toBe(10);
    expect(c.riskPerTradePct).toBe(DEFAULT_SMC_CONFIG.riskPerTradePct);
    expect(c.partialPct[0] + c.partialPct[1] + c.partialPct[2]).toBeCloseTo(100, 6);
  });
});

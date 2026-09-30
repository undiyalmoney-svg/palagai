import { describe, expect, it } from 'vitest';
import { Candle } from '../../models/candle.model';
import { analyzeSmc } from './smc-analyze';
import { randomWalk, stamp, walk } from './smc-test-utils';

const FAR_FUTURE = new Date('2035-01-01T00:00:00Z');

/** Rising hourly series that ends long before the 15m series starts. */
function bullishHtf(): Candle[] {
  return walk([100, 110, 104, 118, 110, 128, 118, 138, 128, 150, 138, 162], 5, { minutes: 60 });
}

function bearishHtf(): Candle[] {
  return walk([162, 150, 158, 138, 146, 124, 132, 108, 116, 92, 100, 78], 5, { minutes: 60 });
}

/**
 * 15m path inside a bullish HTF: a down leg that sweeps the prior low, then a
 * sharp reversal that closes through the last lower high.
 */
function longScenario(tail: number[] = []): Candle[] {
  const path = [160, 170, 162, 176, 168, 182, 176, 178, 170, 174, 164, 168, 156, 170, 186, ...tail];
  return walk(path, 5, { minutes: 15, startBar: 400 });
}

function shortScenario(): Candle[] {
  const path = [160, 150, 158, 144, 152, 138, 144, 142, 150, 146, 156, 152, 164, 150, 134];
  return walk(path, 5, { minutes: 15, startBar: 400 });
}

function run(
  candles: Candle[],
  htf: Candle[] | null,
  config: Record<string, unknown> = {},
  market: 'nifty' | 'bank' | 'crude' = 'nifty',
) {
  return analyzeSmc({
    market,
    candles,
    intervalMinutes: 15,
    htf: htf ? { candles: htf, minutes: 60 } : null,
    now: FAR_FUTURE,
    // The hand-drawn legs are steeper than real 15m bars, so the stop is wider in ATRs.
    config: { maxRiskAtr: 12, ...config },
  });
}

describe('analyzeSmc — entry logic', () => {
  it('goes long only after the full sequence and puts the stop under the sweep low', () => {
    const result = run(longScenario([190, 200, 210, 220, 230]), bullishHtf());
    const buys = result.trades.filter((t) => t.side === 'BUY');
    expect(buys.length).toBeGreaterThanOrEqual(1);
    const t = buys[0]!;
    expect(result.snapshot.marketName).toBe('NIFTY 50');
    expect(t.sl).toBeLessThan(t.entryPrice);
    expect(t.tp1).toBeGreaterThan(t.entryPrice);
    expect(t.tp2).toBeGreaterThan(t.tp1);
    expect(t.tpFinal).toBeGreaterThan(t.tp2);
    expect(t.rr).toBeGreaterThanOrEqual(2);
    expect((t.tpFinal - t.entryPrice) / t.risk).toBeCloseTo(t.rr, 6);
    // Confirmation: the entry bar closed up, through the broken level.
    const bar = longScenario([190, 200, 210, 220, 230])[t.entryIndex]!;
    expect(bar.close).toBeGreaterThan(bar.open);
    expect(t.entryPrice).toBe(bar.close);
    expect(['BOS', 'CHoCH']).toContain(t.triggerKind);
    expect(t.poi.length).toBeGreaterThan(0);
  });

  it('never fires the same setup twice', () => {
    const result = run(longScenario([190, 200, 210, 220, 230]), bullishHtf());
    const triggers = result.trades.map((t) => `${t.side}|${t.triggerEventId}`);
    expect(new Set(triggers).size).toBe(triggers.length);
    expect(new Set(result.signals.map((s) => s.id)).size).toBe(result.signals.length);
  });

  it('takes no long when the higher timeframe is bearish', () => {
    const result = run(longScenario([190, 200, 210]), bearishHtf());
    expect(result.trades.filter((t) => t.side === 'BUY')).toHaveLength(0);
  });

  it('takes no short in a bullish higher timeframe', () => {
    const result = run(shortScenario(), bullishHtf());
    expect(result.trades.filter((t) => t.side === 'SELL')).toHaveLength(0);
  });

  it('mirrors the logic for shorts in a bearish higher timeframe', () => {
    const result = run(shortScenario().concat(walk([134, 120, 110, 100, 90], 5, { startBar: 475 })), bearishHtf());
    const sells = result.trades.filter((t) => t.side === 'SELL');
    expect(sells.length).toBeGreaterThanOrEqual(1);
    const t = sells[0]!;
    expect(t.sl).toBeGreaterThan(t.entryPrice);
    expect(t.tp1).toBeLessThan(t.entryPrice);
    expect(t.tpFinal).toBeLessThan(t.tp2);
    expect(t.rr).toBeGreaterThanOrEqual(2);
  });

  it('skips a setup whose stop would be wider than the risk cap', () => {
    const result = run(longScenario([190, 200, 210, 220, 230]), bullishHtf(), { maxRiskAtr: 3 });
    expect(result.trades).toHaveLength(0);
  });

  it('honours a higher minimum risk/reward', () => {
    const result = run(longScenario([190, 200, 210, 220, 230, 240]), bullishHtf(), { minRR: 3 });
    for (const t of result.trades) expect(t.rr).toBeGreaterThanOrEqual(3 - 1e-9);
  });

  it('caps open positions', () => {
    const result = run(longScenario([190, 200, 210]), bullishHtf(), { maxOpenPositions: 1 });
    let open = 0;
    let max = 0;
    const events = result.trades.flatMap((t) => [
      { at: t.entryIndex, d: 1 },
      ...(t.exitIndex != null ? [{ at: t.exitIndex, d: -1 }] : []),
    ]);
    events.sort((a, b) => a.at - b.at || a.d - b.d);
    for (const e of events) {
      open += e.d;
      max = Math.max(max, open);
    }
    expect(max).toBeLessThanOrEqual(1);
  });
});

describe('analyzeSmc — exits', () => {
  it('closes at the final target after TP1 and TP2', () => {
    const result = run(longScenario([190, 200, 215, 230, 250, 270]), bullishHtf());
    const t = result.trades.find((x) => x.side === 'BUY')!;
    expect(t.status).toBe('closed');
    expect(t.exitReason).toBe('take_profit');
    expect(t.fills.map((f) => f.kind)).toEqual(['TP1', 'TP2', 'FINAL']);
    expect(t.rMultiple!).toBeGreaterThan(1.5);
    const types = result.alerts.map((a) => a.type);
    expect(types).toContain('TP1');
    expect(types).toContain('TP2');
    expect(types).toContain('FINAL_TP');
    expect(types).toContain('EXIT');
  });

  it('loses money when price closes through the stop, and says why', () => {
    const full = longScenario();
    const entry = run(full, bullishHtf()).trades.find((x) => x.side === 'BUY')!;
    const base = full.slice(0, entry.entryIndex + 1);
    const crash = walk([base[base.length - 1]!.close, entry.sl - 20], 2, {
      startBar: 400 + base.length,
    });
    const t = run([...base, ...crash], bullishHtf()).trades.find((x) => x.side === 'BUY')!;
    expect(t.status).toBe('closed');
    expect(t.fills.every((f) => f.kind !== 'TP1')).toBe(true);
    expect(['stop_loss', 'opposite_structure', 'setup_invalidated', 'trend_reversal']).toContain(
      t.exitReason,
    );
    expect(t.rMultiple!).toBeLessThan(0);
    expect(t.rMultiple!).toBeGreaterThanOrEqual(-1.5);
  });

  it('does not exit on a pullback that respects structure and the stop', () => {
    const base = longScenario([190, 200]);
    const t0 = run(base, bullishHtf()).trades.find((x) => x.side === 'BUY')!;
    const last = base[base.length - 1]!.close;
    const dip = walk([last, last - (last - t0.entryPrice) * 0.4, last + 2], 3, {
      startBar: 400 + base.length,
    });
    const result = run([...base, ...dip], bullishHtf());
    const t = result.trades.find((x) => x.side === 'BUY')!;
    expect(t.exitReason).not.toBe('stop_loss');
    expect(t.fills.some((f) => f.kind === 'STOP')).toBe(false);
  });

  it('assumes the stop first when one candle spans stop and target', () => {
    const full = longScenario();
    const t0 = run(full, bullishHtf()).trades.find((x) => x.side === 'BUY')!;
    const base = full.slice(0, t0.entryIndex + 1);
    const wide: Candle = {
      date: stamp(400 + base.length, 15),
      open: t0.entryPrice,
      high: t0.tp1 + 5,
      low: t0.sl - 5,
      close: t0.entryPrice + 1,
      volume: 1,
    };
    const t = run([...base, wide], bullishHtf()).trades.find((x) => x.side === 'BUY')!;
    expect(t.fills.map((f) => f.kind)).toEqual(['STOP']);
    expect(t.exitReason).toBe('stop_loss');
    expect(t.rMultiple!).toBeCloseTo(-1, 1);
  });
});

describe('analyzeSmc — no repainting', () => {
  const seeds = [3, 7, 11, 19, 23];

  it('produces identical signals for a prefix and the full history', () => {
    let structureSeen = 0;
    let tradesSeen = 0;
    for (const seed of seeds) {
      const candles = randomWalk(420, seed);
      const full = analyzeSmc({
        market: 'nifty',
        candles,
        intervalMinutes: 15,
        htfMinutes: 60,
        now: FAR_FUTURE,
      });
      structureSeen += full.structure.length;
      tradesSeen += full.trades.length;

      for (const k of [90, 140, 200, 260, 330]) {
        const part = analyzeSmc({
          market: 'nifty',
          candles: candles.slice(0, k + 1),
          intervalMinutes: 15,
          htfMinutes: 60,
          now: FAR_FUTURE,
        });
        const upTo = <T extends { confirmedAt: number }>(list: T[]) =>
          list.filter((x) => x.confirmedAt <= k);
        const pick = (s: { id: string; index: number; price: number; confirmedAt: number; label: unknown }) => ({
          id: s.id,
          index: s.index,
          price: s.price,
          confirmedAt: s.confirmedAt,
          label: s.label,
        });

        expect(part.swings.map(pick)).toEqual(upTo(full.swings).map(pick));
        expect(part.structure).toEqual(upTo(full.structure));
        expect(part.orderBlocks.map((o) => [o.id, o.index, o.lo, o.hi])).toEqual(
          upTo(full.orderBlocks).map((o) => [o.id, o.index, o.lo, o.hi]),
        );
        expect(part.fvgs.map((o) => [o.id, o.lo, o.hi])).toEqual(
          upTo(full.fvgs).map((o) => [o.id, o.lo, o.hi]),
        );
        expect(part.trendAt).toEqual(full.trendAt.slice(0, k + 1));
        expect(part.htfTrendAt).toEqual(full.htfTrendAt.slice(0, k + 1));
        expect(part.signals).toEqual(full.signals.filter((s) => s.index <= k));
        expect(part.alerts).toEqual(full.alerts.filter((a) => a.index <= k));

        for (const t of part.trades) {
          const same = full.trades.find((x) => x.id === t.id)!;
          expect(same).toBeDefined();
          expect([t.side, t.entryIndex, t.entryPrice, t.sl, t.tp1, t.tp2, t.tpFinal]).toEqual([
            same.side,
            same.entryIndex,
            same.entryPrice,
            same.sl,
            same.tp1,
            same.tp2,
            same.tpFinal,
          ]);
          if (t.status === 'closed') {
            expect(t).toEqual(same);
          }
        }
        expect(full.trades.filter((t) => t.entryIndex <= k).map((t) => t.id)).toEqual(
          part.trades.map((t) => t.id),
        );
      }
    }
    expect(structureSeen).toBeGreaterThan(20);
    expect(tradesSeen).toBeGreaterThan(0);
  });

  it('gives the same answer whether candles arrive at once or one at a time', () => {
    const candles = randomWalk(300, 5);
    const once = analyzeSmc({
      market: 'bank',
      candles,
      intervalMinutes: 15,
      htfMinutes: 60,
      now: FAR_FUTURE,
    });
    let last = once;
    for (let n = 120; n <= candles.length; n += 30) {
      last = analyzeSmc({
        market: 'bank',
        candles: candles.slice(0, n),
        intervalMinutes: 15,
        htfMinutes: 60,
        now: FAR_FUTURE,
      });
    }
    expect(last.signals.map((s) => s.id)).toEqual(
      once.signals.filter((s) => s.index < last.bars).map((s) => s.id),
    );
  });
});

describe('analyzeSmc — live candle', () => {
  it('never lets a still-forming candle create a signal or move history', () => {
    const closed = longScenario([190, 200]);
    const before = run(closed, bullishHtf());
    const forming: Candle = {
      date: stamp(400 + closed.length, 15),
      open: closed[closed.length - 1]!.close,
      high: 10_000,
      low: 1,
      close: 5_000,
      volume: 1,
    };
    const formingStart = Date.parse(
      `${forming.date.slice(0, 19)}+05:30`,
    );
    const live = analyzeSmc({
      market: 'nifty',
      candles: [...closed, forming],
      intervalMinutes: 15,
      htf: { candles: bullishHtf(), minutes: 60 },
      now: new Date(formingStart + 5 * 60_000),
      live: true,
      config: { maxRiskAtr: 12 },
    });
    expect(live.bars).toBe(closed.length);
    expect(live.trades).toEqual(before.trades);
    expect(live.signals).toEqual(before.signals);
    expect(live.structure).toEqual(before.structure);
    expect(live.swings).toEqual(before.swings);
  });

  it('labels a developing entry "SETUP — NOT CONFIRMED" until the candle closes', () => {
    const full = longScenario([190]);
    const trade = run(full, bullishHtf()).trades.find((t) => t.side === 'BUY')!;
    const closed = full.slice(0, trade.entryIndex);
    const forming = full[trade.entryIndex]!;
    const formingStart = Date.parse(`${forming.date.slice(0, 19)}+05:30`);
    const live = analyzeSmc({
      market: 'nifty',
      candles: [...closed, forming],
      intervalMinutes: 15,
      htf: { candles: bullishHtf(), minutes: 60 },
      now: new Date(formingStart + 6 * 60_000),
      live: true,
      config: { maxRiskAtr: 12 },
    });
    expect(live.trades.filter((t) => t.side === 'BUY')).toHaveLength(0);
    expect(live.preview?.label).toBe('SETUP — NOT CONFIRMED');
    expect(live.preview?.kind).toBe('entry');
    expect(live.snapshot.signal).toBe('NONE');
    expect(live.snapshot.setupUnconfirmed).toBe(true);

    const done = analyzeSmc({
      market: 'nifty',
      candles: [...closed, forming],
      intervalMinutes: 15,
      htf: { candles: bullishHtf(), minutes: 60 },
      now: new Date(formingStart + 16 * 60_000),
      live: true,
      config: { maxRiskAtr: 12 },
    });
    expect(done.preview).toBeNull();
    expect(done.trades.filter((t) => t.side === 'BUY')).toHaveLength(1);
    expect(done.snapshot.signal).toBe('BUY');
  });
});

describe('analyzeSmc — higher timeframe', () => {
  it('never reads an HTF bar before it has closed', () => {
    const candles = longScenario([190, 200]);
    const htf = bullishHtf();
    const result = run(candles, htf);
    const lastHtfClose = Date.parse(`${htf[htf.length - 1]!.date.slice(0, 19)}+05:30`) + 3_600_000;
    result.htfTrendAt.forEach((trend, i) => {
      const barClose = Date.parse(`${candles[i]!.date.slice(0, 19)}+05:30`) + 15 * 60_000;
      if (barClose < lastHtfClose - 3_600_000 * htf.length) expect(trend).toBeNull();
    });
    expect(result.htfAvailable).toBe(true);
    expect(result.snapshot.htfTrend).toBe('bullish');
  });

  it('runs on other timeframes without changing the logic', () => {
    const candles = randomWalk(360, 9, 5);
    const a = analyzeSmc({
      market: 'crude',
      candles,
      intervalMinutes: 5,
      htfMinutes: 30,
      now: FAR_FUTURE,
    });
    expect(a.structure.length).toBeGreaterThan(5);
    expect(a.htfAvailable).toBe(true);
    expect(a.snapshot.marketName).toBe('CRUDE OIL');
  });
});

describe('analyzeSmc — statistics', () => {
  it('splits backtest from live and counts signals by side', () => {
    const candles = randomWalk(420, 3);
    const liveDay = new Date(candles[candles.length - 1]!.date);
    const result = analyzeSmc({
      market: 'nifty',
      candles,
      intervalMinutes: 15,
      htfMinutes: 60,
      now: new Date(liveDay.getTime() + 3_600_000 * 24 * 30),
      live: false,
    });
    expect(result.stats.liveFromTs).toBeNull();
    expect(result.stats.live.totalTrades).toBe(0);
    expect(result.stats.backtest.buySignals + result.stats.backtest.sellSignals).toBe(
      result.trades.length,
    );
    const closed = result.trades.filter((t) => t.status === 'closed');
    expect(result.stats.backtest.totalTrades).toBe(closed.length);
    const s = result.stats.backtest;
    expect(s.wins + s.losses + s.breakeven).toBe(s.totalTrades);
    expect(s.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  });
});

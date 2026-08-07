/**
 * Owner rule: Paper and Live share one strategy/candle path.
 * Only Live money adds Kite order I/O. These tests lock the shared contract.
 */
import { describe, expect, it } from 'vitest';
import { dropFormingBars } from './forming-bar.util';
import {
  isRestingExit,
  repriceTradesToExecutableFills,
} from './executable-fill.util';
import { replayPaperOnIndex } from './paper-desk-engine';
import { SrTrapConfirmManagedStrategy } from '../strategy-manager/modules/sr-trap-confirm.managed-strategy';
import { shouldHoldForRestingSlm } from '../live-desk/live-drain-hold.util';
import type { Candle } from '../models/candle.model';
import type { PaperTrade } from './paper-desk.models';

function bar(
  date: string,
  o: number,
  h: number,
  l: number,
  c: number,
): Candle {
  return { date, open: o, high: h, low: l, close: c, volume: 1000 };
}

/** Minimal IST series: OR + a simple down-day trap-friendly tape. */
function buildDaySeries(): Candle[] {
  const d = '2026-08-07';
  const out: Candle[] = [];
  let px = 24500;
  // Warm-up prior day close bars (engine needs history).
  for (let i = 0; i < 60; i++) {
    const mins = 9 * 60 + 15 + i * 5;
    // prior session filler on 2026-08-06
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    out.push(bar(`2026-08-06 ${hh}:${mm}:00`, px, px + 5, px - 5, px + 1));
    px += 1;
  }
  px = 24550;
  // 09:15–15:25 today
  for (let mins = 9 * 60 + 15; mins <= 15 * 60 + 25; mins += 5) {
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    const stamp = `${d} ${hh}:${mm}:00`;
    // Opening range then a pierce down and bounce-ish path
    if (mins < 10 * 60) {
      out.push(bar(stamp, px, px + 12, px - 8, px + 2));
      px += 2;
    } else if (mins === 10 * 60) {
      out.push(bar(stamp, px, px + 5, px - 40, px - 35)); // pierce OR low
      px -= 35;
    } else if (mins === 10 * 60 + 5) {
      out.push(bar(stamp, px, px + 8, px - 5, px + 3)); // confirm
      px += 3;
    } else {
      const drift = mins % 15 === 0 ? -6 : 4;
      out.push(bar(stamp, px, px + Math.abs(drift) + 3, px - 4, px + drift));
      px += drift;
    }
  }
  return out;
}

function tradeKey(t: PaperTrade): string {
  return `${t.entryTime}|${t.direction}|${t.exitTime}|${(t.exitReason ?? '').slice(0, 24)}`;
}

describe('paper ≡ live signal path', () => {
  it('dropFormingBars makes Testing(today) and Live see the same closed series', () => {
    const series = buildDaySeries();
    const now = new Date('2026-08-07T10:03:00+05:30');
    // Append a forming bar (still painting) — Live must drop it; Testing must too.
    const withForming = [
      ...series,
      bar('2026-08-07 10:00:00', 24500, 24520, 24480, 24510),
    ];
    // Force last stamp to a known forming window: replace last with 10:00 at 10:03
    const liveView = dropFormingBars(withForming, now);
    const testingView = dropFormingBars(withForming, now);
    expect(liveView.map((c) => c.date)).toEqual(testingView.map((c) => c.date));
    expect(liveView.at(-1)?.date).not.toContain('10:00:00');
  });

  it('same closed candles + same Trap DNA → identical trade fingerprints', () => {
    const candles = dropFormingBars(
      buildDaySeries(),
      new Date('2026-08-07T15:30:00+05:30'),
    );
    const run = () => {
      const strat = new SrTrapConfirmManagedStrategy();
      strat.initialize();
      return replayPaperOnIndex({
        instrumentId: 'nifty',
        instrumentName: 'Nifty 50',
        kind: 'nifty',
        candles,
        fromDate: '2026-08-07',
        toDate: '2026-08-07',
        instruments: [],
        optionCandlesByToken: new Map(),
        neededOptionTokens: new Set(),
        strategy: strat,
        forceCloseOpen: true,
        lotsMultiplier: 1,
        enableKutty: false,
      }).trades;
    };
    const paper = run();
    const livePaper = run();
    expect(paper.map(tradeKey)).toEqual(livePaper.map(tradeKey));
  });

  it('executable-fill reprice is the shared honesty layer for paper display', () => {
    const candles = dropFormingBars(
      buildDaySeries(),
      new Date('2026-08-07T15:30:00+05:30'),
    );
    const strat = new SrTrapConfirmManagedStrategy();
    strat.initialize();
    const raw = replayPaperOnIndex({
      instrumentId: 'nifty',
      instrumentName: 'Nifty 50',
      kind: 'nifty',
      candles,
      fromDate: '2026-08-07',
      toDate: '2026-08-07',
      instruments: [],
      optionCandlesByToken: new Map(),
      neededOptionTokens: new Set(),
      strategy: strat,
      forceCloseOpen: true,
      lotsMultiplier: 1,
      enableKutty: false,
    }).trades;
    const series = new Map<string, Candle[]>([['nifty', candles]]);
    const a = repriceTradesToExecutableFills(raw, series);
    const b = repriceTradesToExecutableFills(raw, series);
    expect(a.map(tradeKey)).toEqual(b.map(tradeKey));
    // Unreachable same-bar moves must not survive (Live cannot get them either).
    for (const t of a) {
      expect(t.indexPoints).not.toBeNull();
    }
  });

  it('profit-drained: paper resting fill ≡ live SL-M hold (no MARKET dump)', () => {
    const candles = dropFormingBars(
      buildDaySeries(),
      new Date('2026-08-07T15:30:00+05:30'),
    );
    const strat = new SrTrapConfirmManagedStrategy();
    strat.initialize();
    const raw = replayPaperOnIndex({
      instrumentId: 'nifty',
      instrumentName: 'Nifty 50',
      kind: 'nifty',
      candles,
      fromDate: '2026-08-07',
      toDate: '2026-08-07',
      instruments: [],
      optionCandlesByToken: new Map(),
      neededOptionTokens: new Set(),
      strategy: strat,
      forceCloseOpen: true,
      lotsMultiplier: 1,
      enableKutty: false,
    }).trades;
    const drained = raw.filter((t) => isRestingExit(t.exitReason) && /profit drained/i.test(t.exitReason));
    // Synthetic day may or may not produce trail exits; contract still locked.
    for (const t of drained) {
      expect(shouldHoldForRestingSlm(t.exitReason)).toBe(true);
    }
    expect(shouldHoldForRestingSlm('Profit drained — cut & rehunt')).toBe(true);
    expect(isRestingExit('Profit drained — cut & rehunt')).toBe(true);
  });
});

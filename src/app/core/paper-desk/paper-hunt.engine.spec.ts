import { describe, expect, it } from 'vitest';
import { LiveAssumeBar } from './live-assume.engine';
import { emptyBook, emptySession, nightLog, tickBook } from './live-paper.engine';
import {
  PAPER_HUNT_CAP,
  PAPER_HUNT_HONEST,
  PAPER_HUNT_MAX_TRADES,
  PAPER_HUNT_METHODS,
  bestHuntByUnder,
  compactHunt,
  emptyHunt,
  huntMethodCfg,
  profitableHunt,
  rankHunt,
  tickPaperHunt,
} from './paper-hunt.engine';

function upBars(day: string, n = 40): LiveAssumeBar[] {
  return Array.from({ length: n }, (_, i) => {
    const min = 9 * 60 + 45 + i;
    const base = 24000 + i * 8;
    return { day, min, open: base, high: base + 12, low: base - 1, close: base + 8 };
  });
}

describe('paper hunt 50 methods', () => {
  it('lists 50 methods and a 10,000-ticket cap across four names', () => {
    expect(PAPER_HUNT_METHODS).toHaveLength(50);
    expect(new Set(PAPER_HUNT_METHODS.map((m) => m.id)).size).toBe(50);
    expect(PAPER_HUNT_METHODS.some((m) => m.family === 'momentum')).toBe(true);
    expect(PAPER_HUNT_METHODS.some((m) => m.family === 'pattern')).toBe(true);
    expect(PAPER_HUNT_METHODS.some((m) => m.family === 'mix')).toBe(true);
    expect(PAPER_HUNT_METHODS.some((m) => m.family === 'rule')).toBe(true);
    expect(PAPER_HUNT_MAX_TRADES).toBe(50);
    expect(PAPER_HUNT_CAP).toBe(10_000);
    expect(PAPER_HUNT_HONEST).toMatch(/10,000 paper tickets/);
    expect(PAPER_HUNT_HONEST).toMatch(/not 10,000 Kite orders/i);
    expect(PAPER_HUNT_HONEST).toMatch(/max price reached/i);
    expect(PAPER_HUNT_HONEST).toMatch(/max loss reached/i);
    expect(PAPER_HUNT_HONEST).toMatch(/Not a guaranteed profit/);
  });

  it('builds 200 isolated hunt books (50 × 4) that never sit on the live four', () => {
    const hunt = emptyHunt('2026-11-16');
    expect(hunt.books).toHaveLength(200);
    expect(hunt.books.every((b) => b.desk === 'hunt')).toBe(true);
    expect(new Set(hunt.books.map((b) => b.under))).toEqual(new Set(['nifty', 'bank', 'sensex', 'crude']));
    expect(hunt.books.filter((b) => b.under === 'nifty')).toHaveLength(50);
    expect(hunt.books.every((b) => b.id !== 'nifty-momentum')).toBe(true);
  });

  it('records max price and max loss on a closed option ticket', () => {
    const cfg = huntMethodCfg('nifty', PAPER_HUNT_METHODS[0]);
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 100;
    book.sl = 90;
    book.tp = 200;
    book.scratch = 90;
    book.status = 'open';
    book.lot = 65;
    book.optionType = 'CE';
    book.peakPx = 100;
    book.troughPx = 100;
    book.entryMin = 10 * 60;
    book.lastBarMin = 10 * 60;
    const peaked = tickBook(book, cfg, [], 140, '2026-11-16', 10 * 60 + 5, 'NIFTY', [], { bid: 140, ask: 141 });
    expect(peaked.peakPx).toBe(140);
    const dumped = tickBook(peaked, cfg, [], 88, '2026-11-16', 10 * 60 + 8, 'NIFTY', [], { bid: 88, ask: 89 });
    expect(dumped.side).toBe('flat');
    expect(dumped.fills[0].maxPx).toBe(140);
    expect(dumped.fills[0].minPx).toBeLessThanOrEqual(90);
    expect((dumped.fills[0].mfeRs || 0) > (dumped.fills[0].rs || 0)).toBe(true);
    expect((dumped.fills[0].maeRs || 0) <= dumped.fills[0].rs).toBe(true);
  });

  it('CE-only methods skip a down signal', () => {
    const ce = huntMethodCfg('bank', PAPER_HUNT_METHODS.find((m) => m.id === 'mom-08-ce')!);
    expect(ce.onlyDir).toBe(1);
    const pe = huntMethodCfg('bank', PAPER_HUNT_METHODS.find((m) => m.id === 'mom-08-pe')!);
    expect(pe.onlyDir).toBe(-1);
  });

  it('ranks a green method above a loser and names it profitable', () => {
    const hunt = emptyHunt('2026-11-16');
    hunt.stats = hunt.stats.map((s) =>
      s.id === 'bank-mom-08'
        ? { ...s, trades: 2, wins: 2, losses: 0, closedRs: 740, mfeRs: 900, maeRs: -80, avgRs: 370 }
        : s.id === 'nifty-mom-08'
          ? { ...s, trades: 1, wins: 0, losses: 1, closedRs: -370, mfeRs: 40, maeRs: -370, avgRs: -370 }
          : s,
    );
    const ranked = rankHunt(hunt.stats);
    expect(ranked[0].id).toBe('bank-mom-08');
    expect(profitableHunt(hunt.stats).map((s) => s.under)).toEqual(['bank']);
    expect(bestHuntByUnder(hunt.stats).find((s) => s.under === 'bank')?.method).toBe('mom-08');
  });

  it('ticks the hunt on a 0.8× up tape without opening a live Kite book', () => {
    const day = '2026-11-16';
    const bars = upBars(day, 40);
    const nowMin = bars[bars.length - 1].min + 2;
    const q = { bid: 162, ask: 163, last: 162.5 };
    const out = tickPaperHunt({
      prev: emptyHunt(day),
      day,
      nowMin,
      nowIso: '2026-11-16T05:00:00.000Z',
      barsByUnder: new Map([
        ['nifty', bars],
        ['bank', bars],
        ['sensex', bars],
        ['crude', bars],
      ]),
      quotesByUnder: new Map([
        ['nifty', { ce: q, pe: q, underLast: 25200 }],
        ['bank', { ce: q, pe: q, underLast: 58000 }],
        ['sensex', { ce: q, pe: q, underLast: 82000 }],
        ['crude', { ce: q, pe: q, underLast: 5400 }],
      ]),
      picksByUnder: new Map(),
    });
    expect(out.books).toHaveLength(200);
    expect(out.stats).toHaveLength(200);
    expect(out.books.some((b) => b.pendingDir !== 0 || b.side !== 'flat' || b.fills.length > 0 || /confirm|open|skipped/.test(b.reason))).toBe(
      true,
    );
  });

  it('compacts hunt books so 10,000 paper tickets can persist without kite fields', () => {
    const hunt = emptyHunt('2026-11-16');
    hunt.books[0] = {
      ...hunt.books[0],
      kiteNote: 'sent',
      kiteBuyOrderId: '123',
      skips: [{ at: '', day: '2026-11-16', book: hunt.books[0].id, side: 'CE', mode: 'momentum', structure: 'trend', contract: 'x', premium: 1, lot: 65, costRs: 1, budgetRs: 0, reason: 'no-live-quote' }],
      fills: [
        {
          day: '2026-11-16',
          book: hunt.books[0].id,
          label: hunt.books[0].label,
          side: 'long',
          entry: 100,
          exit: 140,
          sl: 90,
          tp: 200,
          pts: 40,
          rs: 2400,
          reason: 'tp',
          mode: 'momentum',
          maxPx: 140,
          minPx: 98,
          mfeRs: 2500,
          maeRs: -80,
          signal: { book: hunt.books[0].id } as never,
        },
      ],
    };
    const out = compactHunt(hunt);
    expect(out.books[0].kiteNote).toBe('');
    expect(out.books[0].kiteBuyOrderId).toBe('');
    expect(out.books[0].skips).toEqual([]);
    expect(out.books[0].fills[0].maxPx).toBe(140);
    expect(out.books[0].fills[0].maeRs).toBe(-80);
    expect(out.books[0].fills[0].signal).toBeNull();
  });

  it('puts profitable hunt methods with max price and max loss on the night log', () => {
    const hunt = emptyHunt('2026-11-16');
    hunt.trades = 3;
    hunt.stats = hunt.stats.map((s) =>
      s.id === 'bank-mom-08-ce'
        ? { ...s, trades: 3, wins: 2, losses: 1, closedRs: 1110, maxPx: 198.4, minPx: 141, mfeRs: 1800, maeRs: -370, avgRs: 370 }
        : s,
    );
    const log = nightLog({ ...emptySession('2026-11-16'), hunt });
    expect(log.hunt?.trades).toBe(3);
    expect(log.hunt?.profitable[0]).toMatchObject({
      id: 'bank-mom-08-ce',
      closedRs: 1110,
      maxPx: 198.4,
      maeRs: -370,
    });
  });
});

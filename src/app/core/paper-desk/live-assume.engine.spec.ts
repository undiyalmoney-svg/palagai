import { describe, expect, it } from 'vitest';
import { PAPER_LIVE_ASSUME } from './paper-live-assume.fixture';
import {
  LIVE_ASSUME_CAPITAL,
  bankTicket,
  booksFundEnd,
  morningStructure,
  summarize,
} from './live-assume.engine';

describe('Live assumption desk', () => {
  it('never claims live orders or a guarantee and isolates ₹14,000', () => {
    expect(PAPER_LIVE_ASSUME.liveOrders).toBe(false);
    expect(PAPER_LIVE_ASSUME.guaranteed).toBe(false);
    expect(PAPER_LIVE_ASSUME.armedOnCrudeBest).toBe(false);
    expect(PAPER_LIVE_ASSUME.assumed).toBe(true);
    expect(PAPER_LIVE_ASSUME.capitalEachRs).toBe(LIVE_ASSUME_CAPITAL);
    expect(PAPER_LIVE_ASSUME.red).toBe(0);
    expect(PAPER_LIVE_ASSUME.books).toHaveLength(4);
    expect(PAPER_LIVE_ASSUME.books.map((b) => b.id)).toEqual(['crude', 'nifty', 'bank', 'sensex']);
    expect(PAPER_LIVE_ASSUME.books.every((b) => b.startRs === 14_000)).toBe(true);
    expect(PAPER_LIVE_ASSUME.honest).toMatch(/Assumption only/);
    expect(PAPER_LIVE_ASSUME.honest).toMatch(/Not a guaranteed profit/);
  });

  it('banks only after-charge profit and refuses a wipe', () => {
    const ok = bankTicket(
      { rs: 200, pts: 25, reason: 'tp', how: 'structure', mode: 'pdhl', structure: 'trend' },
      'crude',
      0,
    );
    expect(ok.status).toBe('banked');
    expect(ok.fundEnd).toBe(14_200);
    const dead = bankTicket(
      { rs: -15_000, pts: -20, reason: 'sl', how: 'structure', mode: 'pdhl', structure: 'trend' },
      'crude',
      0,
    );
    expect(dead.status).toBe('stood');
    const snap = summarize(
      PAPER_LIVE_ASSUME.books,
      'cache',
      null,
      null,
      PAPER_LIVE_ASSUME.asOf,
    );
    expect(snap.liveOrders).toBe(false);
    expect(snap.totalRs).toBe(PAPER_LIVE_ASSUME.totalRs);
    expect(booksFundEnd(PAPER_LIVE_ASSUME.books)).toBe(57_390);
    const withFunds = summarize(
      PAPER_LIVE_ASSUME.books,
      'kite',
      { equityCash: 9_000, equityNet: 9_000, commodityCash: 5_000, commodityNet: 5_000 },
      null,
      PAPER_LIVE_ASSUME.asOf,
    );
    expect(withFunds.honest).toMatch(/equity cash is below/);
    expect(withFunds.honest).toMatch(/commodity cash is below/);
    expect(withFunds.liveOrders).toBe(false);
  });

  it('reads morning structure from opening-range bars only', () => {
    const bars = [
      { day: '2026-10-30', min: 555, open: 100, high: 120, low: 99, close: 118 },
      { day: '2026-10-30', min: 560, open: 118, high: 125, low: 117, close: 124 },
    ];
    expect(morningStructure(bars, '2026-10-30', 555, 615, 10)).toBe('trend');
    expect(morningStructure(bars, '2026-10-30', 555, 615, 40)).toBe('quiet');
  });
});

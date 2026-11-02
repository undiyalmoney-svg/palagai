import { describe, expect, it } from 'vitest';
import {
  LIVE_PAPER_BOOKS,
  LIVE_PAPER_CAPITAL,
  booksFundEnd,
  emptyBook,
  emptySession,
  tickBook,
} from './live-paper.engine';

describe('Live paper desk', () => {
  it('isolates ₹14,000 and never claims a live order or guarantee', () => {
    const snap = emptySession('2026-11-02');
    expect(snap.liveOrders).toBe(false);
    expect(snap.guaranteed).toBe(false);
    expect(snap.armedOnCrudeBest).toBe(false);
    expect(snap.assumed).toBe(true);
    expect(snap.books).toHaveLength(4);
    expect(snap.books.map((b) => b.id)).toEqual(['crude', 'nifty', 'bank', 'sensex']);
    expect(snap.books.every((b) => b.fund === LIVE_PAPER_CAPITAL)).toBe(true);
    expect(booksFundEnd(snap.books)).toBe(56_000);
    expect(snap.honest).toMatch(/Paper only/);
    expect(snap.honest).toMatch(/No Kite order/i);
  });

  it('marks live P/L and banks a target after charges', () => {
    const cfg = LIVE_PAPER_BOOKS[0];
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 100;
    book.sl = 80;
    book.tp = 125;
    book.scratch = 90;
    book.status = 'open';
    const live = tickBook(book, cfg, [], 110, '2026-11-02', 12 * 60, 'CRUDEOILM');
    expect(live.side).toBe('long');
    expect(live.liveRs).toBe(50);
    const done = tickBook(book, cfg, [], 125, '2026-11-02', 12 * 60, 'CRUDEOILM');
    expect(done.side).toBe('flat');
    expect(done.reason).toBe('tp');
    expect(done.closedRs).toBe(200);
    expect(done.fund).toBe(14_200);
    expect(done.fills[0].sl).toBe(80);
    expect(done.fills[0].tp).toBe(125);
  });

  it('shows a scratch as a closed loss so the strategy can be judged', () => {
    const cfg = LIVE_PAPER_BOOKS[0];
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 100;
    book.sl = 80;
    book.tp = 125;
    book.scratch = 90;
    book.status = 'open';
    const done = tickBook(book, cfg, [], 80, '2026-11-02', 12 * 60, 'CRUDEOILM');
    expect(done.reason).toBe('scratch');
    expect(done.closedRs).toBe(-150);
    expect(done.side).toBe('flat');
  });
});

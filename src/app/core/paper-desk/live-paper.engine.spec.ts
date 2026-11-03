import { describe, expect, it } from 'vitest';
import {
  LIVE_PAPER_BOOKS,
  LIVE_PAPER_CAPITAL,
  bindOptionFill,
  booksFundEnd,
  emptyBook,
  emptySession,
  optionPickLabel,
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
    expect(snap.honest).toMatch(/buy CE\/PE/);
    expect(LIVE_PAPER_BOOKS.every((b) => b.buyOption)).toBe(true);
    expect(LIVE_PAPER_BOOKS.map((b) => b.product).join(' ')).toMatch(/CE\/PE/);
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

  it('treats a short-underlying PE as a long premium — up is profit', () => {
    const cfg = LIVE_PAPER_BOOKS[0];
    const book = emptyBook(cfg);
    book.side = 'short';
    book.entry = 150;
    book.sl = 130;
    book.tp = 175;
    book.scratch = 140;
    book.status = 'open';
    book.optionType = 'PE';
    const live = tickBook(book, cfg, [], 160, '2026-11-02', 12 * 60, 'CRUDEOILM26NOV5300PE');
    expect(live.liveRs).toBe(50);
    const done = tickBook(book, cfg, [], 175, '2026-11-02', 12 * 60, 'CRUDEOILM26NOV5300PE');
    expect(done.reason).toBe('tp');
    expect(done.closedRs).toBe(200);
  });

  it('binds a cheap CE fill onto premium SL/TP', () => {
    const cfg = LIVE_PAPER_BOOKS[0];
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 5400;
    book.status = 'open';
    const bound = bindOptionFill(book, cfg, 150, {
      instrument: {
        instrumentToken: 9,
        exchangeToken: 0,
        tradingSymbol: 'CRUDEOILM26NOV5500CE',
        name: 'CRUDEOILM',
        exchange: 'MCX',
        segment: 'MCX-OPT',
        instrumentType: 'CE',
        expiry: '2026-11-17',
        strike: 5500,
        tickSize: 0.05,
        lotSize: 10,
        lastPrice: 150,
      },
      source: 'chain',
      side: 'CE',
      strike: 5500,
      expiry: '2026-11-17',
      lotSize: 10,
      lastPrice: 150,
      openCostRs: 1500,
      fitsBudget: true,
    });
    expect(bound.entry).toBe(150);
    expect(bound.sl).toBe(130);
    expect(bound.tp).toBe(175);
    expect(bound.optionType).toBe('CE');
    expect(bound.instrument).toBe('CRUDEOILM26NOV5500CE');
  });
  it('names the bought contract like SENSEX 77000 CE and keeps it on the closed fill', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'sensex')!;
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 172.55;
    book.sl = 156.55;
    book.tp = 204.55;
    book.scratch = 164.55;
    book.status = 'open';
    book.optionSymbol = 'SENSEX2661077000CE';
    book.optionType = 'CE';
    book.strike = 77000;
    book.expiry = '2026-11-06';
    book.lot = 20;
    expect(optionPickLabel(book)).toBe('SENSEX 77000 CE · exp 6 Nov');
    const done = tickBook(book, cfg, [], 204.55, '2026-11-03', 12 * 60, 'SENSEX2661077000CE');
    expect(done.side).toBe('flat');
    expect(done.fills[0].optionType).toBe('CE');
    expect(done.fills[0].strike).toBe(77000);
    expect(optionPickLabel({ id: 'sensex', ...done.fills[0] })).toBe('SENSEX 77000 CE · exp 6 Nov');
    expect(optionPickLabel({ id: 'sensex' })).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { bookSignal } from './live-assume.engine';
import { optionRoundTripCharges } from './option-charges.util';
import {
  LIVE_PAPER_BOOKS,
  LIVE_PAPER_CAPITAL,
  LIVE_PAPER_COOLDOWN_MIN,
  bindOptionFill,
  optionRangePts,
  optionStopPts,
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

  const mcx = (buy: number, sell: number, qty = 10) =>
    Math.round(((sell - buy) * qty - optionRoundTripCharges(buy, sell, qty, 'MCX')) * 10) / 10;

  it('marks live P/L and banks a target after exact charges', () => {
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
    expect(live.liveRs).toBe(mcx(100, 110));
    expect(live.liveRs).toBeLessThan(100 - 40);
    const done = tickBook(book, cfg, [], 125, '2026-11-02', 12 * 60, 'CRUDEOILM');
    expect(done.side).toBe('flat');
    expect(done.reason).toBe('tp');
    expect(done.closedRs).toBe(mcx(100, 125));
    expect(done.fund).toBe(Math.round((14_000 + mcx(100, 125)) * 10) / 10);
    expect(done.fills[0].sl).toBe(80);
    expect(done.fills[0].tp).toBe(125);
  });

  it('shows a stop as a closed loss, checking the stop before any scratch', () => {
    const cfg = LIVE_PAPER_BOOKS[0];
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 100;
    book.sl = 80;
    book.tp = 125;
    book.scratch = 90;
    book.status = 'open';
    const done = tickBook(book, cfg, [], 80, '2026-11-02', 12 * 60, 'CRUDEOILM');
    expect(done.reason).toBe('sl');
    expect(done.fills[0].exit).toBe(80);
    expect(done.closedRs).toBe(mcx(100, 80));
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
    expect(live.liveRs).toBe(mcx(150, 160));
    const done = tickBook(book, cfg, [], 175, '2026-11-02', 12 * 60, 'CRUDEOILM26NOV5300PE');
    expect(done.reason).toBe('tp');
    expect(done.closedRs).toBe(mcx(150, 175));
  });

  const crudePick = () => ({
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

  it('binds a cheap CE fill onto premium SL/TP: target 2× stop, no separate scratch', () => {
    const cfg = LIVE_PAPER_BOOKS[0];
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 5400;
    book.status = 'open';
    const bound = bindOptionFill(book, cfg, 150, crudePick() as never);
    expect(bound.entry).toBe(150);
    expect(bound.sl).toBe(130);
    expect(bound.tp).toBe(190);
    expect(bound.scratch).toBe(bound.sl);
    expect(bound.optionType).toBe('CE');
    expect(bound.instrument).toBe('CRUDEOILM26NOV5500CE');
  });

  it('widens the stop to 1.5× the option 5-min range and keeps target at 2× stop', () => {
    const cfg = LIVE_PAPER_BOOKS[0];
    const bars = [10, 30, 20, 20, 25].map((r, k) => ({ day: '2026-11-04', min: 600 + 5 * k, open: 100, high: 100 + r, low: 100, close: 100 }));
    expect(optionRangePts(bars)).toBe(20);
    expect(optionRangePts(bars.slice(0, 2))).toBeNull();
    expect(optionStopPts(cfg, 20)).toEqual({ sl: 30, tp: 60 });
    expect(optionStopPts(cfg, 4)).toEqual({ sl: cfg.sl, tp: Math.max(cfg.tp, 2 * cfg.sl) });
    const book = emptyBook(cfg);
    book.side = 'long';
    book.status = 'open';
    const bound = bindOptionFill(book, cfg, 150, crudePick() as never, 20);
    expect(bound.sl).toBe(120);
    expect(bound.tp).toBe(210);
  });

  it('counts a losing close, starts a 60-min cooldown and does not re-open on the same tick', () => {
    const cfg = LIVE_PAPER_BOOKS[0];
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 100;
    book.sl = 80;
    book.tp = 125;
    book.scratch = 80;
    book.status = 'open';
    book.lastBarMin = 11 * 60;
    const bars = [
      { day: '2026-11-04', min: 11 * 60 + 5, open: 5400, high: 5420, low: 5395, close: 5418 },
      { day: '2026-11-04', min: 11 * 60 + 10, open: 5418, high: 5440, low: 5415, close: 5438 },
    ];
    const done = tickBook({ ...book, pendingDir: 0 }, cfg, bars, 79, '2026-11-04', 11 * 60 + 20, 'CRUDEOILM');
    expect(done.side).toBe('flat');
    expect(done.lossesToday).toBe(1);
    expect(done.cooldownUntil).toBe(11 * 60 + 20 + LIVE_PAPER_COOLDOWN_MIN);
    expect(done.lastBarMin).toBe(11 * 60 + 10);
    expect(done.fills).toHaveLength(1);
  });

  it('blocks a confirmed entry during cooldown and after two losses', () => {
    const cfg = LIVE_PAPER_BOOKS[0];
    const bars = [{ day: '2026-11-04', min: 12 * 60, open: 5400, high: 5420, low: 5395, close: 5418 }];
    const pending = () => {
      const b = emptyBook(cfg);
      b.pendingDir = 1;
      b.pendingSig = 5410;
      b.pendingMode = 'pdhl';
      b.lastBarMin = 11 * 60 + 55;
      return b;
    };
    const cooling = tickBook({ ...pending(), cooldownUntil: 12 * 60 + 30 }, cfg, bars, 5418, '2026-11-04', 12 * 60 + 6, 'CRUDEOILM');
    expect(cooling.side).toBe('flat');
    expect(cooling.reason).toBe('cooldown after loss');
    const stopped = tickBook({ ...pending(), lossesToday: 2 }, cfg, bars, 5418, '2026-11-04', 12 * 60 + 6, 'CRUDEOILM');
    expect(stopped.side).toBe('flat');
    expect(stopped.reason).toMatch(/day stop/);
    const free = tickBook({ ...pending(), cooldownUntil: 11 * 60 }, cfg, bars, 5418, '2026-11-04', 12 * 60 + 6, 'CRUDEOILM');
    expect(free.side).toBe('long');
  });

  it('fires pdhl only on the bar that crosses the previous-day high', () => {
    const cfg = { ...LIVE_PAPER_BOOKS[0], pdMax: 1e9 };
    const bars = [
      { day: '2026-11-03', min: 600, open: 100, high: 110, low: 95, close: 105 },
      { day: '2026-11-04', min: 600, open: 106, high: 109, low: 105, close: 108 },
      { day: '2026-11-04', min: 605, open: 108, high: 113, low: 107, close: 112 },
      { day: '2026-11-04', min: 610, open: 112, high: 116, low: 111, close: 115 },
    ];
    expect(bookSignal('pdhl', bars, 2, cfg)).toBe(1);
    expect(bookSignal('pdhl', bars, 3, cfg)).toBe(0);
    expect(bookSignal('pdhl', bars, 3, { ...cfg, freshCross: false })).toBe(1);
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
  it('never exits an option on index bars: 76,500 index high is not a hit on a 205 premium target', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'sensex')!;
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 172.55;
    book.sl = 156.55;
    book.tp = 204.55;
    book.scratch = 164.55;
    book.status = 'open';
    book.lastBarMin = 12 * 60;
    const indexBars = [
      { day: '2026-11-03', min: 12 * 60 + 5, open: 76500, high: 76600, low: 76450, close: 76550 },
    ];
    const held = tickBook(book, cfg, indexBars, 170, '2026-11-03', 12 * 60 + 20, 'SENSEX');
    expect(held.side).toBe('long');
    expect(held.fills).toHaveLength(0);

    const optionBars = [
      { day: '2026-11-03', min: 12 * 60 + 5, open: 172, high: 175, low: 150, close: 152 },
    ];
    const stopped = tickBook(book, cfg, indexBars, 152, '2026-11-03', 12 * 60 + 20, 'SENSEX', optionBars);
    expect(stopped.side).toBe('flat');
    expect(stopped.fills[0].reason).toBe('sl');
    expect(stopped.fills[0].exit).toBe(156.55);

    const target = [{ day: '2026-11-03', min: 12 * 60 + 5, open: 172, high: 206, low: 171, close: 205 }];
    const won = tickBook(book, cfg, indexBars, 205, '2026-11-03', 12 * 60 + 20, 'SENSEX', target);
    expect(won.fills[0].reason).toBe('tp');
  });

  it('fills a stop at the gap open, not the better stop level, and a target at the target level', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'sensex')!;
    const mk = () => {
      const b = emptyBook(cfg);
      b.side = 'long';
      b.entry = 172.55;
      b.sl = 156.55;
      b.tp = 204.55;
      b.scratch = 164.55;
      b.status = 'open';
      b.lastBarMin = 12 * 60;
      return b;
    };
    const gapDown = [{ day: '2026-11-03', min: 12 * 60 + 5, open: 140, high: 150, low: 138, close: 145 }];
    const gapped = tickBook(mk(), cfg, [], 145, '2026-11-03', 12 * 60 + 20, 'SENSEX', gapDown);
    expect(gapped.fills[0].reason).toBe('sl');
    expect(gapped.fills[0].exit).toBe(140);

    const gapUp = [{ day: '2026-11-03', min: 12 * 60 + 5, open: 230, high: 240, low: 229, close: 235 }];
    const won = tickBook(mk(), cfg, [], 235, '2026-11-03', 12 * 60 + 20, 'SENSEX', gapUp);
    expect(won.fills[0].reason).toBe('tp');
    expect(won.fills[0].exit).toBe(204.55);
  });
});

import { describe, expect, it } from 'vitest';
import { bookSignal, momentumGauge, momentumSignal } from './live-assume.engine';
import { optionRoundTripCharges } from './option-charges.util';
import {
  LIVE_PAPER_BOOKS,
  LIVE_PAPER_CAPITAL,
  LIVE_PAPER_BANK_RS,
  LIVE_PAPER_STOP_RS,
  LIVE_PAPER_TARGET_RS,
  LIVE_PAPER_CRUDE_MOM_K,
  LIVE_PAPER_COOLDOWN_MIN,
  PAPER_TEST_HONEST,
  PAPER_SCALP_BOOKS,
  bindOptionFill,
  nightLog,
  optionRangePts,
  optionStopPts,
  restoreDayStops,
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
    expect(new Set(snap.books.map((b) => b.under))).toEqual(new Set(['crude', 'nifty', 'bank', 'sensex']));
    expect(new Set(snap.books.map((b) => b.desk))).toEqual(new Set(['momentum']));
    expect(snap.books.every((b) => b.fund === LIVE_PAPER_CAPITAL)).toBe(true);
    expect(booksFundEnd(snap.books)).toBe(56_000);
    expect(snap.honest).toMatch(/Paper only/);
    expect(snap.honest).toMatch(/No Kite order/i);
    expect(snap.honest).toMatch(/buy CE\/PE/);
    expect(LIVE_PAPER_BOOKS).toHaveLength(4);
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
    const cfg = { ...LIVE_PAPER_BOOKS[0], stopPct: undefined, targetPct: undefined, stopRs: undefined, targetRs: undefined };
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
    const cfg = { ...LIVE_PAPER_BOOKS[0], stopPct: undefined, targetPct: undefined, stopRs: undefined, targetRs: undefined };
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
    const cfg = { ...LIVE_PAPER_BOOKS[0], strategy: 'rules' as const, noConfirm: false, dayStops: true };
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
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'sensex-momentum')!;
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
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'sensex-momentum')!;
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
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'sensex-momentum')!;
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

  it('does not stop an ATM CE on the option minute that was still forming when we bought', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'nifty-momentum')!;
    const mk = () => {
      const b = emptyBook(cfg);
      b.side = 'long';
      b.entry = 149;
      b.sl = 147.46;
      b.tp = 151.31;
      b.scratch = 147.46;
      b.status = 'open';
      b.lot = 65;
      b.optionSymbol = 'NIFTY26N0924650CE';
      b.optionType = 'CE';
      b.entryMin = 9 * 60 + 57;
      b.lastBarMin = 9 * 60 + 56;
      return b;
    };
    const sameMinute = [
      { day: '2026-11-06', min: 9 * 60 + 57, open: 138.8, high: 149.2, low: 138.8, close: 146 },
    ];
    const held = tickBook(mk(), cfg, [], 138.8, '2026-11-06', 9 * 60 + 58, 'NIFTY', sameMinute, {
      bid: 145.75,
      ask: 146.05,
    });
    expect(held.side).toBe('long');
    expect(held.fills).toHaveLength(0);
    expect(held.lastBarMin).toBe(9 * 60 + 57);
    expect(held.liveRs).toBeLessThan(0);

    const later = [{ day: '2026-11-06', min: 9 * 60 + 58, open: 140, high: 146, low: 139, close: 141 }];
    const stopped = tickBook({ ...mk(), lastBarMin: 9 * 60 + 57 }, cfg, [], 141, '2026-11-06', 9 * 60 + 59, 'NIFTY', later);
    expect(stopped.side).toBe('flat');
    expect(stopped.fills[0].reason).toBe('sl');
    expect(stopped.fills[0].exit).toBe(140);

    const bidFill = tickBook(
      { ...mk(), lastBarMin: 9 * 60 + 57 },
      cfg,
      [],
      141,
      '2026-11-06',
      9 * 60 + 59,
      'NIFTY',
      later,
      { bid: 167.8, ask: 168 },
    );
    expect(bidFill.side).toBe('long');
    expect(bidFill.fills).toHaveLength(0);

    const soldAtBid = tickBook(
      { ...mk(), lastBarMin: 9 * 60 + 57 },
      cfg,
      [],
      141,
      '2026-11-06',
      9 * 60 + 59,
      'NIFTY',
      later,
      { bid: 145.75, ask: 146.05 },
    );
    expect(soldAtBid.side).toBe('flat');
    expect(soldAtBid.fills[0].reason).toBe('sl');
    expect(soldAtBid.fills[0].exit).toBe(145.75);
  });

  it('binds the fill to the current minute so older option candles cannot stop it', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'nifty-momentum')!;
    const book = { ...emptyBook(cfg), side: 'long' as const, status: 'open' as const, lastBarMin: 9 * 60 + 56 };
    const bound = bindOptionFill(book, cfg, 149, { ...crudePick(), lotSize: 65 } as never, null, 9 * 60 + 57);
    expect(bound.entryMin).toBe(9 * 60 + 57);
    expect(bound.lastBarMin).toBe(9 * 60 + 57);
    expect(bound.sl).toBe(143.31);
  });

  it('rebuilds today\'s loss count and cooldown from the saved fills', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'nifty-momentum')!;
    const book = emptyBook(cfg);
    const fill = (rs: number, exitAt: string, day = '2026-11-04') =>
      ({ day, book: 'nifty', label: 'Nifty', side: 'long', entry: 90, exit: 88, sl: 85, tp: 100, pts: -2, rs, reason: 'scratch', mode: 'pdhl', exitAt }) as never;
    book.fills = [
      fill(-209, '2026-11-04T05:55:00.000Z'),
      fill(600, '2026-11-04T06:57:00.000Z'),
      fill(-222, '2026-11-04T07:19:00.000Z'),
      fill(-300, '2026-11-03T07:19:00.000Z', '2026-11-03'),
    ];
    const restored = restoreDayStops(book, '2026-11-04');
    expect(restored.lossesToday).toBe(2);
    expect(restored.cooldownUntil).toBe(12 * 60 + 49 + 60);
  });

  const flatBars = (day: string, n: number, startMin: number, px = 100, rng = 2) =>
    Array.from({ length: n }, (_, k) => ({ day, min: startMin + 5 * k, open: px, high: px + rng / 2, low: px - rng / 2, close: px }));

  it('trades only Nifty, Bank, Sensex and evening Crude Mini momentum', () => {
    const by = (under: string) => LIVE_PAPER_BOOKS.find((b) => b.id === `${under}-momentum`)!;
    expect(LIVE_PAPER_BOOKS).toHaveLength(4);
    expect(LIVE_PAPER_BOOKS.every((b) => b.strategy === 'momentum' && b.desk === 'momentum')).toBe(true);
    for (const under of ['nifty', 'bank', 'sensex']) {
      expect(by(under)).toMatchObject({
        strategy: 'momentum',
        stopRs: LIVE_PAPER_STOP_RS,
        targetRs: LIVE_PAPER_TARGET_RS,
        minDayNetRs: LIVE_PAPER_BANK_RS,
        holdBars: 60,
        maxTradesPerDay: 5,
        barMinutes: 1,
        momK: 0.8,
        atm: true,
        noConfirm: false,
        dayStops: true,
        orE: 9 * 60 + 30,
      });
      expect(by(under).skipStructures).toBeUndefined();
    }
    expect(by('crude')).toMatchObject({
      strategy: 'momentum',
      stopRs: LIVE_PAPER_STOP_RS,
      targetRs: LIVE_PAPER_TARGET_RS,
      minDayNetRs: LIVE_PAPER_BANK_RS,
      barMinutes: 1,
      momK: LIVE_PAPER_CRUDE_MOM_K,
      entryS: 17 * 60 + 15,
      orS: 17 * 60,
      noConfirm: false,
    });
    expect(PAPER_TEST_HONEST).toMatch(/Not a guaranteed profit/);
    expect(PAPER_TEST_HONEST).toMatch(/evening only/);
    expect(PAPER_TEST_HONEST).toMatch(/Daily bank ₹370/);
  });

  it('fires momentum only past 1.5×√6 × the 20-bar mean range, from the 7th bar of the day', () => {
    const prev = flatBars('2026-11-03', 20, 13 * 60 + 35);
    const today = flatBars('2026-11-04', 7, 9 * 60 + 15);
    const bars = [...prev, ...today];
    const i = bars.length - 1;
    const thr = 1.5 * 2 * Math.sqrt(6);
    bars[i] = { ...bars[i], close: 100 + thr + 0.1, high: 100 + thr + 0.2 };
    expect(momentumSignal(bars, i)).toBe(1);
    bars[i] = { ...bars[i], close: 100 - thr - 0.1, low: 100 - thr - 0.2, high: 101 };
    expect(momentumSignal(bars, i)).toBe(-1);
    bars[i] = { ...bars[i], close: 100 + thr - 0.5, low: 99 };
    expect(momentumSignal(bars, i)).toBe(0);
    const early = [...prev, ...today.slice(0, 6)];
    early[early.length - 1] = { ...early[early.length - 1], close: 130, high: 131 };
    expect(momentumSignal(early, early.length - 1)).toBe(0);
    expect(momentumGauge(early, early.length - 1)?.sessionBars).toBe(6);
    const small = [...prev, ...today];
    small[small.length - 1] = { ...small[small.length - 1], close: 100 + thr * 0.6, high: 100 + thr * 0.6 };
    expect(momentumSignal(small, small.length - 1)).toBe(0);
    expect(momentumSignal(small, small.length - 1, 0.8)).toBe(1);
  });

  it('opens momentum after the confirm bar, binds ₹370 / ₹370 and exits on time', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'nifty-momentum')!;
    const bars = [...flatBars('2026-11-03', 20, 13 * 60 + 35, 24000), ...flatBars('2026-11-04', 7, 9 * 60 + 15, 24000)];
    const last = bars.length - 1;
    bars[last] = { ...bars[last], close: 24020, high: 24021 };
    const book = { ...emptyBook(cfg), lastBarMin: 9 * 60 + 40 };
    const pending = tickBook(book, cfg, bars, 24020, '2026-11-04', 9 * 60 + 51, 'NIFTY 50');
    expect(pending.side).toBe('flat');
    expect(pending.pendingDir).toBe(1);
    expect(pending.reason).toMatch(/confirm momentum/);
    const more = [
      ...bars,
      { day: '2026-11-04', min: 9 * 60 + 50, open: 24021, high: 24030, low: 24020, close: 24028 },
    ];
    const opened = tickBook(pending, cfg, more, 24028, '2026-11-04', 9 * 60 + 56, 'NIFTY 50');
    expect(opened.side).toBe('long');
    expect(opened.mode).toBe('momentum');
    expect(opened.entry).toBe(24021);
    expect(opened.entryMin).toBe(9 * 60 + 51);
    expect(opened.gauge?.move).toBeGreaterThan(opened.gauge?.need ?? 0);
    const late = tickBook(book, cfg, bars, 24020, '2026-11-04', 10 * 60 + 10, 'NIFTY 50');
    expect(late.side).toBe('flat');
    expect(late.pendingDir).toBe(0);
    expect(late.reason).toMatch(/missed/);
    const bound = bindOptionFill(opened, cfg, 100, { ...crudePick(), lotSize: 65 } as never);
    expect(bound.sl).toBe(94.31);
    expect(bound.tp).toBe(105.69);
    const held = tickBook({ ...bound, lot: 65 }, cfg, [], 100, '2026-11-04', 9 * 60 + 51 + 55, 'NIFTY');
    expect(held.side).toBe('long');
    const timed = tickBook({ ...bound, lot: 65 }, cfg, [], 100, '2026-11-04', 9 * 60 + 51 + 60, 'NIFTY');
    expect(timed.side).toBe('flat');
    expect(timed.fills[0].reason).toBe('time');
  });

  it('binds a ₹370 bank and a ₹370 stop on an expensive ATM', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'nifty-momentum')!;
    const book = { ...emptyBook(cfg), side: 'long' as const, status: 'open' as const };
    const dear = bindOptionFill(book, cfg, 336.6, { ...crudePick(), lotSize: 65 } as never);
    expect(Math.round((336.6 - (dear.sl ?? 0)) * 65)).toBe(LIVE_PAPER_STOP_RS);
    expect(Math.round(((dear.tp ?? 0) - 336.6) * 65)).toBe(LIVE_PAPER_TARGET_RS);
  });

  it('stops Nifty momentum after ₹370 net or 5 trades that day', () => {
    const nifty = LIVE_PAPER_BOOKS.find((b) => b.id === 'nifty-momentum')!;
    const bars = [...flatBars('2026-11-03', 20, 13 * 60 + 35, 24000), ...flatBars('2026-11-04', 7, 9 * 60 + 15, 24000)];
    bars[bars.length - 1] = { ...bars[bars.length - 1], close: 24020, high: 24021 };
    const win = { day: '2026-11-04', book: 'nifty', label: 'Nifty', side: 'long', entry: 1, exit: 1, sl: 1, tp: 1, pts: 0, rs: 40, reason: 'tp', mode: 'momentum' };
    const loss = { ...win, rs: -100, reason: 'sl' };
    const banked = { ...emptyBook(nifty), lastBarMin: 9 * 60 + 40, fills: [{ ...win, rs: 200 }, { ...win, rs: 180 }] as never };
    const locked = tickBook(banked, nifty, bars, 24020, '2026-11-04', 9 * 60 + 51, 'NIFTY 50');
    expect(locked.side).toBe('flat');
    expect(locked.reason).toBe('banked ₹370 today');
    const five = { ...emptyBook(nifty), lastBarMin: 9 * 60 + 40, fills: [loss, loss, win, win, loss] as never };
    const capped = tickBook(five, nifty, bars, 24020, '2026-11-04', 9 * 60 + 51, 'NIFTY 50');
    expect(capped.side).toBe('flat');
    expect(capped.reason).toBe('max 5 trades today');
    const yday = { ...win, day: '2026-11-03', rs: 400 };
    const fresh = { ...emptyBook(nifty), lastBarMin: 9 * 60 + 40, fills: [yday, yday, yday] as never };
    const nextDay = tickBook(fresh, nifty, bars, 24020, '2026-11-04', 9 * 60 + 51, 'NIFTY 50');
    expect(nextDay.pendingDir).toBe(1);
    expect(nextDay.reason).toMatch(/confirm momentum/);
  });

  it('does not open or flatten a day of missed bars when Start is after the session', () => {
    const nifty = LIVE_PAPER_BOOKS.find((b) => b.id === 'nifty-momentum')!;
    const crude = LIVE_PAPER_BOOKS.find((b) => b.id === 'crude-momentum')!;
    const prev = flatBars('2026-11-04', 20, 15 * 60, 24000);
    const niftyDay = Array.from({ length: 375 }, (_, k) => {
      const min = 9 * 60 + 15 + k;
      const thrust = min === 10 * 60;
      return {
        day: '2026-11-05',
        min,
        open: thrust ? 24000 : 23990,
        high: thrust ? 24040 : 23995,
        low: 23980,
        close: thrust ? 24035 : 23990,
      };
    });
    const crudeDay = Array.from({ length: 400 }, (_, k) => {
      const min = 17 * 60 + k;
      const thrust = min === 17 * 60 + 30;
      return {
        day: '2026-11-05',
        min,
        open: thrust ? 5400 : 5380,
        high: thrust ? 5460 : 5385,
        low: 5370,
        close: thrust ? 5450 : 5380,
      };
    });
    const lateNifty = tickBook(emptyBook(nifty), nifty, [...prev, ...niftyDay], 24000, '2026-11-05', 20 * 60 + 33, 'NIFTY 50');
    expect(lateNifty.side).toBe('flat');
    expect(lateNifty.fills).toHaveLength(0);
    expect(lateNifty.pendingDir).toBe(0);
    const lateCrude = tickBook(emptyBook(crude), crude, crudeDay, 5400, '2026-11-05', 20 * 60 + 33, 'CRUDEOILM');
    expect(lateCrude.side).toBe('flat');
    expect(lateCrude.fills).toHaveLength(0);
    expect(lateCrude.pendingDir).toBe(0);
  });

  it('writes a night log with desk totals and every closed fill', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'nifty-momentum')!;
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 100;
    book.sl = 60;
    book.tp = 200;
    book.scratch = 60;
    book.status = 'open';
    book.lot = 65;
    book.optionType = 'CE';
    book.strike = 24000;
    book.expiry = '2026-11-06';
    book.optionSymbol = 'NIFTY26N0624000CE';
    book.entryMin = 10 * 60;
    book.lastBarMin = 10 * 60 + 30;
    const done = tickBook(book, cfg, [], 60, '2026-11-05', 10 * 60 + 45, 'NIFTY');
    const snap = emptySession('2026-11-05');
    snap.books = snap.books.map((b) => (b.id === cfg.id ? done : b));
    snap.closedRs = done.closedRs;
    const log = nightLog(snap);
    expect(log.desks).toHaveLength(1);
    const mom = log.desks.find((d) => d.desk === 'momentum')!;
    expect(mom.trades).toBe(1);
    expect(mom.losses).toBe(1);
    expect(log.fills[0]).toMatchObject({
      desk: 'momentum',
      under: 'nifty',
      reason: 'sl',
      optionType: 'CE',
      strike: 24000,
    });
    expect(log.fills[0].charges).toBeGreaterThan(0);
    expect(log.fills[0].holdMin).toBe(45);
  });

  it('keeps scalp off the five CE/PE desks and sizes stop/target as 0.15% / 0.25%', () => {
    expect(PAPER_SCALP_BOOKS).toHaveLength(4);
    expect(PAPER_SCALP_BOOKS.every((b) => b.desk === 'scalp' && b.buyOption === false)).toBe(true);
    expect(PAPER_SCALP_BOOKS.map((b) => b.id)).toEqual([
      'crude-scalp',
      'reliance-scalp',
      'hdfcbank-scalp',
      'infy-scalp',
    ]);
    const cfg = PAPER_SCALP_BOOKS.find((b) => b.id === 'reliance-scalp')!;
    const book = { ...emptyBook(cfg), lastBarMin: 9 * 60 + 25 };
    const bars = [
      { day: '2026-11-05', min: 9 * 60 + 15, open: 1400, high: 1402, low: 1398, close: 1401 },
      { day: '2026-11-05', min: 9 * 60 + 20, open: 1401, high: 1403, low: 1400, close: 1402 },
      { day: '2026-11-05', min: 9 * 60 + 30, open: 1412, high: 1414, low: 1408, close: 1409 },
    ];
    const opened = tickBook(book, cfg, bars, 1409, '2026-11-05', 9 * 60 + 41, 'RELIANCE');
    expect(opened.side).toBe('flat');
    expect(opened.reason).toMatch(/watch only/);
    expect(cfg.strategy).toBe('watch');
    const armed = { ...cfg, strategy: 'rules' as const };
    const live = tickBook(book, armed, bars, 1409, '2026-11-05', 9 * 60 + 41, 'RELIANCE');
    expect(live.side).toBe('short');
    expect(live.sl).toBeCloseTo(1409 * 1.0015, 1);
    expect(live.tp).toBeCloseTo(1409 * 0.9975, 1);
  });
});

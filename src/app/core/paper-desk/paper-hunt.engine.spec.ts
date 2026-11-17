import { describe, expect, it } from 'vitest';
import { CheapOtmPick } from '../utils/pick-cheap-otm.util';
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
  mergeHunt,
  slimHunt,
  filterHuntMethodRows,
  huntLeaderCopyLine,
  huntLeaders,
  huntLeadersCopyText,
  huntMethodCfg,
  huntInstrumentSummary,
  huntMethodRows,
  huntSummaries,
  huntTabNet,
  huntTickets,
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

describe('paper hunt methods', () => {
  const n = PAPER_HUNT_METHODS.length;
  const books = n * 4;
  const capText = PAPER_HUNT_CAP.toLocaleString('en-IN');

  it('lists momentum, pattern, mix, rule and algo methods with a four-name ticket cap', () => {
    expect(n).toBe(103);
    expect(new Set(PAPER_HUNT_METHODS.map((m) => m.id)).size).toBe(n);
    expect(PAPER_HUNT_METHODS.some((m) => m.family === 'momentum')).toBe(true);
    expect(PAPER_HUNT_METHODS.some((m) => m.family === 'pattern')).toBe(true);
    expect(PAPER_HUNT_METHODS.some((m) => m.family === 'mix')).toBe(true);
    expect(PAPER_HUNT_METHODS.some((m) => m.family === 'rule')).toBe(true);
    expect(PAPER_HUNT_METHODS.some((m) => m.family === 'algo')).toBe(true);
    expect(PAPER_HUNT_METHODS.filter((m) => m.family === 'algo').length).toBeGreaterThanOrEqual(14);
    expect(PAPER_HUNT_METHODS.map((m) => m.id)).toEqual(expect.arrayContaining([
      'algo-ema-cross',
      'algo-donch20',
      'algo-rsi',
      'algo-macd',
      'algo-supertrend',
      'algo-ema-ce',
      'mix-supertrend',
      'mom-08-tp370',
      'open5-zone',
      'open5-zone-ce',
      'open5-zone-pe',
    ]));
    expect(PAPER_HUNT_MAX_TRADES).toBe(50);
    expect(PAPER_HUNT_CAP).toBe(PAPER_HUNT_MAX_TRADES * 4 * n);
    expect(PAPER_HUNT_HONEST).toContain(`${n} methods`);
    expect(PAPER_HUNT_HONEST).toMatch(/algo/);
    expect(PAPER_HUNT_HONEST).toContain(`${capText} paper tickets`);
    expect(PAPER_HUNT_HONEST).toMatch(new RegExp(`not ${capText} Kite orders`, 'i'));
    expect(PAPER_HUNT_HONEST).toMatch(/max profit reached/i);
    expect(PAPER_HUNT_HONEST).toMatch(/max loss reached/i);
    expect(PAPER_HUNT_HONEST).toMatch(/not a guaranteed next move/i);
    expect(PAPER_HUNT_HONEST).toMatch(/Not a guaranteed profit/);
    expect(PAPER_HUNT_HONEST).toMatch(/Index tickets from 09:45 IST/);
    expect(PAPER_HUNT_HONEST).toMatch(/Crude Mini from 09:15 IST/);
  });

  it('builds isolated hunt books (methods × 4) that never sit on the live four', () => {
    const hunt = emptyHunt('2026-11-16');
    expect(hunt.books).toHaveLength(books);
    expect(hunt.books.every((b) => b.desk === 'hunt')).toBe(true);
    expect(new Set(hunt.books.map((b) => b.under))).toEqual(new Set(['nifty', 'bank', 'sensex', 'crude']));
    expect(hunt.books.filter((b) => b.under === 'nifty')).toHaveLength(n);
    expect(hunt.books.every((b) => b.id !== 'nifty-momentum')).toBe(true);
    expect(hunt.books.some((b) => b.id === 'nifty-algo-ema-cross')).toBe(true);
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

  it('algo methods use named book signals, not the 0.8× momentum patch', () => {
    const ema = huntMethodCfg('nifty', PAPER_HUNT_METHODS.find((m) => m.id === 'algo-ema-cross')!);
    expect(ema.strategy).toBe('rules');
    expect(ema.primary).toEqual({ trend: 'ema_cross', range: 'ema_cross', quiet: 'ema_cross', stand: 'ema_cross' });
    expect(ema.desk).toBe('hunt');
    const rsi = huntMethodCfg('bank', PAPER_HUNT_METHODS.find((m) => m.id === 'algo-rsi')!);
    expect(rsi.primary['trend']).toBe('rsi14');
    const skip = huntMethodCfg('sensex', PAPER_HUNT_METHODS.find((m) => m.id === 'algo-ema-skip-range')!);
    expect(skip.skipStructures).toEqual(['range']);
    const mom = huntMethodCfg('bank', PAPER_HUNT_METHODS.find((m) => m.id === 'mom-06')!);
    expect(mom.entryS).toBe(9 * 60 + 45);
    const vwap = huntMethodCfg('nifty', PAPER_HUNT_METHODS.find((m) => m.id === 'vwap-stretch')!);
    expect(vwap.entryS).toBe(9 * 60 + 45);
    const crudeMom = huntMethodCfg('crude', PAPER_HUNT_METHODS.find((m) => m.id === 'mom-08')!);
    expect(crudeMom.entryS).toBe(9 * 60 + 15);
    const zone = huntMethodCfg('nifty', PAPER_HUNT_METHODS.find((m) => m.id === 'open5-zone')!);
    expect(zone.strategy).toBe('rules');
    expect(zone.primary['trend']).toBe('open5_zone');
    expect(zone.entryS).toBe(9 * 60 + 20);
    const crudeZone = huntMethodCfg('crude', PAPER_HUNT_METHODS.find((m) => m.id === 'open5-zone')!);
    expect(crudeZone.entryS).toBe(9 * 60 + 5);
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

  it('lists one instrument tab from high profit to high loss', () => {
    const hunt = emptyHunt('2026-11-16');
    const niftyMom = hunt.books.find((b) => b.id === 'nifty-mom-08')!;
    const niftyPe = hunt.books.find((b) => b.id === 'nifty-mom-08-pe')!;
    const bankMom = hunt.books.find((b) => b.id === 'bank-mom-08')!;
    niftyMom.fills = [
      {
        day: '2026-11-16',
        book: niftyMom.id,
        label: niftyMom.label,
        side: 'long',
        entry: 162,
        exit: 141,
        sl: 156,
        tp: 170,
        pts: -21,
        rs: -370,
        reason: 'sl',
        mode: 'momentum',
        optionType: 'CE',
        strike: 25250,
        expiry: '2026-11-17',
        optionSymbol: 'NIFTY26N1725250CE',
        entryAt: '2026-11-16T04:00:00.000Z',
        exitAt: '2026-11-16T04:10:00.000Z',
        mfeRs: 80,
        maeRs: -370,
      },
      {
        day: '2026-11-16',
        book: niftyMom.id,
        label: niftyMom.label,
        side: 'long',
        entry: 160,
        exit: 168,
        sl: 154,
        tp: 168,
        pts: 8,
        rs: 1977,
        reason: 'tp',
        mode: 'momentum',
        optionType: 'CE',
        strike: 25250,
        expiry: '2026-11-17',
        optionSymbol: 'NIFTY26N1725250CE',
        entryAt: '2026-11-16T05:00:00.000Z',
        exitAt: '2026-11-16T05:00:10.000Z',
        mfeRs: 2400,
        maeRs: -90,
      },
    ];
    niftyPe.fills = [
      {
        day: '2026-11-16',
        book: niftyPe.id,
        label: niftyPe.label,
        side: 'short',
        entry: 150,
        exit: 142,
        sl: 156,
        tp: 140,
        pts: 8,
        rs: 520,
        reason: 'tp',
        mode: 'momentum',
        optionType: 'PE',
        strike: 25200,
        expiry: '2026-11-17',
        optionSymbol: 'NIFTY26N1725200PE',
        entryAt: '2026-11-16T06:00:00.000Z',
        exitAt: '2026-11-16T06:12:00.000Z',
      },
    ];
    bankMom.fills = [
      {
        day: '2026-11-16',
        book: bankMom.id,
        label: bankMom.label,
        side: 'long',
        entry: 400,
        exit: 420,
        sl: 380,
        tp: 420,
        pts: 20,
        rs: 1110,
        reason: 'tp',
        mode: 'momentum',
        optionType: 'CE',
        strike: 58000,
        expiry: '2026-11-17',
        optionSymbol: 'BANKNIFTY26N1758000CE',
        entryAt: '2026-11-16T04:30:00.000Z',
        exitAt: '2026-11-16T04:31:00.000Z',
      },
    ];
    hunt.stats = hunt.stats.map((s) =>
      s.id === 'nifty-mom-08'
        ? { ...s, trades: 2, closedRs: 1607 }
        : s.id === 'nifty-mom-08-pe'
          ? { ...s, trades: 1, closedRs: 520 }
          : s.id === 'bank-mom-08'
            ? { ...s, trades: 1, closedRs: 1110 }
            : s,
    );
    const nifty = huntTickets(hunt, 'nifty');
    expect(nifty.map((r) => r.rs)).toEqual([1977, 520, -370]);
    expect(nifty.every((r) => r.under === 'nifty')).toBe(true);
    expect(nifty[0]).toMatchObject({
      methodLabel: 'mom 0.8× both',
      exit: 'tp',
      sl: 154,
      entryPx: 160,
      exitPx: 168,
      mfeRs: 2400,
      maeRs: -90,
      open: false,
    });
    expect(nifty[2]).toMatchObject({ rs: -370, mfeRs: 80, maeRs: -370 });
    expect(nifty[0].entry).toMatch(/CE/);
    expect(huntTickets(hunt, 'bank')).toHaveLength(1);
    expect(huntTickets(hunt, 'bank')[0]).toMatchObject({ rs: 1110, entryPx: 400, exitPx: 420 });
    expect(huntTickets(hunt, 'sensex')).toEqual([]);
    expect(huntTickets(hunt, 'crude')).toEqual([]);
    expect(huntTabNet(hunt, 'nifty')).toBe(2127);
    expect(huntTabNet(hunt, 'sensex')).toBe(0);
    const niftyMethods = huntMethodRows(hunt, 'nifty');
    expect(niftyMethods).toHaveLength(PAPER_HUNT_METHODS.length);
    expect(niftyMethods[0]).toMatchObject({
      method: 'mom-08',
      trades: 2,
      wins: 1,
      losses: 1,
      winPct: 50,
      slHits: 1,
      closedRs: 1607,
      mfeRs: 2400,
      maeRs: -370,
      floorMfeRs: 80,
      lastEntryPx: 160,
      lastExitPx: 168,
    });
    expect(filterHuntMethodRows(niftyMethods, 'traded').map((r) => r.method)).toEqual(['mom-08', 'mom-08-pe']);
    expect(filterHuntMethodRows(niftyMethods, 'green').every((r) => r.closedRs > 0)).toBe(true);
    expect(huntLeaders(hunt)[0]).toMatchObject({
      under: 'nifty',
      underLabel: 'Nifty 50',
      method: 'mom-08',
      closedRs: 1607,
    });
    expect(huntLeaders(hunt).some((r) => r.under === 'bank' && r.closedRs === 1110)).toBe(true);
    expect(huntLeaderCopyLine(huntLeaders(hunt)[0])).toBe('Nifty 50 · mom 0.8× both · ₹1,607');
    expect(huntLeadersCopyText(huntLeaders(hunt))).toContain('Bank Nifty · mom 0.8× both · ₹1,110');
    const niftySum = huntInstrumentSummary(hunt, 'nifty');
    expect(niftySum).toMatchObject({
      trades: 3,
      wins: 2,
      losses: 1,
      profitRs: 2497,
      lossRs: -370,
      bestLabel: 'mom 0.8× both',
      worstLabel: 'mom 0.8× PE only',
      slLabel: 'mom 0.8× both',
      slHits: 1,
    });
    expect(huntSummaries(hunt)).toHaveLength(4);
  });

  it('lists an open Nifty ticket with live mark as exit price so P/L can be checked against premium', () => {
    const hunt = emptyHunt('2026-11-16');
    const book = hunt.books.find((b) => b.id === 'nifty-mom-08')!;
    book.side = 'long';
    book.entry = 118.4;
    book.last = 124.9;
    book.liveRs = 370;
    book.lot = 65;
    book.sl = 110;
    book.optionType = 'CE';
    book.strike = 25950;
    book.expiry = '2026-11-17';
    book.optionSymbol = 'NIFTY26N1725950CE';
    book.entryAt = '2026-11-16T05:02:00.000Z';
    const rows = huntTickets(hunt, 'nifty');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: 'mom-08',
      open: true,
      exit: 'open',
      lot: 65,
      entryPx: 118.4,
      exitPx: 124.9,
      rs: 370,
    });
    expect(rows[0].entry).toMatch(/25950 CE/);
    const method = huntMethodRows(hunt, 'nifty').find((r) => r.method === 'mom-08')!;
    expect(method).toMatchObject({ lastEntryPx: 118.4, lastExitPx: 124.9, open: true });
    expect(huntTickets(hunt, 'bank')).toEqual([]);
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
    expect(out.books).toHaveLength(PAPER_HUNT_METHODS.length * 4);
    expect(out.stats).toHaveLength(PAPER_HUNT_METHODS.length * 4);
    expect(out.books.some((b) => b.pendingDir !== 0 || b.side !== 'flat' || b.fills.length > 0 || /confirm|open|skipped/.test(b.reason))).toBe(
      true,
    );
  });

  it('keeps a skip note when the chain has no listed contract so the blotter is not a silent zero', () => {
    const day = '2026-11-16';
    const bars = upBars(day, 40);
    const out = tickPaperHunt({
      prev: emptyHunt(day),
      day,
      nowMin: bars[bars.length - 1].min + 2,
      nowIso: '2026-11-16T05:00:00.000Z',
      barsByUnder: new Map([
        ['nifty', bars],
        ['bank', bars],
        ['sensex', bars],
        ['crude', bars],
      ]),
      quotesByUnder: new Map(),
      picksByUnder: new Map(),
    });
    expect(out.books.some((b) => b.reason === 'skipped: no listed contract')).toBe(true);
    expect(out.feed).toMatch(/skipped: no listed contract/);
    expect(huntMethodRows(out, 'nifty').some((r) => r.note === 'skipped: no listed contract')).toBe(true);
    expect(huntInstrumentSummary(out, 'nifty').open).toBe(0);
  });

  it('drops index-priced Bank/Sensex tickets so P/L cannot print in crores', () => {
    const day = '2026-11-16';
    const hunt = emptyHunt(day);
    const bank = hunt.books.find((b) => b.id === 'bank-algo-donch20')!;
    bank.fills = [
      {
        day,
        book: bank.id,
        label: bank.label,
        side: 'long',
        entry: 15_715,
        exit: 58_040,
        sl: 15_700,
        tp: 15_800,
        pts: 12_425,
        rs: 372_749,
        reason: 'eod',
        mode: 'open',
        optionType: 'CE',
        strike: 200,
        expiry: '2026-11-17',
        optionSymbol: 'BANKNIFTY26N17200CE',
        entryAt: '2026-11-16T04:00:00.000Z',
        exitAt: '2026-11-16T04:31:00.000Z',
      },
    ];
    bank.closedRs = 372_749;
    bank.side = 'long';
    bank.entry = 15_715;
    bank.last = 58_040;
    const q = { bid: 58_040, ask: 58_100, last: 58_040 };
    const out = tickPaperHunt({
      prev: hunt,
      day,
      nowMin: 10 * 60,
      nowIso: '2026-11-16T04:30:00.000Z',
      barsByUnder: new Map([
        ['nifty', upBars(day, 20)],
        ['bank', upBars(day, 20).map((b) => ({ ...b, open: 58_000, high: 58_100, low: 57_900, close: 58_050 }))],
        ['sensex', upBars(day, 20)],
        ['crude', upBars(day, 20)],
      ]),
      quotesByUnder: new Map([
        ['nifty', { ce: { bid: 162, ask: 163, last: 162.5 }, pe: { bid: 162, ask: 163, last: 162.5 }, underLast: 25_200 }],
        ['bank', { ce: q, pe: q, underLast: 58_040 }],
        ['sensex', { ce: q, pe: q, underLast: 82_100 }],
        ['crude', { ce: { bid: 14, ask: 15, last: 14.5 }, pe: { bid: 14, ask: 15, last: 14.5 }, underLast: 5_400 }],
      ]),
      picksByUnder: new Map(),
    });
    const bankOut = out.books.find((b) => b.id === 'bank-algo-donch20')!;
    expect(bankOut.fills).toHaveLength(0);
    expect(Math.abs(bankOut.closedRs)).toBeLessThan(50_000);
    expect(Math.abs(bankOut.liveRs)).toBeLessThan(50_000);
    expect(out.books.every((b) => Math.abs(b.closedRs) < 50_000 && Math.abs(b.liveRs) < 50_000)).toBe(true);
    expect(Math.abs(huntInstrumentSummary(out, 'bank').profitRs)).toBeLessThan(50_000);
  });

  it('compacts hunt books so the full paper-ticket cap can persist without kite fields', () => {
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
    expect(out.books[0]?.skips).toHaveLength(1);
    expect(out.books[0]?.skips?.[0]?.reason).toBe('no-live-quote');
    expect(out.books[0].fills[0].maxPx).toBe(140);
    expect(out.books[0].fills[0].maeRs).toBe(-80);
    expect(out.books[0].fills[0].signal).toBeNull();
    const slim = slimHunt(hunt);
    expect(slim.books).toHaveLength(1);
    const restored = mergeHunt(slim, emptyHunt('2026-11-16'), '2026-11-16');
    expect(restored.books).toHaveLength(PAPER_HUNT_METHODS.length * 4);
    expect(restored.books[0].fills).toHaveLength(1);
    expect(restored.books[0].fills[0].rs).toBe(2400);
    expect(restored.trades).toBe(1);
  });

  it('keeps printed tickets when the droplet hunt is empty or the method count changed', () => {
    const day = '2026-11-16';
    const local = emptyHunt(day);
    local.books[0] = {
      ...local.books[0],
      fills: [
        {
          day,
          book: local.books[0].id,
          label: local.books[0].label,
          side: 'long',
          entry: 118.4,
          exit: 124.9,
          sl: 110,
          tp: 140,
          pts: 6.5,
          rs: 370,
          reason: 'time',
          mode: 'momentum',
          lot: 65,
        },
      ],
      closedRs: 370,
    };
    const remote = emptyHunt(day);
    const kept = mergeHunt(local, remote, day);
    expect(kept.books[0].fills).toHaveLength(1);
    expect(kept.books[0].fills[0].rs).toBe(370);
    expect(kept.trades).toBe(1);
    const slimPrev = slimHunt(local);
    expect(slimPrev.books).toHaveLength(1);
    const ticked = tickPaperHunt({
      prev: slimPrev,
      day,
      nowMin: 11 * 60,
      nowIso: '2026-11-16T05:30:00.000Z',
      barsByUnder: new Map(),
      quotesByUnder: new Map(),
      picksByUnder: new Map(),
    });
    expect(ticked.books.find((b) => b.id === local.books[0].id)?.fills).toHaveLength(1);
    expect(ticked.trades).toBeGreaterThanOrEqual(1);
  });

  it('opens a Crude Mini hunt ticket from the chain last when MCX depth is empty', () => {
    const day = '2026-11-16';
    const bars = Array.from({ length: 40 }, (_, i) => {
      const min = 9 * 60 + i;
      const base = 5400 + i * 3;
      return { day, min, open: base, high: base + 6, low: base - 1, close: base + 3 };
    });
    const pick = (side: 'CE' | 'PE'): CheapOtmPick => ({
      instrument: {
        instrumentToken: 99,
        exchangeToken: 1,
        tradingSymbol: `CRUDEOILM26NOV5400${side}`,
        name: 'CRUDEOILM',
        lastPrice: 139.4,
        expiry: '2026-11-17',
        strike: 5400,
        tickSize: 0.1,
        lotSize: 10,
        instrumentType: side,
        segment: 'MCX-OPT',
        exchange: 'MCX',
      },
      source: 'chain',
      side,
      strike: 5400,
      expiry: '2026-11-17',
      lotSize: 10,
      lastPrice: 139.4,
      openCostRs: 1394,
      fitsBudget: true,
    });
    const emptyQ = { bid: null, ask: null, last: null };
    const nowMin = bars[bars.length - 1].min + 2;
    const out = tickPaperHunt({
      prev: emptyHunt(day),
      day,
      nowMin,
      nowIso: '2026-11-16T04:45:00.000Z',
      barsByUnder: new Map([
        ['nifty', upBars(day, 10)],
        ['bank', upBars(day, 10)],
        ['sensex', upBars(day, 10)],
        ['crude', bars],
      ]),
      quotesByUnder: new Map([
        ['nifty', { ce: emptyQ, pe: emptyQ, underLast: 25200 }],
        ['bank', { ce: emptyQ, pe: emptyQ, underLast: 58000 }],
        ['sensex', { ce: emptyQ, pe: emptyQ, underLast: 82100 }],
        ['crude', { ce: emptyQ, pe: emptyQ, underLast: 5517 }],
      ]),
      picksByUnder: new Map([['crude', { ce: pick('CE'), pe: pick('PE') }]]),
    });
    const crude = out.books.filter((b) => b.under === 'crude' || b.id.startsWith('crude-'));
    expect(crude.some((b) => b.side !== 'flat' || b.fills.length > 0)).toBe(true);
    expect(
      crude.every((b) => {
        const px = b.side !== 'flat' ? b.entry : b.fills[0]?.entry;
        return px == null || px < 1_000;
      }),
    ).toBe(true);
    expect(Math.abs(huntInstrumentSummary(out, 'crude').maxCapitalRs)).toBeLessThan(20_000);
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

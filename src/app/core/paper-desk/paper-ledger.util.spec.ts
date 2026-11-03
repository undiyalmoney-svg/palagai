import { describe, expect, it } from 'vitest';
import { LIVE_PAPER_BOOKS, LivePaperFill, emptyBook, tickBook } from './live-paper.engine';
import { realisticFill } from './execution-model.util';
import { emptyLedger, fillToTrade, mergeFills, observeDay } from './paper-ledger.util';

function fill(over: Partial<LivePaperFill> = {}): LivePaperFill {
  return {
    day: '2026-11-03',
    book: 'sensex',
    label: 'Sensex',
    side: 'long',
    entry: 172.55,
    exit: 156.55,
    sl: 156.55,
    tp: 204.55,
    pts: -16,
    rs: -370,
    reason: 'sl',
    mode: 'pdhl',
    optionType: 'CE',
    strike: 77000,
    expiry: '2026-11-06',
    lot: 20,
    optionSymbol: 'SENSEX2661077000CE',
    entryAt: '2026-11-03T05:40:00.000Z',
    exitAt: '2026-11-03T06:10:00.000Z',
    ...over,
  };
}

describe('paper ledger', () => {
  it('records a losing trade exactly as the engine closed it', () => {
    const t = fillToTrade(fill());
    expect(t.paperNetRs).toBe(-370);
    expect(t.qty).toBe(20);
    expect(t.optionType).toBe('CE');
    expect(t.strike).toBe(77000);
    expect(t.entryBid).toBeNull();
  });

  it('adds each fill once and keeps earlier trades untouched', () => {
    const a = mergeFills(emptyLedger(), [fill()]);
    const b = mergeFills(a, [fill(), fill({ entry: 150, exit: 182, reason: 'tp', rs: 590, exitAt: '2026-11-03T07:00:00.000Z' })]);
    expect(a.trades).toHaveLength(1);
    expect(b.trades).toHaveLength(2);
    expect(b.trades[0]).toBe(a.trades[0]);
    expect(mergeFills(b, [fill()])).toBe(b);
  });

  it('orders newly closed trades by exit time', () => {
    const s = mergeFills(emptyLedger(), [
      fill({ entry: 1, exitAt: '2026-11-03T09:00:00.000Z' }),
      fill({ entry: 2, exitAt: '2026-11-03T08:00:00.000Z' }),
    ]);
    expect(s.trades.map((t) => t.entry)).toEqual([2, 1]);
  });

  it('tracks observed days once, sorted, so quiet days still count', () => {
    let s = observeDay(emptyLedger(), '2026-11-03');
    s = observeDay(s, '2026-11-02');
    expect(observeDay(s, '2026-11-02')).toBe(s);
    expect(s.observedDays).toEqual(['2026-11-02', '2026-11-03']);
  });

  it('carries an engine-closed loss all the way into the ledger and the realistic P&L', () => {
    const cfg = LIVE_PAPER_BOOKS.find((b) => b.id === 'nifty')!;
    const book = emptyBook(cfg);
    book.side = 'long';
    book.entry = 100;
    book.sl = 95;
    book.tp = 110;
    book.scratch = 97.6;
    book.status = 'open';
    book.structure = 'range';
    book.optionType = 'PE';
    book.strike = 23500;
    book.lot = 65;
    book.entryBid = 99.5;
    book.entryAsk = 100.5;
    book.entryAt = '2026-11-03T05:40:00.000Z';
    const closed = tickBook(book, cfg, [], 97, '2026-11-03', 10 * 60, 'NIFTY');
    expect(closed.fills).toHaveLength(1);
    const ledger = mergeFills(emptyLedger(), closed.fills);
    const t = ledger.trades[0];
    expect(t.paperNetRs).toBeLessThan(0);
    expect(t.structure).toBe('range');
    expect(t.entryAsk).toBe(100.5);
    expect(realisticFill(t).netRs).toBeLessThan(t.paperNetRs);
  });
});

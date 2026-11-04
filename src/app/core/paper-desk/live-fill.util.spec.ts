import { describe, expect, it } from 'vitest';
import { emptyBook, LIVE_PAPER_BOOKS } from './live-paper.engine';
import { liveBuyPrice, lotCostRs, neededLotQuote, replayBudgetSkips } from './live-fill.util';

describe('liveBuyPrice', () => {
  it('pays the ask like a live buy', () => {
    expect(liveBuyPrice(580.55, 575)).toEqual({ price: 580.55, atAsk: true });
  });

  it('falls back to last only when the ask is missing', () => {
    expect(liveBuyPrice(null, 575)).toEqual({ price: 575, atAsk: false });
    expect(liveBuyPrice(0, 0)).toEqual({ price: null, atAsk: false });
  });
});

describe('lotCostRs / neededLotQuote', () => {
  it('shows the cash needed to buy one lot', () => {
    expect(lotCostRs(580.55, 30)).toBe(17417);
    const q = neededLotQuote('BANKNIFTY26NOV56200CE', 30, 580.55, 575);
    expect(q).toEqual({
      contract: 'BANKNIFTY26NOV56200CE',
      premium: 580.55,
      costRs: 17417,
      atAsk: true,
      lot: 30,
    });
    expect(neededLotQuote('X', 30, null, null)).toBeNull();
  });
});

describe('replayBudgetSkips', () => {
  it('rewinds a flat book that was only skipped for budget, so today can still take that signal', () => {
    const book = emptyBook(LIVE_PAPER_BOOKS.find((b) => b.id === 'bank')!);
    book.lastBarMin = 10 * 60 + 15;
    book.skips = [
      {
        at: '2026-11-04T04:45:00.000Z',
        day: '2026-11-04',
        book: 'bank',
        side: 'CE',
        mode: 'pdhl',
        structure: 'trend',
        contract: 'BANKNIFTY26NOV56200CE',
        premium: 580.55,
        lot: 30,
        costRs: 17417,
        budgetRs: 3500,
        reason: 'premium-over-budget',
      },
    ];
    const next = replayBudgetSkips(book);
    expect(next.lastBarMin).toBe(-1);
    expect(next.skips).toEqual([]);
    expect(next.reason).toMatch(/live-priced/);
  });

  it('does not rewind a book that already filled today', () => {
    const book = emptyBook(LIVE_PAPER_BOOKS.find((b) => b.id === 'sensex')!);
    book.lastBarMin = 11 * 60;
    book.fills = [{ day: '2026-11-04', book: 'sensex', label: 'Sensex', side: 'long', entry: 150, exit: 160, sl: 140, tp: 180, pts: 10, rs: 150, reason: 'tp', mode: 'pdhl' }];
    book.skips = [
      {
        at: '2026-11-04T04:00:00.000Z',
        day: '2026-11-04',
        book: 'sensex',
        side: 'CE',
        mode: 'pdhl',
        structure: 'trend',
        contract: 'SENSEX',
        premium: 200,
        lot: 20,
        costRs: 4000,
        budgetRs: 3500,
        reason: 'premium-over-budget',
      },
    ];
    expect(replayBudgetSkips(book).lastBarMin).toBe(11 * 60);
  });
});

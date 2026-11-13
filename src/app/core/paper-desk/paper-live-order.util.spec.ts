import { describe, expect, it } from 'vitest';
import {
  PAPER_LIVE_BUY_TAG,
  PAPER_LIVE_EXIT_TAG,
  PAPER_LIVE_SL_TAG,
  kiteOrderErrorOf,
  kiteOrderIdOf,
  emptyPaperLiveBooks,
  keepPaperOnKite,
  overlayPaperWithKite,
  paperLiveBuyHalted,
  paperLiveArmed,
  paperLiveArmedFor,
  paperLiveBuyFields,
  paperLiveExchange,
  paperLiveExitFields,
  paperLiveQuantity,
  paperLiveStopFields,
} from './paper-live-order.util';

describe('paper live Kite tickets', () => {
  const nifty = { under: 'nifty', optionSymbol: 'NIFTY26N1224500CE', optionToken: 11, lot: 65 };
  const sensex = { under: 'sensex', optionSymbol: 'SENSEX26N1982200PE', optionToken: 22, lot: 20 };
  const crude = { under: 'crude', optionSymbol: 'CRUDEOILM26NOV8050PE', optionToken: 33, lot: 10 };

  it('arms a book only when Live radio is on and that book is ticked', () => {
    const none = emptyPaperLiveBooks();
    const nifty = { ...none, nifty: true };
    expect(paperLiveArmed(false, nifty)).toBe(false);
    expect(paperLiveArmed(true, none)).toBe(false);
    expect(paperLiveArmed(true, nifty)).toBe(true);
    expect(paperLiveArmedFor(true, nifty, 'nifty')).toBe(true);
    expect(paperLiveArmedFor(true, nifty, 'bank')).toBe(false);
    expect(paperLiveArmedFor(true, nifty, 'sensex')).toBe(false);
    expect(paperLiveArmedFor(true, nifty, 'crude')).toBe(false);
  });

  it('keeps the paper fill when Kite overlay fails or returns a flat book', () => {
    const paper = {
      side: 'long' as const,
      fills: [{ rs: 224.6, reason: 'time' }],
      closedRs: 224.6,
      entry: 192.5,
      kiteBuyOrderId: '',
      kiteSlOrderId: '',
      kiteNote: '',
    };
    const dropped = keepPaperOnKite(paper, {
      kiteNote: 'Insufficient funds',
      kiteBuyOrderId: '',
    });
    expect(dropped.side).toBe('long');
    expect(dropped.fills).toEqual(paper.fills);
    expect(dropped.closedRs).toBe(224.6);
    expect(dropped.entry).toBe(192.5);
    expect(dropped.kiteNote).toBe('Insufficient funds');
    const live = keepPaperOnKite(paper, { kiteBuyOrderId: '9', kiteSlOrderId: '10', kiteNote: 'Kite buy 9' });
    expect(live.fills).toEqual(paper.fills);
    expect(live.kiteBuyOrderId).toBe('9');
  });

  it('keeps paper fills when the Kite overlay throws', async () => {
    const paper = {
      side: 'long' as const,
      fills: [{ rs: 224.6, reason: 'time' }],
      closedRs: 224.6,
      kiteNote: '',
      kiteHalt: false,
    };
    const next = await overlayPaperWithKite(paper, async () => {
      throw new Error('Insufficient funds');
    }, kiteOrderErrorOf);
    expect(next.side).toBe('long');
    expect(next.fills).toEqual(paper.fills);
    expect(next.closedRs).toBe(224.6);
    expect(next.kiteNote).toMatch(/Insufficient funds/);
    expect(next.kiteHalt).toBe(true);
    expect(paperLiveBuyHalted(next)).toBe(true);
  });

  it('does not send another BUY after a reject on the same fill', () => {
    expect(paperLiveBuyHalted({ kiteHalt: true, kiteBuyOrderId: '' })).toBe(true);
    expect(paperLiveBuyHalted({ kiteHalt: true, kiteBuyOrderId: '9' })).toBe(false);
    expect(paperLiveBuyHalted({ kiteHalt: false, kiteBuyOrderId: '' })).toBe(false);
  });

  it('sends Crude Mini qty 1 and Sensex on BFO', () => {
    expect(paperLiveQuantity('crude', 10)).toBe(1);
    expect(paperLiveQuantity('nifty', 65)).toBe(65);
    expect(paperLiveQuantity('bank', 30)).toBe(30);
    expect(paperLiveQuantity('sensex', 20)).toBe(20);
    expect(paperLiveExchange('crude')).toBe('MCX');
    expect(paperLiveExchange('sensex')).toBe('BFO');
    expect(paperLiveExchange('bank')).toBe('NFO');
  });

  it('refuses a synthetic contract and builds MARKET buy + SL + exit', () => {
    expect(paperLiveBuyFields({ ...nifty, optionToken: 0 })).toBeNull();
    const buy = paperLiveBuyFields(nifty)!;
    expect(buy).toMatchObject({
      exchange: 'NFO',
      tradingsymbol: nifty.optionSymbol,
      transaction_type: 'BUY',
      order_type: 'MARKET',
      quantity: '65',
      product: 'MIS',
      tag: PAPER_LIVE_BUY_TAG,
    });
    const sl = paperLiveStopFields(sensex, 777.9)!;
    expect(sl).toMatchObject({
      exchange: 'BFO',
      transaction_type: 'SELL',
      order_type: 'SL',
      quantity: '20',
      trigger_price: '777.90',
      tag: PAPER_LIVE_SL_TAG,
    });
    expect(Number(sl['price'])).toBeLessThan(Number(sl['trigger_price']));
    const exit = paperLiveExitFields(crude)!;
    expect(exit).toMatchObject({
      exchange: 'MCX',
      quantity: '1',
      order_type: 'MARKET',
      transaction_type: 'SELL',
      tag: PAPER_LIVE_EXIT_TAG,
    });
  });

  it('reads a Kite order id and error body', () => {
    expect(kiteOrderIdOf({ data: { order_id: '123456' } })).toBe('123456');
    expect(kiteOrderIdOf({ data: { data: { order_id: '99' } } })).toBe('99');
    expect(kiteOrderIdOf({})).toBeNull();
    expect(kiteOrderErrorOf({ error: { message: 'Insufficient funds' } })).toBe('Insufficient funds');
  });
});

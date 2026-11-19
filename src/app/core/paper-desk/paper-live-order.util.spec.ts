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
  paperLiveBuyPlaced,
  paperLiveOpenBuyId,
  kiteOrderDead,
  paperLiveArmed,
  paperLiveArmedFor,
  paperLiveBuyFields,
  paperLiveExchange,
  paperLiveExitFields,
  paperLiveQuantity,
  paperLiveSlLimitPx,
  paperLiveStopFields,
  PAPER_LIVE_SL_LIMIT_SLIP_RS,
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
    expect(paperLiveBuyPlaced(next)).toBe(false);
  });

  it('treats a live BUY id as placed and retries after a reject', () => {
    expect(paperLiveBuyPlaced({ kiteBuyOrderId: '9' })).toBe(true);
    expect(paperLiveBuyPlaced({ kiteBuyOrderId: '' })).toBe(false);
    expect(kiteOrderDead('REJECTED')).toBe(true);
    expect(kiteOrderDead('COMPLETE')).toBe(false);
    expect(
      paperLiveOpenBuyId(
        [
          { order_id: '1', tradingsymbol: 'CRUDEOILM26NOV8300PE', transaction_type: 'BUY', tag: PAPER_LIVE_BUY_TAG, status: 'REJECTED' },
          { order_id: '2', tradingsymbol: 'CRUDEOILM26NOV8300PE', transaction_type: 'BUY', tag: PAPER_LIVE_BUY_TAG, status: 'COMPLETE' },
        ],
        'CRUDEOILM26NOV8300PE',
      ),
    ).toBe('2');
  });

  it('sends Crude Mini qty 1 and Sensex on BFO', () => {
    expect(paperLiveQuantity('crude', 10)).toBe(1);
    expect(paperLiveQuantity('nifty', 65)).toBe(65);
    expect(paperLiveQuantity('bank', 30)).toBe(30);
    expect(paperLiveQuantity('sensex', 20)).toBe(20);
    expect(paperLiveQuantity('reliance', 50)).toBe(50);
    expect(paperLiveExchange('crude')).toBe('MCX');
    expect(paperLiveExchange('sensex')).toBe('BFO');
    expect(paperLiveExchange('bank')).toBe('NFO');
    expect(paperLiveExchange('hdfcbank')).toBe('NSE');
    expect(paperLiveExchange('tcs')).toBe('NSE');
  });

  it('refuses a synthetic contract and builds MARKET buy + SL + exit', () => {
    expect(paperLiveBuyFields({ ...nifty, optionToken: 0 })).toBeNull();
    const stockBuy = paperLiveBuyFields({
      under: 'infy',
      optionSymbol: 'INFY',
      optionToken: 408065,
      lot: 50,
    })!;
    expect(stockBuy).toMatchObject({
      exchange: 'NSE',
      tradingsymbol: 'INFY',
      quantity: '50',
      product: 'MIS',
      order_type: 'MARKET',
    });
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
    expect((Number(sl['trigger_price']) - Number(sl['price'])) * 20).toBeLessThanOrEqual(
      PAPER_LIVE_SL_LIMIT_SLIP_RS + 1,
    );
    const stock = paperLiveStopFields({ under: 'reliance', optionSymbol: 'RELIANCE', optionToken: 738561, lot: 50 }, 1392.6)!;
    expect(stock).toMatchObject({
      exchange: 'NSE',
      tradingsymbol: 'RELIANCE',
      order_type: 'SL-M',
      quantity: '50',
      trigger_price: '1392.60',
    });
    expect(stock['price']).toBeUndefined();
    const exit = paperLiveExitFields(crude)!;
    expect(exit).toMatchObject({
      exchange: 'MCX',
      quantity: '1',
      order_type: 'MARKET',
      transaction_type: 'SELL',
      tag: PAPER_LIVE_EXIT_TAG,
    });
  });

  it('caps the F&O SL limit at ₹80 extra, not 10% of premium', () => {
    const bankTrig = 383.75;
    const tenPctLoss = (bankTrig - bankTrig * 0.9) * 30;
    expect(tenPctLoss).toBeGreaterThan(1100);
    const limit = paperLiveSlLimitPx(bankTrig, 30);
    expect((bankTrig - limit) * 30).toBeLessThanOrEqual(PAPER_LIVE_SL_LIMIT_SLIP_RS + 2);
    const nifty = paperLiveStopFields(
      { under: 'nifty', optionSymbol: 'NIFTY26NOV25250PE', optionToken: 11, lot: 65 },
      165.2,
    )!;
    expect((165.2 - Number(nifty['price'])) * 65).toBeLessThanOrEqual(PAPER_LIVE_SL_LIMIT_SLIP_RS + 4);
    const sensexSl = paperLiveStopFields(sensex, 626.45)!;
    expect((Number(sensexSl['trigger_price']) - Number(sensexSl['price'])) * 20).toBeLessThanOrEqual(
      PAPER_LIVE_SL_LIMIT_SLIP_RS + 2,
    );
  });

  it('reads a Kite order id and error body', () => {
    expect(kiteOrderIdOf({ data: { order_id: '123456' } })).toBe('123456');
    expect(kiteOrderIdOf({ data: { data: { order_id: '99' } } })).toBe('99');
    expect(kiteOrderIdOf({ error: { data: { order_id: '7' } } })).toBe('7');
    expect(kiteOrderIdOf({})).toBeNull();
    expect(kiteOrderErrorOf({ error: { message: 'Insufficient funds' } })).toBe('Insufficient funds');
  });
});

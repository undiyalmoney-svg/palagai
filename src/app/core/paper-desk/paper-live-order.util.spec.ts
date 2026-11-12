import { describe, expect, it } from 'vitest';
import {
  PAPER_LIVE_BUY_TAG,
  PAPER_LIVE_EXIT_TAG,
  PAPER_LIVE_SL_TAG,
  kiteOrderErrorOf,
  kiteOrderIdOf,
  paperLiveArmed,
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

  it('arms only when the toggle and the checkbox are both on', () => {
    expect(paperLiveArmed(false, false)).toBe(false);
    expect(paperLiveArmed(true, false)).toBe(false);
    expect(paperLiveArmed(false, true)).toBe(false);
    expect(paperLiveArmed(true, true)).toBe(true);
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
    expect(kiteOrderIdOf({})).toBeNull();
    expect(kiteOrderErrorOf({ error: { message: 'Insufficient funds' } })).toBe('Insufficient funds');
  });
});

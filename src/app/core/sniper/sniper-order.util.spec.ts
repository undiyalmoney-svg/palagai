import { describe, expect, it } from 'vitest';
import {
  SNIPER_BUY_TAG,
  SNIPER_EXIT_TAG,
  SNIPER_SL_TAG,
  sniperBuyFields,
  sniperExitFields,
  sniperOpenBuyId,
  sniperStopFields,
} from './sniper-order.util';

const nifty = {
  under: 'nifty',
  optionSymbol: 'NIFTY26NOV25000CE',
  optionToken: 11,
  qty: 65,
};

describe('sniper Kite tickets', () => {
  it('tags MARKET buys PALAGAI_SNIPER and leaves Arise tags alone', () => {
    const buy = sniperBuyFields(nifty);
    expect(buy?.['tag']).toBe(SNIPER_BUY_TAG);
    expect(buy?.['exchange']).toBe('NFO');
    expect(buy?.['quantity']).toBe('65');
    expect(buy?.['order_type']).toBe('MARKET');
    expect(SNIPER_BUY_TAG).toBe('PALAGAI_SNIPER');
    expect(SNIPER_SL_TAG).toBe('PALAGAI_SNIPER_SL');
    expect(SNIPER_EXIT_TAG).toBe('PALAGAI_SNIPER_X');
  });

  it('sends Sensex on BFO and Crude Mini on MCX with a ₹20 SL slip', () => {
    const sl = sniperStopFields({ ...nifty, under: 'sensex', optionSymbol: 'SENSEX26N1982200PE', optionToken: 22, qty: 20 }, 40);
    expect(sl?.['exchange']).toBe('BFO');
    expect(sl?.['order_type']).toBe('SL');
    expect(Number(sl?.['price'])).toBeLessThan(Number(sl?.['trigger_price']));
    expect((Number(sl?.['trigger_price']) - Number(sl?.['price'])) * 20).toBeLessThanOrEqual(20.05);
    const crude = sniperBuyFields({
      under: 'crude',
      optionSymbol: 'CRUDEOILM26NOV8050CE',
      optionToken: 33,
      qty: 10,
    });
    expect(crude?.['exchange']).toBe('MCX');
    expect(crude?.['quantity']).toBe('10');
    expect(sniperExitFields(nifty)?.['tag']).toBe(SNIPER_EXIT_TAG);
  });

  it('does not reuse a rejected buy id', () => {
    const rows = [
      { order_id: '1', tradingsymbol: nifty.optionSymbol, transaction_type: 'BUY', tag: SNIPER_BUY_TAG, status: 'REJECTED' },
      { order_id: '2', tradingsymbol: nifty.optionSymbol, transaction_type: 'BUY', tag: SNIPER_BUY_TAG, status: 'COMPLETE' },
    ];
    expect(sniperOpenBuyId(rows, nifty.optionSymbol)).toBe('2');
    expect(sniperOpenBuyId(rows.filter((o) => o.status === 'REJECTED'), nifty.optionSymbol)).toBeNull();
  });
});

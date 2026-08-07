import { describe, expect, it } from 'vitest';
import {
  adoptedEntryOrderPlaceholder,
  findCompletedEntryOrderId,
  isAdoptedEntryOrderId,
} from './live-adopt.util';

describe('findCompletedEntryOrderId', () => {
  it('returns the latest COMPLETE PALAGAI BUY for the symbol', () => {
    const id = findCompletedEntryOrderId(
      [
        {
          order_id: 'old',
          status: 'COMPLETE',
          tradingsymbol: 'NIFTY2580024500CE',
          transaction_type: 'BUY',
          tag: 'PALAGAI',
          quantity: 65,
          order_timestamp: '2026-08-07 10:00:00',
        },
        {
          order_id: 'new',
          status: 'COMPLETE',
          tradingsymbol: 'NIFTY2580024500CE',
          transaction_type: 'BUY',
          tag: 'PALAGAI',
          quantity: 65,
          order_timestamp: '2026-08-07 11:00:00',
        },
        {
          order_id: 'other',
          status: 'COMPLETE',
          tradingsymbol: 'NIFTY2580024600CE',
          transaction_type: 'BUY',
          tag: 'PALAGAI',
          quantity: 65,
          order_timestamp: '2026-08-07 12:00:00',
        },
      ],
      'nifty2580024500ce',
    );
    expect(id).toBe('new');
  });

  it('ignores non-PALAGAI and non-COMPLETE buys', () => {
    expect(
      findCompletedEntryOrderId(
        [
          {
            order_id: 'x',
            status: 'OPEN',
            tradingsymbol: 'NIFTY2580024500CE',
            transaction_type: 'BUY',
            tag: 'PALAGAI',
            quantity: 65,
          },
          {
            order_id: 'y',
            status: 'COMPLETE',
            tradingsymbol: 'NIFTY2580024500CE',
            transaction_type: 'BUY',
            tag: 'MANUAL',
            quantity: 65,
          },
        ],
        'NIFTY2580024500CE',
      ),
    ).toBeNull();
  });
});

describe('adoptedEntryOrderPlaceholder', () => {
  it('marks adopted legs so the desk UI does not say NOT ON KITE', () => {
    expect(adoptedEntryOrderPlaceholder('99')).toBe('adopted:99');
    expect(adoptedEntryOrderPlaceholder(null)).toBe('adopted');
    expect(isAdoptedEntryOrderId('adopted:99')).toBe(true);
    expect(isAdoptedEntryOrderId('12345')).toBe(false);
  });
});

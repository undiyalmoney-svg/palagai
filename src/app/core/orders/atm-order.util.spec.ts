import { describe, expect, it } from 'vitest';
import { Instrument } from '../models/instrument.model';
import {
  atmOrderCost,
  atmOrderFields,
  atmQuoteKey,
  atmStopFields,
  atmTargetFields,
  buildAtmOrderPlan,
} from './atm-order.util';

function option(over: Partial<Instrument>): Instrument {
  return {
    instrumentToken: 111,
    exchangeToken: 0,
    tradingSymbol: 'X',
    name: 'X',
    exchange: 'NFO',
    segment: 'NFO-OPT',
    instrumentType: 'CE',
    expiry: '2026-09-22',
    strike: 0,
    tickSize: 0.05,
    lotSize: 65,
    lastPrice: 0,
    ...over,
  };
}

/** A Nifty chain around 24,500 expiring the Tuesday after the as-of date. */
function niftyChain(): Instrument[] {
  const out: Instrument[] = [];
  for (const strike of [24_400, 24_450, 24_500, 24_550, 24_600]) {
    for (const type of ['CE', 'PE'] as const) {
      out.push(
        option({
          instrumentToken: strike + (type === 'CE' ? 1 : 2),
          tradingSymbol: `NIFTY25922${strike}${type}`,
          name: 'NIFTY',
          instrumentType: type,
          strike,
          expiry: '2026-09-22',
          lotSize: 65,
        }),
      );
    }
  }
  return out;
}

function bankChain(): Instrument[] {
  return [24_500, 55_000, 55_100].flatMap((strike) =>
    (['CE', 'PE'] as const).map((type) =>
      option({
        instrumentToken: strike + (type === 'CE' ? 3 : 4),
        tradingSymbol: `BANKNIFTY25929${strike}${type}`,
        name: 'BANKNIFTY',
        instrumentType: type,
        strike,
        expiry: '2026-09-29',
        lotSize: 30,
      }),
    ),
  );
}

/** CRUDEOILM chain. Kite advertises lot_size 10, which is NOT the order qty. */
function crudeChain(): Instrument[] {
  return [9_400, 9_500, 9_600].flatMap((strike) =>
    (['CE', 'PE'] as const).map((type) =>
      option({
        instrumentToken: strike + (type === 'CE' ? 5 : 6),
        tradingSymbol: `CRUDEOILM26OCT${strike}${type}`,
        name: 'CRUDEOILM',
        exchange: 'MCX',
        segment: 'MCX-OPT',
        instrumentType: type,
        strike,
        expiry: '2026-10-16',
        lotSize: 10,
      }),
    ),
  );
}

const AS_OF = '2026-09-18T10:30:00';

describe('buildAtmOrderPlan', () => {
  it('picks the nearest Nifty strike and sizes 65 per lot', () => {
    const plan = buildAtmOrderPlan({
      book: 'nifty',
      instruments: niftyChain(),
      side: 'CE',
      spot: 24_487,
      asOfDateTime: AS_OF,
      lots: 2,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ticket.strike).toBe(24_500);
    expect(plan.ticket.exchange).toBe('NFO');
    expect(plan.ticket.quantity).toBe(130);
    expect(plan.ticket.unitsPerLot).toBe(65);
  });

  it('buys a PE from the put side of the chain', () => {
    const plan = buildAtmOrderPlan({
      book: 'nifty',
      instruments: niftyChain(),
      side: 'PE',
      spot: 24_487,
      asOfDateTime: AS_OF,
      lots: 1,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ticket.tradingSymbol).toContain('PE');
    expect(plan.ticket.side).toBe('PE');
  });

  it('sizes Bank Nifty 30 per lot', () => {
    const plan = buildAtmOrderPlan({
      book: 'bank',
      instruments: bankChain(),
      side: 'CE',
      spot: 55_040,
      asOfDateTime: AS_OF,
      lots: 3,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ticket.strike).toBe(55_000);
    expect(plan.ticket.quantity).toBe(90);
  });

  it('sends quantity 1 per crude lot even though the chain says 10', () => {
    const plan = buildAtmOrderPlan({
      book: 'crude',
      instruments: crudeChain(),
      side: 'CE',
      spot: 9_512,
      asOfDateTime: AS_OF,
      lots: 3,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ticket.exchange).toBe('MCX');
    // The bug this guards: 3 lots must not become 30 contracts.
    expect(plan.ticket.quantity).toBe(3);
    // The ₹ multiplier is still 10 barrels a lot.
    expect(plan.ticket.unitsPerLot).toBe(10);
  });

  it('refuses a book whose ATM contract is not in the chain', () => {
    const plan = buildAtmOrderPlan({
      book: 'nifty',
      instruments: bankChain(),
      side: 'CE',
      spot: 24_487,
      asOfDateTime: AS_OF,
      lots: 1,
    });

    expect(plan).toEqual({
      ok: false,
      reason: 'No live ATM contract in the instrument list. Refresh instruments in Settings.',
    });
  });

  it('refuses crude when the front month has rolled out of the list', () => {
    const plan = buildAtmOrderPlan({
      book: 'crude',
      instruments: crudeChain().map((i) => ({ ...i, expiry: '2026-09-01' })),
      side: 'PE',
      spot: 9_512,
      asOfDateTime: AS_OF,
      lots: 1,
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain('CRUDEOILM');
  });

  it('refuses an empty instrument list', () => {
    const plan = buildAtmOrderPlan({
      book: 'nifty',
      instruments: [],
      side: 'CE',
      spot: 24_487,
      asOfDateTime: AS_OF,
      lots: 1,
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain('Instrument list is empty');
  });

  it('refuses without a live price', () => {
    for (const spot of [0, -1, Number.NaN]) {
      const plan = buildAtmOrderPlan({
        book: 'nifty',
        instruments: niftyChain(),
        side: 'CE',
        spot,
        asOfDateTime: AS_OF,
        lots: 1,
      });
      expect(plan.ok).toBe(false);
    }
  });

  it('refuses a lot count below one', () => {
    for (const lots of [0, -2, 0.4]) {
      const plan = buildAtmOrderPlan({
        book: 'nifty',
        instruments: niftyChain(),
        side: 'CE',
        spot: 24_487,
        asOfDateTime: AS_OF,
        lots,
      });
      expect(plan.ok).toBe(false);
    }
  });

  it('refuses a contract carrying no Kite token', () => {
    const plan = buildAtmOrderPlan({
      book: 'nifty',
      instruments: niftyChain().map((i) => ({ ...i, instrumentToken: 0 })),
      side: 'CE',
      spot: 24_487,
      asOfDateTime: AS_OF,
      lots: 1,
    });

    expect(plan.ok).toBe(false);
  });
});

describe('atmOrderFields', () => {
  it('sends a tagged MARKET buy', () => {
    const plan = buildAtmOrderPlan({
      book: 'nifty',
      instruments: niftyChain(),
      side: 'CE',
      spot: 24_487,
      asOfDateTime: AS_OF,
      lots: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(atmOrderFields(plan.ticket)).toEqual({
      exchange: 'NFO',
      tradingsymbol: plan.ticket.tradingSymbol,
      transaction_type: 'BUY',
      order_type: 'MARKET',
      quantity: '65',
      product: 'MIS',
      validity: 'DAY',
      market_protection: '-1',
      tag: 'PALAGAI_CHART',
    });
  });

  it('rests a Charts-tagged SL sell under the fill', () => {
    const plan = buildAtmOrderPlan({
      book: 'nifty',
      instruments: niftyChain(),
      side: 'CE',
      spot: 24_487,
      asOfDateTime: AS_OF,
      lots: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(atmStopFields(plan.ticket, 160)).toEqual({
      exchange: 'NFO',
      tradingsymbol: plan.ticket.tradingSymbol,
      transaction_type: 'SELL',
      order_type: 'SL',
      quantity: '65',
      product: 'MIS',
      validity: 'DAY',
      trigger_price: '160.00',
      price: '144.00',
      tag: 'PALAGAI_CHART_SL',
    });
  });

  it('rests a Charts-tagged 0.5R LIMIT sell above the fill', () => {
    const plan = buildAtmOrderPlan({
      book: 'nifty',
      instruments: niftyChain(),
      side: 'CE',
      spot: 24_487,
      asOfDateTime: AS_OF,
      lots: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(atmTargetFields(plan.ticket, 220)).toEqual({
      exchange: 'NFO',
      tradingsymbol: plan.ticket.tradingSymbol,
      transaction_type: 'SELL',
      order_type: 'LIMIT',
      quantity: '65',
      product: 'MIS',
      validity: 'DAY',
      price: '220.00',
      tag: 'PALAGAI_CHART_TP',
    });
  });

  it('buys the put rather than selling it', () => {
    const plan = buildAtmOrderPlan({
      book: 'nifty',
      instruments: niftyChain(),
      side: 'PE',
      spot: 24_487,
      asOfDateTime: AS_OF,
      lots: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(atmOrderFields(plan.ticket)['transaction_type']).toBe('BUY');
  });
});

describe('atmOrderCost', () => {
  const ticket = {
    book: 'crude' as const,
    side: 'CE' as const,
    tradingSymbol: 'CRUDEOILM26OCT9500CE',
    instrumentToken: 1,
    exchange: 'MCX' as const,
    product: 'MIS' as const,
    strike: 9_500,
    expiry: '2026-10-16',
    lots: 2,
    quantity: 2,
    unitsPerLot: 10,
    spot: 9_512,
  };

  it('prices off the units a lot controls, not the order quantity', () => {
    expect(atmOrderCost(ticket, 120)).toBe(2_400);
  });

  it('declines to guess without a premium', () => {
    expect(atmOrderCost(ticket, 0)).toBeNull();
    expect(atmOrderCost(ticket, Number.NaN)).toBeNull();
  });
});

describe('atmQuoteKey', () => {
  it('builds an exchange-qualified key', () => {
    const plan = buildAtmOrderPlan({
      book: 'bank',
      instruments: bankChain(),
      side: 'CE',
      spot: 55_040,
      asOfDateTime: AS_OF,
      lots: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(atmQuoteKey(plan.ticket)).toBe(`NFO:${plan.ticket.tradingSymbol}`);
  });
});

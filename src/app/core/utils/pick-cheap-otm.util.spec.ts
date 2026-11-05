import { describe, expect, it } from 'vitest';
import { Instrument } from '../models/instrument.model';
import { pickCheapOtm } from './pick-cheap-otm.util';

function opt(partial: Partial<Instrument> & Pick<Instrument, 'tradingSymbol' | 'exchange' | 'instrumentType' | 'strike' | 'expiry'>): Instrument {
  return {
    instrumentToken: partial.instrumentToken ?? 11,
    exchangeToken: 0,
    tradingSymbol: partial.tradingSymbol,
    name: partial.name ?? partial.tradingSymbol,
    exchange: partial.exchange,
    segment: partial.segment ?? '',
    instrumentType: partial.instrumentType,
    expiry: partial.expiry,
    strike: partial.strike,
    tickSize: 0.05,
    lotSize: partial.lotSize ?? 65,
    lastPrice: partial.lastPrice ?? 50,
  };
}

describe('pickCheapOtm', () => {
  it('buys next-expiry OTM CE on a long and skips the dying week', () => {
    const chain = [
      opt({
        tradingSymbol: 'NIFTY26NOV2524800CE',
        name: 'NIFTY',
        exchange: 'NFO',
        instrumentType: 'CE',
        expiry: '2026-11-03',
        strike: 24800,
        lastPrice: 180,
      }),
      opt({
        tradingSymbol: 'NIFTY26NOV1025000CE',
        name: 'NIFTY',
        exchange: 'NFO',
        instrumentType: 'CE',
        expiry: '2026-11-10',
        strike: 25000,
        lastPrice: 48,
      }),
      opt({
        tradingSymbol: 'NIFTY26NOV1024800PE',
        name: 'NIFTY',
        exchange: 'NFO',
        instrumentType: 'PE',
        expiry: '2026-11-10',
        strike: 24800,
        lastPrice: 46,
      }),
    ];
    const ce = pickCheapOtm({
      instruments: chain,
      book: 'nifty',
      direction: 'BUY',
      spot: 24800,
      asOf: new Date('2026-11-03T04:00:00Z'),
    });
    expect(ce.side).toBe('CE');
    expect(ce.source).toBe('chain');
    expect(ce.expiry).toBe('2026-11-10');
    expect(ce.strike).toBe(25000);
    expect(ce.fitsBudget).toBe(true);
    expect(ce.openCostRs).toBe(48 * 65);

    const pe = pickCheapOtm({
      instruments: chain,
      book: 'nifty',
      direction: 'SELL',
      spot: 24800,
      asOf: new Date('2026-11-03T04:00:00Z'),
    });
    expect(pe.side).toBe('PE');
    expect(pe.strike).toBe(24800);
  });

  it('falls back to a synthetic cheap label when the chain is empty', () => {
    const pick = pickCheapOtm({
      instruments: [],
      book: 'crude',
      direction: 'BUY',
      spot: 5400,
      asOf: new Date('2026-11-02T04:30:00Z'),
    });
    expect(pick.source).toBe('synthetic');
    expect(pick.side).toBe('CE');
    expect(pick.lotSize).toBe(10);
    expect(pick.fitsBudget).toBe(true);
    expect(pick.instrument.tradingSymbol).toMatch(/CRUDEOILM/);
  });

  it('refuses standard CRUDEOIL options and keeps CRUDEOILM', () => {
    const chain = [
      opt({
        tradingSymbol: 'CRUDEOIL26NOV8300CE',
        name: 'CRUDEOIL',
        exchange: 'MCX',
        instrumentType: 'CE',
        expiry: '2026-11-17',
        strike: 8300,
        lotSize: 100,
        lastPrice: 40,
      }),
      opt({
        tradingSymbol: 'CRUDEOILM26NOV8300CE',
        name: 'CRUDEOILM',
        exchange: 'MCX',
        instrumentType: 'CE',
        expiry: '2026-11-17',
        strike: 8300,
        lotSize: 10,
        lastPrice: 42,
      }),
    ];
    const pick = pickCheapOtm({
      instruments: chain,
      book: 'crude',
      direction: 'BUY',
      spot: 8300,
      asOf: new Date('2026-11-05T04:00:00Z'),
    });
    expect(pick.source).toBe('chain');
    expect(pick.instrument.tradingSymbol).toBe('CRUDEOILM26NOV8300CE');
    expect(pick.lotSize).toBe(10);
  });
});

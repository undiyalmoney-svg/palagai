import { describe, expect, it } from 'vitest';
import { Instrument } from '../models/instrument.model';
import { slimTradingInstruments } from './trading-instruments-slim.util';

function row(partial: Partial<Instrument> & Pick<Instrument, 'tradingSymbol' | 'exchange' | 'instrumentType'>): Instrument {
  return {
    instrumentToken: partial.instrumentToken ?? 1,
    exchangeToken: 0,
    tradingSymbol: partial.tradingSymbol,
    name: partial.name ?? partial.tradingSymbol,
    exchange: partial.exchange,
    segment: partial.segment ?? '',
    instrumentType: partial.instrumentType,
    expiry: partial.expiry ?? '',
    strike: partial.strike ?? 0,
    tickSize: 0.05,
    lotSize: 65,
    lastPrice: 0,
  };
}

describe('slimTradingInstruments', () => {
  it('keeps Nifty/Bank NFO options and drops FINNIFTY', () => {
    const slim = slimTradingInstruments([
      row({
        tradingSymbol: 'NIFTY2580424800CE',
        name: 'NIFTY',
        exchange: 'NFO',
        instrumentType: 'CE',
        expiry: '2026-08-04',
        strike: 24800,
      }),
      row({
        tradingSymbol: 'FINNIFTY2580424800CE',
        name: 'FINNIFTY',
        exchange: 'NFO',
        instrumentType: 'CE',
      }),
      row({ tradingSymbol: 'RELIANCE', exchange: 'NSE', instrumentType: 'EQ' }),
      row({ tradingSymbol: 'CRUDEOILM26AUGFUT', exchange: 'MCX', instrumentType: 'FUT', name: 'CRUDEOILM' }),
      row({ tradingSymbol: 'USDINR26AUGFUT', exchange: 'CDS', instrumentType: 'FUT' }),
    ]);
    expect(slim.map((i) => i.tradingSymbol)).toEqual([
      'NIFTY2580424800CE',
      'RELIANCE',
      'CRUDEOILM26AUGFUT',
    ]);
  });
});

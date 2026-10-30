import { describe, expect, it } from 'vitest';
import { Instrument } from '../models/instrument.model';
import { resolveCrudeOilMiniFuturesToken } from './instrument-resolver.util';

function fut(symbol: string, expiry: string, token: number): Instrument {
  return {
    instrumentToken: token,
    exchangeToken: 0,
    tradingSymbol: symbol,
    name: 'CRUDEOILM',
    exchange: 'MCX',
    segment: 'MCX-FUT',
    instrumentType: 'FUT',
    expiry,
    strike: 0,
    tickSize: 1,
    lotSize: 1,
    lastPrice: 0,
  };
}

describe('resolveCrudeOilMiniFuturesToken', () => {
  const pool = [
    fut('CRUDEOILM26OCTFUT', '2026-10-16', 111),
    fut('CRUDEOILM26NOVFUT', '2026-11-17', 222),
  ];

  it('keeps October the day before expiry', () => {
    const hit = resolveCrudeOilMiniFuturesToken(pool, new Date('2026-10-15T18:00:00+05:30'));
    expect(hit?.tradingSymbol).toBe('CRUDEOILM26OCTFUT');
  });

  it('rolls to November on October expiry day', () => {
    const hit = resolveCrudeOilMiniFuturesToken(pool, new Date('2026-10-16T09:05:00+05:30'));
    expect(hit?.tradingSymbol).toBe('CRUDEOILM26NOVFUT');
    expect(hit?.instrumentToken).toBe(222);
  });
});

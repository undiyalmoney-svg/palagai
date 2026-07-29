import { describe, expect, it } from 'vitest';
import { Instrument } from '../models/instrument.model';
import {
  isCrudeOptionExpiryDay,
  listCrudeOilMiniOptions,
  resolveAtmCrudeMiniOption,
  resolveCrudeFrontExpiry,
  listCrudeLiveExpiries,
} from './crude-option.util';

function opt(
  partial: Partial<Instrument> &
    Pick<Instrument, 'tradingSymbol' | 'expiry' | 'strike' | 'instrumentType'>,
): Instrument {
  return {
    instrumentToken: partial.instrumentToken ?? 1,
    exchangeToken: 0,
    tradingSymbol: partial.tradingSymbol,
    name: 'CRUDEOILM',
    exchange: 'MCX',
    segment: 'MCX-OPT',
    instrumentType: partial.instrumentType,
    expiry: partial.expiry,
    strike: partial.strike,
    tickSize: 0.05,
    lotSize: 10,
    lastPrice: 0,
  };
}

const chain: Instrument[] = [
  opt({
    tradingSymbol: 'CRUDEOILM26AUG6200CE',
    expiry: '2026-08-17',
    strike: 6200,
    instrumentType: 'CE',
    instrumentToken: 101,
  }),
  opt({
    tradingSymbol: 'CRUDEOILM26AUG6200PE',
    expiry: '2026-08-17',
    strike: 6200,
    instrumentType: 'PE',
    instrumentToken: 102,
  }),
  opt({
    tradingSymbol: 'CRUDEOILM26SEP6200CE',
    expiry: '2026-09-17',
    strike: 6200,
    instrumentType: 'CE',
    instrumentToken: 201,
  }),
  opt({
    tradingSymbol: 'CRUDEOILM26SEP6200PE',
    expiry: '2026-09-17',
    strike: 6200,
    instrumentType: 'PE',
    instrumentToken: 202,
  }),
  opt({
    tradingSymbol: 'CRUDEOILM26OCT6200CE',
    expiry: '2026-10-15',
    strike: 6200,
    instrumentType: 'CE',
    instrumentToken: 301,
  }),
];

describe('crude option expiry roll', () => {
  it('lists live expiries on/after asOf', () => {
    const live = listCrudeLiveExpiries(chain, new Date('2026-08-17T00:00:00'));
    expect(live.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-08-17',
      '2026-09-17',
      '2026-10-15',
    ]);
  });

  it('on expiry day, front expiry is the NEXT contract', () => {
    const asOf = new Date('2026-08-17T10:00:00');
    const live = listCrudeLiveExpiries(chain, asOf);
    const front = resolveCrudeFrontExpiry(asOf, live);
    expect(front?.toISOString().slice(0, 10)).toBe('2026-09-17');
    expect(isCrudeOptionExpiryDay(asOf, chain)).toBe(true);
  });

  it('before expiry day, keeps current front month', () => {
    const asOf = new Date('2026-08-16T10:00:00');
    const live = listCrudeLiveExpiries(chain, asOf);
    const front = resolveCrudeFrontExpiry(asOf, live);
    expect(front?.toISOString().slice(0, 10)).toBe('2026-08-17');
    expect(isCrudeOptionExpiryDay(asOf, chain)).toBe(false);
  });

  it('resolveAtmCrudeMiniOption skips same-day expiry', () => {
    const picked = resolveAtmCrudeMiniOption({
      instruments: chain,
      direction: 'BUY',
      spot: 6202,
      asOfDateTime: '2026-08-17T19:05:00+05:30',
    });
    expect(picked.source).toBe('chain');
    expect(picked.instrument.expiry).toBe('2026-09-17');
    expect(picked.instrument.tradingSymbol).toContain('SEP');
  });

  it('resolveAtmCrudeMiniOption uses front month the day before expiry', () => {
    const picked = resolveAtmCrudeMiniOption({
      instruments: chain,
      direction: 'SELL',
      spot: 6200,
      asOfDateTime: '2026-08-16T19:05:00+05:30',
    });
    expect(picked.instrument.expiry).toBe('2026-08-17');
    expect(picked.instrument.instrumentType).toBe('PE');
  });

  it('listCrudeOilMiniOptions also rolls on expiry day', () => {
    const { expiry, atm } = listCrudeOilMiniOptions(
      chain,
      6200,
      12,
      '2026-08-17T11:00:00+05:30',
    );
    expect(expiry).toBe('2026-09-17');
    expect(atm.every((p) => p.expiry === '2026-09-17')).toBe(true);
  });
});

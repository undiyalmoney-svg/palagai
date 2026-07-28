import { describe, expect, it } from 'vitest';
import { Instrument } from '../models/instrument.model';
import {
  isCurrentWeeklyExpiryDay,
  isFrontWeeklyExpiry,
  nextWeeklyExpiryDate,
  resolveAtmWeeklyOption,
  shouldRollWeeklyExpiry,
} from './option-chain.util';

function opt(partial: Partial<Instrument> & Pick<Instrument, 'tradingSymbol' | 'expiry' | 'strike'>): Instrument {
  return {
    instrumentToken: partial.instrumentToken ?? 1,
    exchangeToken: 0,
    tradingSymbol: partial.tradingSymbol,
    name: partial.name ?? 'NIFTY',
    exchange: 'NFO',
    segment: 'NFO-OPT',
    instrumentType: partial.instrumentType ?? 'CE',
    expiry: partial.expiry,
    strike: partial.strike,
    tickSize: 0.05,
    lotSize: 65,
    lastPrice: 0,
  };
}

describe('isFrontWeeklyExpiry', () => {
  it('accepts the expected weekly and rejects far live week', () => {
    const asOf = new Date('2026-07-02T10:15:00+05:30');
    const asOfDay = new Date(asOf);
    asOfDay.setHours(0, 0, 0, 0);
    const expected = nextWeeklyExpiryDate(asOfDay, false); // 2026-07-02 is Thu
    expect(isFrontWeeklyExpiry(asOfDay, expected, false)).toBe(true);
    const far = new Date('2026-07-30T00:00:00');
    expect(isFrontWeeklyExpiry(asOfDay, far, false)).toBe(false);
  });
});

describe('shouldRollWeeklyExpiry', () => {
  it('rolls all day on Thursday expiry (morning), not only after 13:00', () => {
    const thuMorning = new Date('2026-07-02T10:00:00+05:30');
    expect(
      shouldRollWeeklyExpiry({ asOf: thuMorning, instruments: [], kind: 'nifty' }),
    ).toBe(true);
    const next = nextWeeklyExpiryDate(thuMorning, true);
    expect(next.toISOString().slice(0, 10)).toBe('2026-07-09');
  });

  it('does not roll on a normal Monday morning', () => {
    const mon = new Date('2026-07-27T10:00:00+05:30');
    expect(shouldRollWeeklyExpiry({ asOf: mon, instruments: [], kind: 'nifty' })).toBe(false);
  });

  it('rolls on holiday-shifted expiry when chain lists today', () => {
    const wed = new Date('2026-07-01T10:00:00+05:30'); // Wed
    const chain = [
      opt({
        instrumentToken: 1,
        tradingSymbol: 'NIFTY2570124500CE',
        expiry: '2026-07-01',
        strike: 24500,
      }),
    ];
    expect(isCurrentWeeklyExpiryDay(wed, chain, 'nifty')).toBe(true);
    expect(shouldRollWeeklyExpiry({ asOf: wed, instruments: chain, kind: 'nifty' })).toBe(true);
  });
});

describe('resolveAtmWeeklyOption', () => {
  it('uses live front weekly for today-style as-of (live entry path)', () => {
    const asOf = '2026-07-27T10:20:00+0530'; // Mon → weekly Thu 30 Jul
    const chain = [
      opt({
        instrumentToken: 9001,
        tradingSymbol: 'NIFTY2573024500CE',
        expiry: '2026-07-30',
        strike: 24500,
      }),
      opt({
        instrumentToken: 9002,
        tradingSymbol: 'NIFTY2580624500CE',
        expiry: '2026-08-06',
        strike: 24500,
      }),
    ];
    const resolved = resolveAtmWeeklyOption({
      instruments: chain,
      kind: 'nifty',
      direction: 'BUY',
      spot: 24510,
      asOfDateTime: asOf,
    });
    expect(resolved.source).toBe('chain');
    expect(resolved.instrument.instrumentToken).toBe(9001);
    expect(resolved.instrument.expiry.startsWith('2026-07-30')).toBe(true);
  });

  it('does NOT bind a Jul-2 trade to a Jul-30 live weekly still in the dump', () => {
    const chain = [
      opt({
        instrumentToken: 9002,
        tradingSymbol: 'NIFTY2573024500CE',
        expiry: '2026-07-30',
        strike: 24500,
      }),
    ];
    const resolved = resolveAtmWeeklyOption({
      instruments: chain,
      kind: 'nifty',
      direction: 'BUY',
      spot: 24510,
      asOfDateTime: '2026-07-02T11:00:00+0530',
    });
    expect(resolved.source).toBe('synthetic');
    expect(resolved.instrument.instrumentToken).toBe(0);
  });

  it('picks BUY→CE and SELL→PE', () => {
    const chain = [
      opt({
        instrumentToken: 1,
        tradingSymbol: 'NIFTY2573024500CE',
        expiry: '2026-07-30',
        strike: 24500,
        instrumentType: 'CE',
      }),
      opt({
        instrumentToken: 2,
        tradingSymbol: 'NIFTY2573024500PE',
        expiry: '2026-07-30',
        strike: 24500,
        instrumentType: 'PE',
        name: 'NIFTY',
      }),
    ];
    const buy = resolveAtmWeeklyOption({
      instruments: chain,
      kind: 'nifty',
      direction: 'BUY',
      spot: 24500,
      asOfDateTime: '2026-07-27T10:00:00+0530',
    });
    const sell = resolveAtmWeeklyOption({
      instruments: chain,
      kind: 'nifty',
      direction: 'SELL',
      spot: 24500,
      asOfDateTime: '2026-07-27T10:00:00+0530',
    });
    expect(buy.instrument.instrumentType).toBe('CE');
    expect(sell.instrument.instrumentType).toBe('PE');
  });
});

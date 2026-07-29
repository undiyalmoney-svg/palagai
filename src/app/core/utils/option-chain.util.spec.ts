import { describe, expect, it } from 'vitest';
import { Instrument } from '../models/instrument.model';
import {
  describeOptionChainGap,
  isCurrentWeeklyExpiryDay,
  isFrontWeeklyExpiry,
  nextMonthlyExpiryDate,
  nextWeeklyExpiryDate,
  resolveAtmWeeklyOption,
  shouldRollWeeklyExpiry,
} from './option-chain.util';

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

describe('nextWeeklyExpiryDate (Nifty = Tuesday)', () => {
  it('picks the coming Tuesday from mid-week', () => {
    // Wed 29 Jul 2026 → Tue 4 Aug 2026
    const wed = new Date('2026-07-29T10:00:00+05:30');
    const next = nextWeeklyExpiryDate(wed, false, 'nifty');
    expect(ymd(next)).toBe('2026-08-04');
  });

  it('rolls to next Tuesday when already on Tuesday expiry day', () => {
    const tue = new Date('2026-08-04T10:00:00+05:30');
    const next = nextWeeklyExpiryDate(tue, true, 'nifty');
    expect(ymd(next)).toBe('2026-08-11');
  });
});

describe('nextMonthlyExpiryDate (Bank Nifty)', () => {
  it('picks last Tuesday of current/next month', () => {
    // Wed 29 Jul 2026 — July monthly was Tue 28 Jul (passed) → Aug 25
    const wed = new Date('2026-07-29T10:00:00+05:30');
    const next = nextMonthlyExpiryDate(wed, false);
    expect(ymd(next)).toBe('2026-08-25');
  });

  it('on July monthly expiry day rolls to August', () => {
    const tue = new Date('2026-07-28T10:00:00+05:30');
    const next = nextMonthlyExpiryDate(tue, true);
    expect(ymd(next)).toBe('2026-08-25');
  });
});

describe('isFrontWeeklyExpiry', () => {
  it('accepts the expected Tuesday weekly and rejects far live week', () => {
    const asOf = new Date('2026-07-28T10:15:00+05:30'); // Tue expiry day
    const asOfDay = new Date(asOf);
    asOfDay.setHours(0, 0, 0, 0);
    // On expiry day with roll → next Tue 4 Aug
    const expected = nextWeeklyExpiryDate(asOfDay, true, 'nifty');
    expect(ymd(expected)).toBe('2026-08-04');
    expect(isFrontWeeklyExpiry(asOfDay, expected, true, 'nifty')).toBe(true);
    const far = new Date(2026, 7, 25); // Aug 25 local
    expect(isFrontWeeklyExpiry(asOfDay, far, true, 'nifty')).toBe(false);
    // Same-day expiry never tradeable
    const same = new Date(2026, 6, 28); // Jul 28
    expect(isFrontWeeklyExpiry(asOfDay, same, false, 'nifty')).toBe(false);
  });
});

describe('shouldRollWeeklyExpiry', () => {
  it('rolls all day on Tuesday expiry (morning), not only after 13:00', () => {
    const tueMorning = new Date('2026-08-04T10:00:00+05:30');
    expect(
      shouldRollWeeklyExpiry({ asOf: tueMorning, instruments: [], kind: 'nifty' }),
    ).toBe(true);
    const next = nextWeeklyExpiryDate(tueMorning, true, 'nifty');
    expect(ymd(next)).toBe('2026-08-11');
  });

  it('does not roll on a normal Monday morning', () => {
    const mon = new Date('2026-07-27T10:00:00+05:30');
    expect(shouldRollWeeklyExpiry({ asOf: mon, instruments: [], kind: 'nifty' })).toBe(false);
  });

  it('does not blanket-roll on Wednesday afternoon (legacy 13:00 rule removed)', () => {
    const wedPm = new Date('2026-07-29T15:00:00+05:30');
    expect(shouldRollWeeklyExpiry({ asOf: wedPm, instruments: [], kind: 'nifty' })).toBe(false);
  });

  it('rolls on holiday-shifted expiry when chain lists today', () => {
    const mon = new Date('2026-08-03T10:00:00+05:30'); // Mon (holiday-shifted Tue)
    const chain = [
      opt({
        instrumentToken: 1,
        tradingSymbol: 'NIFTY2580324500CE',
        expiry: '2026-08-03',
        strike: 24500,
      }),
    ];
    expect(isCurrentWeeklyExpiryDay(mon, chain, 'nifty')).toBe(true);
    expect(shouldRollWeeklyExpiry({ asOf: mon, instruments: chain, kind: 'nifty' })).toBe(true);
  });
});

describe('resolveAtmWeeklyOption', () => {
  it('uses live front Tuesday weekly for today-style as-of (live entry path)', () => {
    const asOf = '2026-07-29T10:20:00+0530'; // Wed → weekly Tue 4 Aug
    const chain = [
      opt({
        instrumentToken: 9001,
        tradingSymbol: 'NIFTY2580424500CE',
        expiry: '2026-08-04',
        strike: 24500,
      }),
      opt({
        instrumentToken: 9002,
        tradingSymbol: 'NIFTY2581124500CE',
        expiry: '2026-08-11',
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
    expect(resolved.instrument.expiry.startsWith('2026-08-04')).toBe(true);
  });

  it('still resolves when calendar expected is missing but nearest front week is in dump', () => {
    // Belt-and-suspenders: only Aug-4 in dump (no synthetic Jul-30 phantom).
    const resolved = resolveAtmWeeklyOption({
      instruments: [
        opt({
          instrumentToken: 9001,
          tradingSymbol: 'NIFTY2580424500CE',
          expiry: '2026-08-04',
          strike: 24500,
        }),
      ],
      kind: 'nifty',
      direction: 'BUY',
      spot: 24510,
      asOfDateTime: '2026-07-29T10:20:00+0530',
    });
    expect(resolved.source).toBe('chain');
    expect(resolved.instrument.instrumentToken).toBe(9001);
  });

  it('does NOT bind a Jul-2 trade to a Aug-4 live weekly still in the dump', () => {
    const chain = [
      opt({
        instrumentToken: 9002,
        tradingSymbol: 'NIFTY2580424500CE',
        expiry: '2026-08-04',
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
        tradingSymbol: 'NIFTY2580424500CE',
        expiry: '2026-08-04',
        strike: 24500,
        instrumentType: 'CE',
      }),
      opt({
        instrumentToken: 2,
        tradingSymbol: 'NIFTY2580424500PE',
        expiry: '2026-08-04',
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
      asOfDateTime: '2026-07-29T10:00:00+0530',
    });
    const sell = resolveAtmWeeklyOption({
      instruments: chain,
      kind: 'nifty',
      direction: 'SELL',
      spot: 24500,
      asOfDateTime: '2026-07-29T10:00:00+0530',
    });
    expect(buy.instrument.instrumentType).toBe('CE');
    expect(sell.instrument.instrumentType).toBe('PE');
  });

  it('resolves Bank Nifty to front monthly (weeklies discontinued)', () => {
    const chain = [
      opt({
        instrumentToken: 7001,
        tradingSymbol: 'BANKNIFTY2582555000CE',
        name: 'BANKNIFTY',
        expiry: '2026-08-25',
        strike: 55000,
        instrumentType: 'CE',
        lotSize: 30,
      }),
    ];
    const resolved = resolveAtmWeeklyOption({
      instruments: chain,
      kind: 'banknifty',
      direction: 'BUY',
      spot: 55020,
      asOfDateTime: '2026-07-29T10:20:00+0530',
    });
    expect(resolved.source).toBe('chain');
    expect(resolved.instrument.instrumentToken).toBe(7001);
  });

  it('on Nifty Tuesday expiry morning, skips same-day and takes next weekly', () => {
    // Tue 28 Jul 2026 was Nifty weekly + Bank monthly expiry.
    const chain = [
      opt({
        instrumentToken: 1,
        tradingSymbol: 'NIFTY2572824500CE',
        expiry: '2026-07-28',
        strike: 24500,
      }),
      opt({
        instrumentToken: 2,
        tradingSymbol: 'NIFTY2580424500CE',
        expiry: '2026-08-04',
        strike: 24500,
      }),
    ];
    const resolved = resolveAtmWeeklyOption({
      instruments: chain,
      kind: 'nifty',
      direction: 'BUY',
      spot: 24500,
      asOfDateTime: '2026-07-28T10:05:00+05:30',
    });
    expect(resolved.source).toBe('chain');
    expect(resolved.instrument.instrumentToken).toBe(2);
    expect(resolved.instrument.expiry).toBe('2026-08-04');
  });

  it('on Bank monthly expiry morning, skips same-day and takes next monthly', () => {
    const chain = [
      opt({
        instrumentToken: 11,
        tradingSymbol: 'BANKNIFTY2572855000CE',
        name: 'BANKNIFTY',
        expiry: '2026-07-28',
        strike: 55000,
        lotSize: 30,
      }),
      opt({
        instrumentToken: 12,
        tradingSymbol: 'BANKNIFTY2582555000CE',
        name: 'BANKNIFTY',
        expiry: '2026-08-25',
        strike: 55000,
        lotSize: 30,
      }),
    ];
    const resolved = resolveAtmWeeklyOption({
      instruments: chain,
      kind: 'banknifty',
      direction: 'BUY',
      spot: 55000,
      asOfDateTime: '2026-07-28T09:30:00+05:30',
    });
    expect(resolved.source).toBe('chain');
    expect(resolved.instrument.instrumentToken).toBe(12);
    expect(resolved.instrument.expiry).toBe('2026-08-25');
  });
});

describe('describeOptionChainGap', () => {
  it('mentions expected Tuesday expiry and cache size', () => {
    const msg = describeOptionChainGap({
      instruments: [],
      kind: 'nifty',
      direction: 'BUY',
      spot: 24500,
      asOfDateTime: '2026-07-29T10:20:00+0530',
    });
    expect(msg).toContain('0 index options cached');
    expect(msg).toContain('2026-08-04');
    expect(msg).toContain('24500CE');
  });
});

import { describe, expect, it } from 'vitest';
import { emptySession } from './live-paper.engine';
import { emptyPaperLiveBooks } from './paper-live-order.util';
import {
  HIST_MINUTE_LOOKBACK_DAYS,
  barFeedLine,
  findCrudeMini,
  lastPrice,
  minuteDayWindows,
  runPaperTick,
} from './paper-tick.run';
import { LiveAssumeBar } from './live-assume.engine';

describe('spot from Kite quotes', () => {
  it('does not treat a BANKNIFTY CE last as Bank Nifty spot', () => {
    const quotes = {
      'NSE:NIFTY BANK': { last_price: 58_040 },
      'NFO:BANKNIFTY26N1758000CE': { last_price: 162 },
      'BFO:SENSEX26N1682000CE': { last_price: 210 },
      'BSE:SENSEX': { last_price: 82_100 },
    };
    expect(lastPrice(quotes, 'bank', 'NIFTY BANK')).toBe(58_040);
    expect(lastPrice(quotes, 'sensex', 'SENSEX')).toBe(82_100);
  });

  it('returns null for Bank when only the option quote is present, so ATM is not 162', () => {
    expect(lastPrice({ 'NFO:BANKNIFTY26N1758000CE': { last_price: 162 } }, 'bank', 'NIFTY BANK')).toBeNull();
  });
});

describe('Crude Mini future from Kite CSV', () => {
  const header =
    'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange';
  const csv = [
    header,
    '111,0,CRUDEOILM26NOVFUT,CRUDEOILM,0,2026-11-17,0,1,1,FUT,MCX-FUT,MCX',
    '222,0,CRUDEOILM26DECFUT,CRUDEOILM,0,2026-12-17,0,1,1,FUT,MCX-FUT,MCX',
  ].join('\n');

  it('picks the November contract the day before expiry', () => {
    expect(findCrudeMini(csv, '2026-11-16')?.tradingSymbol).toBe('CRUDEOILM26NOVFUT');
  });

  it('rolls to December on November expiry day, and keeps November if that is the only row', () => {
    expect(findCrudeMini(csv, '2026-11-17')?.tradingSymbol).toBe('CRUDEOILM26DECFUT');
    const onlyNov = [header, '111,0,CRUDEOILM26NOVFUT,CRUDEOILM,0,2026-11-17,0,1,1,FUT,MCX-FUT,MCX'].join('\n');
    expect(findCrudeMini(onlyNov, '2026-11-17')?.tradingSymbol).toBe('CRUDEOILM26NOVFUT');
  });
});

describe('paper tick 1-min history windows', () => {
  it('asks Kite for one calendar day at a time, today first', () => {
    const days = minuteDayWindows('2026-11-16');
    expect(days[0]).toBe('2026-11-16');
    expect(days).toContain('2026-11-13');
    expect(days).not.toContain('2026-11-08');
    expect(days).toHaveLength(HIST_MINUTE_LOOKBACK_DAYS + 1);
  });

  it('says so when every name is missing today\'s 1-min bars', () => {
    const bars = new Map<string, LiveAssumeBar[]>([
      ['nifty', [{ day: '2026-11-13', min: 600, open: 1, high: 1, low: 1, close: 1 }]],
    ]);
    expect(barFeedLine(bars, '2026-11-16')).toMatch(/no completed 1-min bars for today/);
  });

  it('does not request an 8-day 1-min span that Kite rejects at 2000 candles', async () => {
    const calls: string[][] = [];
    await runPaperTick({
      now: new Date('2026-11-16T04:21:00.000Z'),
      live: false,
      liveBooks: emptyPaperLiveBooks(),
      session: emptySession('2026-11-16', '2026-11-16T04:21:00.000Z'),
      fetchMargins: async () => null,
      fetchCsv: async () =>
        'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange\n',
      fetchQuotes: async () => ({}),
      fetchHistorical: async (token, interval, from, to) => {
        calls.push([token, interval, from, to]);
        return [];
      },
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c[1] === 'minute' && c[2] === c[3])).toBe(true);
    expect(calls.some((c) => c[2] === '2026-11-16')).toBe(true);
    expect(calls.some((c) => c[2] === '2026-11-08')).toBe(false);
  });
});

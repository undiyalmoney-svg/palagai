import { describe, expect, it } from 'vitest';
import { emptySniperSession } from './sniper-engine';
import { runSniperTick } from './sniper-tick.run';

const HEADER =
  'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange';

const CSV = [
  HEADER,
  '260105,1,NIFTY BANK,NIFTY BANK,0,,0,0.05,1,EQ,NSE,NSE',
  '111,2,BANKNIFTY26NOV52000PE,BANKNIFTY,0,2026-11-26,52000,0.05,30,PE,NFO-OPT,NFO',
  '222,3,BANKNIFTY26NOV52000CE,BANKNIFTY,0,2026-11-26,52000,0.05,30,CE,NFO-OPT,NFO',
].join('\n');

function candle(ist: string, o: number, h: number, l: number, c: number): unknown[] {
  return [`${ist}+05:30`, o, h, l, c, 0];
}

describe('Sniper Bank PE tick', () => {
  it('quotes Bank Nifty + ATM PE, fetches 5m and 1m, and papers a down-ORB PE fill', async () => {
    const hist: string[][] = [];
    const quoteKeys: string[][] = [];
    const session = await runSniperTick({
      now: new Date('2026-11-23T04:05:00.000Z'),
      session: { ...emptySniperSession('2026-11-23'), paperOn: true, running: true },
      fetchCsv: async () => CSV,
      fetchQuotes: async (keys) => {
        quoteKeys.push(keys);
        const out: Record<string, { last_price: number; depth: { buy: { price: number }[]; sell: { price: number }[] } }> = {};
        for (const k of keys) {
          if (k.includes('NIFTY BANK')) {
            out[k] = { last_price: 52020, depth: { buy: [], sell: [] } };
          } else {
            out[k] = {
              last_price: 101,
              depth: { buy: [{ price: 100 }], sell: [{ price: 101 }] },
            };
          }
        }
        return out;
      },
      fetchHistorical: async (token, interval, from, to) => {
        hist.push([token, interval, from, to]);
        if (interval === 'minute') {
          return [
            candle('2026-11-23T09:33:00', 51910, 51940, 51900, 51920),
            candle('2026-11-23T09:34:00', 51920, 52020, 51910, 52020),
          ];
        }
        return [
          candle('2026-11-23T09:15:00', 52000, 52040, 51980, 52020),
          candle('2026-11-23T09:20:00', 52020, 52050, 52000, 52030),
          candle('2026-11-23T09:25:00', 52030, 52060, 52010, 52040),
          candle('2026-11-23T09:30:00', 52000, 52020, 51880, 51900),
        ];
      },
    });
    expect(session.books.map((b) => b.id)).toEqual(['bank']);
    expect(hist.some((h) => h[1] === '5minute')).toBe(true);
    expect(hist.some((h) => h[1] === 'minute')).toBe(true);
    expect(quoteKeys.flat().some((k) => k.includes('NIFTY BANK'))).toBe(true);
    expect(session.books[0].spot).toBe(52020);
    expect(session.books[0].cut).toBe('down');
    expect(session.books[0].side).toBe('long');
    expect(session.books[0].optionType).toBe('PE');
    expect(session.books[0].optionSymbol).toBe('BANKNIFTY26NOV52000PE');
    expect(session.books[0].qty).toBe(30);
    expect(session.books[0].pulse.length).toBeGreaterThan(0);
    expect(session.stopRs).toBe(750);
    expect(session.targetRs).toBe(750);
  });

  it('does not buy CE when the first ORB cut is up', async () => {
    const session = await runSniperTick({
      now: new Date('2026-11-23T04:05:00.000Z'),
      session: { ...emptySniperSession('2026-11-23'), paperOn: true, running: true },
      fetchCsv: async () => CSV,
      fetchQuotes: async (keys) => {
        const out: Record<string, { last_price: number }> = {};
        for (const k of keys) out[k] = { last_price: k.includes('NIFTY BANK') ? 52110 : 80 };
        return out;
      },
      fetchHistorical: async (_token, interval) => {
        if (interval === 'minute') return [];
        return [
          candle('2026-11-23T09:15:00', 52000, 52040, 51980, 52020),
          candle('2026-11-23T09:20:00', 52020, 52050, 52000, 52030),
          candle('2026-11-23T09:25:00', 52030, 52060, 52010, 52040),
          candle('2026-11-23T09:30:00', 52050, 52140, 52040, 52110),
        ];
      },
    });
    expect(session.books[0].cut).toBe('up');
    expect(session.books[0].side).toBe('flat');
    expect(session.books[0].fills).toHaveLength(0);
    expect(session.books[0].reason).toMatch(/skip CE/);
    expect(session.books[0].optionSymbol).toBe('BANKNIFTY26NOV52000PE');
  });
});

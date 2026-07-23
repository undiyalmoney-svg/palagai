import { computeOptionPnl, enrichTradesWithOptionPremiums } from './paper-desk-engine';
import { PaperTrade } from './paper-desk.models';
import { Candle } from '../models/candle.model';

function optCandle(date: string, o: number, h: number, l: number, c: number): Candle {
  return { date, open: o, high: h, low: l, close: c, volume: 1 };
}

function trade(partial: Partial<PaperTrade>): PaperTrade {
  return {
    id: 't1',
    instrumentId: 'NIFTY',
    instrumentName: 'Nifty 50',
    direction: 'BUY',
    indexEntry: 24500,
    indexStop: 24470,
    indexTarget: 24560,
    indexExit: 24520,
    indexPoints: 20,
    entryTime: '2026-07-23T14:30:00+0530',
    exitTime: '2026-07-23T14:55:00+0530',
    exitReason: 'target',
    option: {
      tradingSymbol: 'NIFTY24500CE',
      instrumentToken: 111,
      strike: 24500,
      expiry: '2026-07-30',
      optionType: 'CE',
      lotSize: 65,
      source: 'chain',
    },
    optionEntryPremium: null,
    optionExitPremium: null,
    optionPnlRs: null,
    premiumEstimated: true,
    outcome: 'WIN',
    ...partial,
  };
}

describe('computeOptionPnl', () => {
  it('matches the OHLC mental model: (82 − 72) × 65 = 650', () => {
    expect(
      computeOptionPnl({ entryPremium: 72, exitPremium: 82, lotSize: 65, lots: 1 }),
    ).toBe(650);
  });

  it('scales by lots', () => {
    expect(
      computeOptionPnl({ entryPremium: 72, exitPremium: 82, lotSize: 65, lots: 2 }),
    ).toBe(1300);
  });
});

describe('enrichTradesWithOptionPremiums (OHLC-based)', () => {
  it('uses entry-bar OPEN and exit-bar CLOSE from the option OHLC', () => {
    const candles = new Map<number, Candle[]>([
      [
        111,
        [
          optCandle('2026-07-23T14:30:00+0530', 72, 75, 71, 74), // entry bar → open 72
          optCandle('2026-07-23T14:35:00+0530', 74, 78, 73, 77),
          optCandle('2026-07-23T14:55:00+0530', 80, 83, 79, 82), // exit bar → close 82
        ],
      ],
    ]);
    const [out] = enrichTradesWithOptionPremiums([trade({})], candles, 1);
    expect(out!.optionEntryPremium).toBe(72);
    expect(out!.optionExitPremium).toBe(82);
    expect(out!.optionPnlRs).toBe(650);
    expect(out!.premiumEstimated).toBe(false);
  });

  it('does NOT borrow a stale prior-day bar (same-day only)', () => {
    const candles = new Map<number, Candle[]>([
      [111, [optCandle('2026-07-22T14:30:00+0530', 50, 55, 48, 52)]], // wrong day only
    ]);
    const [out] = enrichTradesWithOptionPremiums([trade({})], candles, 1);
    // No same-day match → estimated path, not the ₹52 stale bar.
    expect(out!.premiumEstimated).toBe(true);
  });
});

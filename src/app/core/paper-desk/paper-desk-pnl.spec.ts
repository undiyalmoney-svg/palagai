import { describe, expect, it } from 'vitest';
import {
  computeOptionPnl,
  enrichTradesWithOptionPremiums,
  entryPremiumEdge,
  lookupPremium,
} from './paper-desk-engine';
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
    exitReason: 'End of day',
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
    optionEntryEdge: 'close',
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

describe('entryPremiumEdge', () => {
  it('picks open for Trap-style open fills', () => {
    expect(entryPremiumEdge(100, { open: 100, close: 105 })).toBe('open');
  });

  it('picks close for Genie-style close fills', () => {
    expect(entryPremiumEdge(105, { open: 100, close: 105 })).toBe('close');
  });
});

describe('lookupPremium', () => {
  it('returns open or close by edge', () => {
    const bars = [optCandle('2026-07-23T14:30:00+0530', 72, 75, 71, 74)];
    expect(lookupPremium(bars, '2026-07-23T14:30:00+0530', 'open')).toBe(72);
    expect(lookupPremium(bars, '2026-07-23T14:30:00+0530', 'close')).toBe(74);
  });
});

describe('enrichTradesWithOptionPremiums', () => {
  it('uses Genie close-entry + EOD close-exit from option OHLC', () => {
    const candles = new Map<number, Candle[]>([
      [
        111,
        [
          optCandle('2026-07-23T14:30:00+0530', 72, 75, 71, 74),
          optCandle('2026-07-23T14:55:00+0530', 80, 83, 79, 82),
        ],
      ],
    ]);
    const [out] = enrichTradesWithOptionPremiums(
      [trade({ optionEntryEdge: 'close', exitReason: 'End of day' })],
      candles,
      1,
    );
    expect(out!.optionEntryPremium).toBe(74);
    expect(out!.optionExitPremium).toBe(82);
    expect(out!.optionPnlRs).toBe(computeOptionPnl({ entryPremium: 74, exitPremium: 82, lotSize: 65, lots: 1 }));
    expect(out!.premiumEstimated).toBe(false);
  });

  it('uses Trap open-entry when optionEntryEdge=open', () => {
    const candles = new Map<number, Candle[]>([
      [
        111,
        [
          optCandle('2026-07-23T14:30:00+0530', 72, 75, 71, 74),
          optCandle('2026-07-23T14:55:00+0530', 80, 83, 79, 82),
        ],
      ],
    ]);
    const [out] = enrichTradesWithOptionPremiums(
      [trade({ optionEntryEdge: 'open', exitReason: 'End of day' })],
      candles,
      1,
    );
    expect(out!.optionEntryPremium).toBe(72);
    expect(out!.optionExitPremium).toBe(82);
    expect(out!.premiumEstimated).toBe(false);
  });

  it('estimates SL/TP exits from index pts (no phantom bar-close profit)', () => {
    const candles = new Map<number, Candle[]>([
      [
        111,
        [
          optCandle('2026-07-23T14:30:00+0530', 72, 75, 71, 74),
          // Stop hit mid-bar but close recovered — must NOT credit the recovery
          optCandle('2026-07-23T14:55:00+0530', 60, 70, 55, 68),
        ],
      ],
    ]);
    const [out] = enrichTradesWithOptionPremiums(
      [
        trade({
          optionEntryEdge: 'close',
          exitReason: 'Stop loss hit',
          indexPoints: -30,
        }),
      ],
      candles,
      1,
    );
    expect(out!.premiumEstimated).toBe(true);
    // entry 74 (close) + δ0.5×(-30) = 59 → pnl (59-74)*65 = -975
    expect(out!.optionEntryPremium).toBe(74);
    expect(out!.optionExitPremium).toBe(59);
    expect(out!.optionPnlRs).toBe(-975);
  });

  it('forces estimate for synthetic contracts (historical missing week)', () => {
    const [out] = enrichTradesWithOptionPremiums(
      [
        trade({
          indexPoints: 40,
          option: {
            tradingSymbol: 'NIFTY ATM 24500 CE',
            instrumentToken: 0,
            strike: 24500,
            expiry: '2026-07-09',
            optionType: 'CE',
            lotSize: 65,
            source: 'synthetic',
          },
        }),
      ],
      new Map(),
      1,
    );
    expect(out!.premiumEstimated).toBe(true);
    // 0.5 * 40 = 20 premium pts × 65 = 1300
    expect(out!.optionPnlRs).toBe(1300);
  });

  it('does NOT borrow a stale prior-day bar', () => {
    const candles = new Map<number, Candle[]>([
      [111, [optCandle('2026-07-22T14:30:00+0530', 50, 55, 48, 52)]],
    ]);
    const [out] = enrichTradesWithOptionPremiums([trade({})], candles, 1);
    expect(out!.premiumEstimated).toBe(true);
  });

  it('never invents Genie-sized ₹ on tiny index pts via mixed estimate+OHLC', () => {
    // Only exit candle present — old bug could pair synthetic entry with real exit.
    const candles = new Map<number, Candle[]>([
      [111, [optCandle('2026-07-23T14:55:00+0530', 80, 200, 79, 195)]],
    ]);
    const [out] = enrichTradesWithOptionPremiums(
      [trade({ indexPoints: 24.4, optionEntryPremium: 10, exitReason: 'End of day' })],
      candles,
      1,
    );
    expect(out!.premiumEstimated).toBe(true);
    // Must track δ×index, not 195−10 phantoms
    expect(Math.abs(out!.optionPnlRs!)).toBeLessThan(65 * 50);
  });
});

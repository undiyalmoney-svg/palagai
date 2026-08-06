import { describe, expect, it } from 'vitest';
import { applyKiteFillPnl, deskLegHasKiteEntry } from './apply-kite-fill-pnl';
import { PaperTrade } from './paper-desk.models';

function trade(partial: Partial<PaperTrade> & Pick<PaperTrade, 'id' | 'instrumentId'>): PaperTrade {
  return {
    instrumentName: 'Nifty 50',
    direction: 'SELL',
    indexEntry: 23900,
    indexStop: 23930,
    indexTarget: 23840,
    indexExit: 23850,
    indexPoints: 50,
    entryTime: '2026-07-23 10:00:00',
    exitTime: '2026-07-23 11:00:00',
    exitReason: 'target',
    option: {
      tradingSymbol: 'NIFTY2572323900PE',
      instrumentToken: 1,
      strike: 23900,
      expiry: '2026-07-23',
      optionType: 'PE',
      lotSize: 65,
      source: 'chain',
    },
    optionEntryPremium: 100,
    optionExitPremium: 105,
    optionPnlRs: 325,
    premiumEstimated: true,
    outcome: 'WIN',
    ...partial,
  };
}

describe('applyKiteFillPnl', () => {
  it('uses Kite (exitAvg − entryAvg) × qty like Positions', () => {
    const trades = [
      trade({
        id: 't1',
        instrumentId: 'nifty',
        option: {
          tradingSymbol: 'NIFTY2572323900PE',
          instrumentToken: 1,
          strike: 23900,
          expiry: '2026-07-23',
          optionType: 'PE',
          lotSize: 65,
          source: 'chain',
        },
      }),
    ];

    const out = applyKiteFillPnl(trades, [
      {
        instrumentId: 'nifty',
        tradingSymbol: 'NIFTY2572323900PE',
        quantity: 65,
        leg: 'ENTRY',
        status: 'COMPLETE',
        averagePrice: 163.05,
        at: '2026-07-23T10:00:00.000Z',
      },
      {
        instrumentId: 'nifty',
        tradingSymbol: 'NIFTY2572323900PE',
        quantity: 65,
        leg: 'EXIT',
        status: 'COMPLETE',
        averagePrice: 175.2,
        at: '2026-07-23T11:00:00.000Z',
      },
    ]);

    expect(out[0]!.optionEntryPremium).toBe(163.05);
    expect(out[0]!.optionExitPremium).toBe(175.2);
    // (175.2 − 163.05) × 65 = 789.75
    expect(out[0]!.optionPnlRs).toBe(789.75);
    expect(out[0]!.premiumEstimated).toBe(false);
    expect(out[0]!.onKite).toBe(true);
  });

  it('leaves candle-based P&L when fills are incomplete', () => {
    const trades = [trade({ id: 't1', instrumentId: 'nifty', optionPnlRs: 400 })];
    const out = applyKiteFillPnl(trades, [
      {
        instrumentId: 'nifty',
        tradingSymbol: 'NIFTY2572323900PE',
        quantity: 65,
        leg: 'ENTRY',
        status: 'COMPLETE',
        averagePrice: 160,
        at: '2026-07-23T10:00:00.000Z',
      },
    ]);
    expect(out[0]!.optionPnlRs).toBe(400);
    expect(out[0]!.onKite).toBeUndefined();
  });

  it('pairs Bank SL-M fill the same way', () => {
    const trades = [
      trade({
        id: 'b1',
        instrumentId: 'banknifty',
        instrumentName: 'Bank Nifty',
        option: {
          tradingSymbol: 'BANKNIFTY2572356600PE',
          instrumentToken: 2,
          strike: 56600,
          expiry: '2026-07-23',
          optionType: 'PE',
          lotSize: 15,
          source: 'chain',
        },
      }),
    ];
    const out = applyKiteFillPnl(trades, [
      {
        instrumentId: 'banknifty',
        tradingSymbol: 'BANKNIFTY2572356600PE',
        quantity: 15,
        leg: 'ENTRY',
        status: 'COMPLETE',
        averagePrice: 440,
        at: '2026-07-23T09:30:00.000Z',
      },
      {
        instrumentId: 'banknifty',
        tradingSymbol: 'BANKNIFTY2572356600PE',
        quantity: 15,
        leg: 'SL-M',
        status: 'COMPLETE',
        averagePrice: 461.7,
        at: '2026-07-23T10:15:00.000Z',
      },
    ]);
    // (461.7 − 440) × 15 = 325.5
    expect(out[0]!.optionPnlRs).toBe(325.5);
  });

  it('does not overlay a different symbol fill onto a paper leg', () => {
    const trades = [
      trade({
        id: 'ce1',
        instrumentId: 'banknifty',
        instrumentName: 'Bank Nifty',
        direction: 'BUY',
        indexPoints: 8.8,
        entryTime: '2026-08-06 10:00:00',
        option: {
          tradingSymbol: 'BANKNIFTY2580652000CE',
          instrumentToken: 3,
          strike: 52000,
          expiry: '2026-08-06',
          optionType: 'CE',
          lotSize: 30,
          source: 'chain',
        },
        optionPnlRs: 264,
      }),
    ];
    const out = applyKiteFillPnl(trades, [
      {
        instrumentId: 'banknifty',
        tradingSymbol: 'BANKNIFTY2580652000PE',
        quantity: 30,
        leg: 'ENTRY',
        status: 'COMPLETE',
        averagePrice: 200,
        at: '2026-08-06T10:00:00.000Z',
      },
      {
        instrumentId: 'banknifty',
        tradingSymbol: 'BANKNIFTY2580652000PE',
        quantity: 30,
        leg: 'EXIT',
        status: 'COMPLETE',
        averagePrice: 180,
        at: '2026-08-06T10:30:00.000Z',
      },
    ]);
    // Must keep paper P&L — PE fills must not attach to CE paper leg.
    expect(out[0]!.optionPnlRs).toBe(264);
    expect(out[0]!.onKite).toBeUndefined();
  });

  it('pairs by nearest entry time when multiple same-symbol fills exist', () => {
    const trades = [
      trade({
        id: 'later',
        instrumentId: 'banknifty',
        entryTime: '2026-08-06 11:00:00',
        option: {
          tradingSymbol: 'BANKNIFTY2580652000CE',
          instrumentToken: 3,
          strike: 52000,
          expiry: '2026-08-06',
          optionType: 'CE',
          lotSize: 30,
          source: 'chain',
        },
      }),
    ];
    const out = applyKiteFillPnl(trades, [
      {
        instrumentId: 'banknifty',
        tradingSymbol: 'BANKNIFTY2580652000CE',
        quantity: 30,
        leg: 'ENTRY',
        status: 'COMPLETE',
        averagePrice: 100,
        at: '2026-08-06T09:30:00.000Z',
      },
      {
        instrumentId: 'banknifty',
        tradingSymbol: 'BANKNIFTY2580652000CE',
        quantity: 30,
        leg: 'EXIT',
        status: 'COMPLETE',
        averagePrice: 90,
        at: '2026-08-06T09:45:00.000Z',
      },
      {
        instrumentId: 'banknifty',
        tradingSymbol: 'BANKNIFTY2580652000CE',
        quantity: 30,
        leg: 'ENTRY',
        status: 'COMPLETE',
        averagePrice: 726,
        at: '2026-08-06T11:00:00.000Z',
      },
      {
        instrumentId: 'banknifty',
        tradingSymbol: 'BANKNIFTY2580652000CE',
        quantity: 30,
        leg: 'EXIT',
        status: 'COMPLETE',
        averagePrice: 738.5,
        at: '2026-08-06T11:40:00.000Z',
      },
    ]);
    expect(out[0]!.optionEntryPremium).toBe(726);
    expect(out[0]!.optionExitPremium).toBe(738.5);
    expect(out[0]!.optionPnlRs).toBe(375);
  });

  it('deskLegHasKiteEntry is true for ENTRY-only fills (not a miss)', () => {
    const t = trade({ id: 't1', instrumentId: 'nifty' });
    expect(
      deskLegHasKiteEntry(t, [
        {
          instrumentId: 'nifty',
          tradingSymbol: 'NIFTY2572323900PE',
          quantity: 65,
          leg: 'ENTRY',
          status: 'COMPLETE',
          averagePrice: 160,
          at: '2026-07-23T10:00:00.000Z',
        },
      ]),
    ).toBe(true);
  });

  it('deskLegHasKiteEntry is false when no ENTRY fill exists', () => {
    const t = trade({ id: 't1', instrumentId: 'nifty' });
    expect(deskLegHasKiteEntry(t, [])).toBe(false);
  });
});

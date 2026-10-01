import {
  chartProtectiveLevels,
  chartRupeePerPoint,
  fillsNeedingProtectiveSync,
  optionSideForAlert,
  shouldAutoTrade,
} from './chart-auto-trade.util';

describe('chart auto trade', () => {
  it('maps a BUY signal to the ATM call and a SELL to the ATM put', () => {
    expect(optionSideForAlert('BUY')).toBe('CE');
    expect(optionSideForAlert('SELL')).toBe('PE');
    expect(optionSideForAlert('TP1')).toBeNull();
    expect(optionSideForAlert('BOS_BULL')).toBeNull();
  });

  it('rests a 25% stop and a 0.5R target under the fill', () => {
    expect(chartProtectiveLevels(200)).toEqual({ stop: 150, target: 225 });
    expect(chartProtectiveLevels(0)).toBeNull();
  });

  it('moves the stop and target to the rupee caps when those are set', () => {
    // 65 qty: ₹1,300 loss = 20 premium, ₹650 profit = 10 premium.
    expect(
      chartProtectiveLevels(200, 0.05, {
        maxLossRs: 1_300,
        maxProfitRs: 650,
        rupeePerPoint: 65,
      }),
    ).toEqual({ stop: 180, target: 210 });
  });

  it('keeps the system side when only one rupee cap is set', () => {
    expect(
      chartProtectiveLevels(200, 0.05, {
        maxLossRs: 1_300,
        rupeePerPoint: 65,
      }),
    ).toEqual({ stop: 180, target: 225 });
  });

  it('fires only on a live open book with Auto on and a BUY/SELL alert', () => {
    const base = {
      autoTrade: true,
      liveDay: true,
      marketOpen: true,
      busy: false,
      type: 'BUY' as const,
    };
    expect(shouldAutoTrade(base)).toBe(true);
    expect(shouldAutoTrade({ ...base, type: 'SELL' })).toBe(true);
    expect(shouldAutoTrade({ ...base, autoTrade: false })).toBe(false);
    expect(shouldAutoTrade({ ...base, liveDay: false })).toBe(false);
    expect(shouldAutoTrade({ ...base, marketOpen: false })).toBe(false);
    expect(shouldAutoTrade({ ...base, busy: true })).toBe(false);
    expect(shouldAutoTrade({ ...base, type: 'EXIT' })).toBe(false);
  });

  it('accepts any rupee amount and moves an already-open fill when the cap changes', () => {
    expect(chartRupeePerPoint('nifty', 65)).toBe(65);
    expect(chartRupeePerPoint('crude', 1)).toBe(10);
    const open = {
      id: 'crude:1',
      status: 'OPEN',
      book: 'crude' as const,
      entry: 40,
      qty: 100,
      sl: 30,
      tp: 45,
    };
    const unset = {
      nifty: { maxProfitRs: null, maxLossRs: null },
      bank: { maxProfitRs: null, maxLossRs: null },
      crude: { maxProfitRs: null, maxLossRs: null },
    };
    // Already on the system 25% / 0.5R — leave it until the reader edits.
    expect(fillsNeedingProtectiveSync([open], unset)).toEqual([]);

    const crude560 = {
      ...unset,
      crude: { maxProfitRs: 560, maxLossRs: 560 },
    };
    const moved = fillsNeedingProtectiveSync([open], crude560);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.id).toBe('crude:1');
    const wanted = chartProtectiveLevels(40, 0.05, {
      maxProfitRs: 560,
      maxLossRs: 560,
      rupeePerPoint: 1000,
    });
    expect(moved[0]?.stop).toBe(wanted?.stop);
    expect(moved[0]?.target).toBe(wanted?.target);
    expect(
      fillsNeedingProtectiveSync([{ ...open, sl: wanted!.stop, tp: wanted!.target }], crude560),
    ).toEqual([]);
  });
});

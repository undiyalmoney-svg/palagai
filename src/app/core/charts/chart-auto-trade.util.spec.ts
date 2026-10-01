import {
  chartProtectiveLevels,
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
});

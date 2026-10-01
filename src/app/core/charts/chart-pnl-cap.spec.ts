import {
  anyCapSet,
  capSet,
  defaultPnlCaps,
  hitChartPnlCap,
  parsePnlCaps,
  parseRsCap,
} from './chart-pnl-cap';

describe('chart pnl caps', () => {
  it('treats blank, zero and junk as unset so the system stop/target stay in force', () => {
    expect(parseRsCap('')).toBeNull();
    expect(parseRsCap(0)).toBeNull();
    expect(parseRsCap(-50)).toBeNull();
    expect(parseRsCap('abc')).toBeNull();
    expect(parseRsCap(500)).toBe(500);
    expect(parseRsCap('1,250.5')).toBe(1250.5);
  });

  it('loads one cap pair per book and defaults the rest to unset', () => {
    expect(defaultPnlCaps()).toEqual({
      nifty: { maxProfitRs: null, maxLossRs: null },
      bank: { maxProfitRs: null, maxLossRs: null },
      crude: { maxProfitRs: null, maxLossRs: null },
    });
    const parsed = parsePnlCaps({
      nifty: { maxProfitRs: 800, maxLossRs: 400 },
      bank: { maxProfitRs: 0 },
    });
    expect(parsed.nifty).toEqual({ maxProfitRs: 800, maxLossRs: 400 });
    expect(parsed.bank).toEqual({ maxProfitRs: null, maxLossRs: null });
    expect(parsed.crude).toEqual({ maxProfitRs: null, maxLossRs: null });
    expect(capSet(parsed.nifty)).toBe(true);
    expect(capSet(parsed.bank)).toBe(false);
    expect(anyCapSet(parsed)).toBe(true);
  });

  it('fires only when that side is set and the live P&L has crossed it', () => {
    const cap = { maxProfitRs: 500, maxLossRs: 300 };
    expect(hitChartPnlCap(120, cap)).toBeNull();
    expect(hitChartPnlCap(500, cap)).toBe('PROFIT');
    expect(hitChartPnlCap(501, cap)).toBe('PROFIT');
    expect(hitChartPnlCap(-300, cap)).toBe('LOSS');
    expect(hitChartPnlCap(-301, cap)).toBe('LOSS');
    expect(hitChartPnlCap(800, { maxProfitRs: null, maxLossRs: 300 })).toBeNull();
    expect(hitChartPnlCap(-800, { maxProfitRs: 500, maxLossRs: null })).toBeNull();
    expect(hitChartPnlCap(null, cap)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { lotsFromAvailableFunds } from '../paper-desk/lots-from-funds';
import {
  chartBookKind,
  lotsForChartBook,
  lotsWithDelta,
  maxChartLots,
  sizingCapitalFromFunds,
} from './chart-lots.util';

describe('chart lots from funds', () => {
  it('treats Nifty and Bank as the index book, Crude as crude', () => {
    expect(chartBookKind('nifty')).toBe('index');
    expect(chartBookKind('bank')).toBe('index');
    expect(chartBookKind('crude')).toBe('crude');
  });

  it('prefers a positive Kite cash figure over saved capital', () => {
    expect(sizingCapitalFromFunds(80_000, 40_000)).toBe(80_000);
    expect(sizingCapitalFromFunds(1, 40_000)).toBe(1);
  });

  it('falls back to saved capital when Kite cash is missing or zero', () => {
    expect(sizingCapitalFromFunds(null, 40_000)).toBe(40_000);
    expect(sizingCapitalFromFunds(undefined, 40_000)).toBe(40_000);
    expect(sizingCapitalFromFunds(0, 120_000)).toBe(120_000);
    expect(sizingCapitalFromFunds(-10, 40_000)).toBe(40_000);
  });

  it('matches Trade Bot: ₹40,000 per index lot, Crude 3×, min 1 / 3, max 10 / 30', () => {
    const cases: Array<[number, number, number]> = [
      [0, 1, 3],
      [39_999, 1, 3],
      [40_000, 1, 3],
      [79_999, 1, 3],
      [80_000, 2, 6],
      [120_000, 3, 9],
      [200_000, 5, 15],
      [999_999, 10, 30],
    ];
    for (const [capital, indexLots, crudeLots] of cases) {
      expect(lotsFromAvailableFunds(capital, 'index')).toBe(indexLots);
      expect(lotsFromAvailableFunds(capital, 'crude')).toBe(crudeLots);
      expect(lotsForChartBook('nifty', capital, 10_000)).toBe(indexLots);
      expect(lotsForChartBook('bank', capital, 10_000)).toBe(indexLots);
      expect(lotsForChartBook('crude', capital, 10_000)).toBe(crudeLots);
    }
  });

  it('sizes Nifty and Bank the same, and Crude three times that band', () => {
    expect(lotsForChartBook('nifty', 80_000, 40_000)).toBe(2);
    expect(lotsForChartBook('bank', 80_000, 40_000)).toBe(2);
    expect(lotsForChartBook('crude', 80_000, 40_000)).toBe(6);
  });

  it('uses saved capital when the funds snapshot has not loaded', () => {
    expect(lotsForChartBook('nifty', null, 80_000)).toBe(2);
    expect(lotsForChartBook('crude', null, 80_000)).toBe(6);
  });

  it('lets +/− move lots from the funds base, clamped 1…max', () => {
    expect(lotsWithDelta('nifty', 2, 1)).toBe(3);
    expect(lotsWithDelta('nifty', 2, -1)).toBe(1);
    expect(lotsWithDelta('nifty', 1, -1)).toBe(1);
    expect(lotsWithDelta('nifty', 10, 1)).toBe(10);
    expect(lotsWithDelta('crude', 3, -2)).toBe(1);
    expect(lotsWithDelta('crude', 3, 40)).toBe(30);
    expect(maxChartLots('nifty')).toBe(10);
    expect(maxChartLots('crude')).toBe(30);
  });
});

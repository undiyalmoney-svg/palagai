import { describe, expect, it } from 'vitest';
import { HeatmapCompany } from './heatmap.models';
import { filterTiles, formatPct, sortTable, sortTiles, strongTrends } from './heatmap.util';

function row(partial: Partial<HeatmapCompany> & Pick<HeatmapCompany, 'symbol'>): HeatmapCompany {
  return {
    name: partial.symbol,
    sector: 'IT',
    mcapRank: 50,
    ltp: 100,
    change: 0,
    changePct: 0,
    high52: 120,
    low52: 80,
    ema20: 100,
    ema50: 99,
    adx: 20,
    trend: 'sideways',
    trendLabel: 'Sideways',
    score: 0,
    bucket: '1-to--1',
    ...partial,
  };
}

describe('heatmap util', () => {
  it('sorts market cap then gains', () => {
    const rows = [
      row({ symbol: 'INFY', mcapRank: 4, changePct: 1.7 }),
      row({ symbol: 'RELIANCE', mcapRank: 2, changePct: 1.0 }),
      row({ symbol: 'NESTLEIND', mcapRank: 32, changePct: 2.3 }),
    ];
    expect(sortTiles(rows, 'mcap').map((r) => r.symbol)).toEqual(['RELIANCE', 'INFY', 'NESTLEIND']);
    expect(sortTiles(rows, 'gains').map((r) => r.symbol)).toEqual(['NESTLEIND', 'INFY', 'RELIANCE']);
  });

  it('filters tiles by bucket without dropping the table universe', () => {
    const rows = [
      row({ symbol: 'SHRIRAMFIN', changePct: -3.94, bucket: 'below--3' }),
      row({ symbol: 'INFY', changePct: 1.76, bucket: '3-to-1' }),
      row({ symbol: 'MARUTI', changePct: 0.24, bucket: '1-to--1' }),
    ];
    expect(filterTiles(rows, 'below--3', null).map((r) => r.symbol)).toEqual(['SHRIRAMFIN']);
    expect(filterTiles(rows, null, null)).toHaveLength(3);
  });

  it('sorts the company table by LTP descending like Groww', () => {
    const rows = [
      row({ symbol: 'TITAN', ltp: 4439.3 }),
      row({ symbol: 'MARUTI', ltp: 11272 }),
      row({ symbol: 'EICHERMOT', ltp: 7085 }),
    ];
    expect(sortTable(rows, 'ltp', 'desc').map((r) => r.symbol)).toEqual(['MARUTI', 'EICHERMOT', 'TITAN']);
  });

  it('splits strong up and strong down for the finder strip', () => {
    const found = strongTrends([
      row({ symbol: 'TCS', trend: 'strong-up', score: 2.5 }),
      row({ symbol: 'INFY', trend: 'up', score: 1 }),
      row({ symbol: 'HDFCLIFE', trend: 'strong-down', score: -2.5 }),
    ]);
    expect(found.up.map((r) => r.symbol)).toEqual(['TCS']);
    expect(found.down.map((r) => r.symbol)).toEqual(['HDFCLIFE']);
  });

  it('formats percents with a sign', () => {
    expect(formatPct(1.76)).toBe('+1.76%');
    expect(formatPct(-3.94)).toBe('-3.94%');
    expect(formatPct(null)).toBe('—');
  });
});

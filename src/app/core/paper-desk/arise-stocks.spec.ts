import { describe, expect, it } from 'vitest';
import { ARISE_STOCK_QTY, ARISE_STOCKS, ariseStockOf, isAriseStock } from './arise-stocks';
import { LIVE_PAPER_STOP_RS } from './live-paper.engine';

describe('Arise cash stock count', () => {
  it('is 50 shares so a ₹370 stop is ₹7.40 a share', () => {
    expect(ARISE_STOCK_QTY).toBe(50);
    expect(LIVE_PAPER_STOP_RS / ARISE_STOCK_QTY).toBeCloseTo(7.4, 5);
    expect(ARISE_STOCKS.map((s) => s.symbol)).toEqual(['HDFCBANK', 'RELIANCE', 'ICICIBANK', 'INFY', 'TCS']);
    expect(isAriseStock('reliance')).toBe(true);
    expect(isAriseStock('nifty')).toBe(false);
    expect(ariseStockOf('tcs')?.symbol).toBe('TCS');
  });
});

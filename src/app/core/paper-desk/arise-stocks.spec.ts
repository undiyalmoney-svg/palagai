import { describe, expect, it } from 'vitest';
import {
  ARISE_STOCK_BANK_RS,
  ARISE_STOCK_DAY_MOVE_PCT,
  ARISE_STOCKS,
  ariseStockOf,
  ariseStockQty,
  isAriseStock,
} from './arise-stocks';

describe('Arise cash stock count', () => {
  it('sizes shares so a 1% day is ₹370, not a fixed 50', () => {
    expect(ARISE_STOCK_DAY_MOVE_PCT).toBe(0.01);
    expect(ARISE_STOCK_BANK_RS).toBe(370);
    expect(ariseStockQty(100)).toBe(370);
    expect(ariseStockQty(1_400)).toBe(26);
    expect(ariseStockQty(3_500)).toBe(11);
    expect(ariseStockQty(0)).toBe(0);
    expect(ARISE_STOCKS.map((s) => s.symbol)).toEqual(['HDFCBANK', 'RELIANCE', 'ICICIBANK', 'INFY', 'TCS']);
    expect(isAriseStock('reliance')).toBe(true);
    expect(isAriseStock('nifty')).toBe(false);
    expect(ariseStockOf('tcs')?.symbol).toBe('TCS');
  });
});

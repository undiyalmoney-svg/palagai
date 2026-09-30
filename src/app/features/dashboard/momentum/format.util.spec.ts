import { describe, expect, it } from 'vitest';
import { actionTone, errorMessage, inr, pctFrac, pctNum, regimeTone, signedInr } from './format.util';

describe('momentum format utils', () => {
  it('formats rupees the Indian way', () => {
    expect(inr(100000)).toBe('₹1,00,000');
    expect(inr(-2500, 2)).toBe('-₹2,500.00');
    expect(inr(null)).toBe('—');
    expect(signedInr(500)).toBe('+₹500');
  });

  it('formats fractions and percent values', () => {
    expect(pctFrac(0.123, 1, true)).toBe('+12.3%');
    expect(pctNum(-4.2, 1, true)).toBe('-4.2%');
  });

  it('maps actions and regimes to tones', () => {
    expect(actionTone('BUY')).toBe('up');
    expect(actionTone('STRONG_BUY')).toBe('strong');
    expect(actionTone('SELL')).toBe('down');
    expect(actionTone('REDUCE')).toBe('warn');
    expect(regimeTone('BULLISH')).toBe('up');
    expect(regimeTone('HIGH_VOLATILITY')).toBe('warn');
  });

  it('reads API error bodies and common HTTP statuses', () => {
    expect(errorMessage({ error: { message: 'No portfolio' } })).toBe('No portfolio');
    expect(errorMessage({ status: 0 })).toMatch(/trading server/i);
    expect(errorMessage({ status: 403 })).toMatch(/Momentum module/i);
    expect(errorMessage({ status: 401 })).toMatch(/sign in/i);
  });
});

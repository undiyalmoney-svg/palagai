import { describe, expect, it } from 'vitest';
import { errorMessage, inr, pctFrac, pctNum, signedInr } from './format.util';

describe('momentum format', () => {
  it('formats rupees and signed rupees', () => {
    expect(inr(100000)).toBe('₹1,00,000');
    expect(inr(-250.4, 2)).toBe('-₹250.40');
    expect(inr(null)).toBe('—');
    expect(signedInr(1200)).toBe('+₹1,200');
    expect(signedInr(-50)).toBe('-₹50');
  });

  it('treats fractions and already-percent values differently', () => {
    expect(pctFrac(0.123, 1, true)).toBe('+12.3%');
    expect(pctNum(12.3, 1, true)).toBe('+12.3%');
    expect(pctFrac(null)).toBe('—');
  });

  it('reads the server error message', () => {
    expect(errorMessage({ error: { message: 'Enter a capital of at least ₹5,000' } })).toBe(
      'Enter a capital of at least ₹5,000',
    );
    expect(errorMessage({ status: 0 })).toContain('Order API');
    expect(errorMessage({ status: 403 })).toContain('Momentum');
  });
});

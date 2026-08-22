import { describe, expect, it } from 'vitest';
import { deskLotsForCapital } from './desk-lots.util';

/**
 * These expectations mirror the SERVER ladder
 * (Palagai-Order-API live/daily-desk-defaults.js -> bookLotsFromCapitalRs:
 * min(10, max(1, floor(capital / 40000)))).
 *
 * The previous version of this spec encoded a client-only ladder that
 * disagreed with the server above ₹1L (₹4L showed 4 lots, server sized 10).
 * If this spec and the server ever diverge again, the server wins — it is
 * what actually sizes the order.
 */
describe('deskLotsForCapital (mirrors server bookLotsFromCapitalRs)', () => {
  it('maps capital to lots at ₹40k per lot, capped at 10', () => {
    expect(deskLotsForCapital(40_000)).toBe(1);
    expect(deskLotsForCapital(74_999)).toBe(1);
    expect(deskLotsForCapital(80_000)).toBe(2);
    expect(deskLotsForCapital(120_000)).toBe(3);
    expect(deskLotsForCapital(200_000)).toBe(5);
    expect(deskLotsForCapital(400_000)).toBe(10);
    expect(deskLotsForCapital(1_000_000)).toBe(10);
    expect(deskLotsForCapital(2_000_000)).toBe(10);
  });

  it('never returns 0 lots for small or invalid capital', () => {
    expect(deskLotsForCapital(10_000)).toBe(1);
    expect(deskLotsForCapital(0)).toBe(1);
    expect(deskLotsForCapital(NaN)).toBe(1);
    expect(deskLotsForCapital(-5_000)).toBe(1);
  });
});

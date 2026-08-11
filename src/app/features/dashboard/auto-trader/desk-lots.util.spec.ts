import { describe, expect, it } from 'vitest';
import { deskLotsForCapital } from './desk-lots.util';

describe('deskLotsForCapital (Order-API 1.3.122 ladder)', () => {
  it('maps capital bands to shared deskLots', () => {
    expect(deskLotsForCapital(40_000)).toBe(1);
    expect(deskLotsForCapital(74_999)).toBe(1);
    expect(deskLotsForCapital(75_000)).toBe(2);
    expect(deskLotsForCapital(80_000)).toBe(2);
    expect(deskLotsForCapital(199_999)).toBe(2);
    expect(deskLotsForCapital(200_000)).toBe(2);
    expect(deskLotsForCapital(300_000)).toBe(3);
    expect(deskLotsForCapital(400_000)).toBe(4);
    expect(deskLotsForCapital(500_000)).toBe(5);
    expect(deskLotsForCapital(600_000)).toBe(6);
    expect(deskLotsForCapital(900_000)).toBe(9);
    expect(deskLotsForCapital(1_000_000)).toBe(10);
    expect(deskLotsForCapital(2_000_000)).toBe(10);
  });
});

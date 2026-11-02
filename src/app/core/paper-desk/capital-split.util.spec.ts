import { describe, expect, it } from 'vitest';
import {
  CRUDE_OPTION_MIN_COMMODITY_RS,
  commodityShareRs,
  commodityTopUpRs,
  planCapitalSplit,
} from './capital-split.util';

describe('capital split across Kite equity and commodity', () => {
  it('₹50,000 is ₹40k equity + ₹10k commodity with all four books open inside the day cap', () => {
    const p = planCapitalSplit(50_000);
    expect(p.equityRs).toBe(40_000);
    expect(p.commodityRs).toBe(10_000);
    expect(p.mode).toBe('all-open');
    expect(p.rows.map((r) => r.book)).toEqual(['nifty', 'bank', 'sensex', 'crude']);
    expect(p.rows.every((r) => r.allowed)).toBe(true);
    expect(p.rows.filter((r) => r.pocket === 'equity').length).toBe(3);
    expect(p.rows.find((r) => r.book === 'crude')?.pocket).toBe('commodity');
    expect(p.allOpenPremiumRs).toBe(10_750);
    expect(p.allOpenWorstLossRs).toBe(1_145);
    expect(p.allOpenWorstLossPct).toBe(2.3);
    expect(p.allOpenWorstLossRs).toBeLessThanOrEqual(p.equityDayLossCapRs + p.commodityDayLossCapRs);
    expect(p.note).toMatch(/Not a guaranteed profit/);
  });

  it('₹14,000 is equity only: three index books one at a time, Crude blocked', () => {
    const p = planCapitalSplit(14_000);
    expect(p.commodityRs).toBe(0);
    expect(p.equityRs).toBe(14_000);
    expect(p.mode).toBe('one-at-a-time');
    expect(p.rows.find((r) => r.book === 'crude')?.allowed).toBe(false);
    expect(p.rows.find((r) => r.book === 'crude')?.reason).toMatch(/commodity pocket/);
    expect(p.rows.filter((r) => r.allowed).map((r) => r.book)).toEqual(['nifty', 'bank', 'sensex']);
  });

  it('₹21,000 funds Crude with ₹7,000 commodity but runs one book at a time', () => {
    const p = planCapitalSplit(21_000);
    expect(p.commodityRs).toBe(CRUDE_OPTION_MIN_COMMODITY_RS);
    expect(p.equityRs).toBe(14_000);
    expect(p.rows.every((r) => r.allowed)).toBe(true);
    expect(p.mode).toBe('one-at-a-time');
  });

  it('never splits below the Crude minimum and never starves equity under ₹14k', () => {
    expect(commodityShareRs(20_999)).toBe(0);
    expect(commodityShareRs(21_000)).toBe(7_000);
    expect(commodityShareRs(30_000)).toBe(7_000);
    expect(commodityShareRs(50_000)).toBe(10_000);
    expect(planCapitalSplit(0).mode).toBe('too-small');
  });

  it('tells you how much to move equity → commodity', () => {
    const p = planCapitalSplit(50_000);
    expect(commodityTopUpRs(p, 0)).toBe(10_000);
    expect(commodityTopUpRs(p, 4_000)).toBe(6_000);
    expect(commodityTopUpRs(p, 12_000)).toBe(0);
    expect(commodityTopUpRs(p, null)).toBe(10_000);
  });
});

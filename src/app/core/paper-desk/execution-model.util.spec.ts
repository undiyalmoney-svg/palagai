import { describe, expect, it } from 'vitest';
import { realisticFill } from './execution-model.util';
import { optionRoundTripCharges } from './option-charges.util';

describe('realisticFill', () => {
  it('buys the observed ask and gives a target one tick back, never the paper fill', () => {
    const f = realisticFill({
      book: 'sensex',
      qty: 20,
      entry: 172.55,
      exit: 204.55,
      reason: 'tp',
      entryBid: 172,
      entryAsk: 173,
      exitBid: null,
      exitAsk: null,
    });
    expect(f.entryFill).toBe(173.05);
    expect(f.exitFill).toBe(204.5);
    expect(f.grossRs).toBe(629);
    expect(f.chargesRs).toBeCloseTo(optionRoundTripCharges(173.05, 204.5, 20, 'BSE'), 2);
    expect(f.netRs).toBeCloseTo(629 - f.chargesRs, 2);
    expect(f.netRs).toBeLessThan(590);
    expect(f.quality).toBe('quoted');
    expect(f.spreadSlipRs).toBe(r2((0.5 + 0.05) * 20));
  });

  it('models a spread and slippage on both legs when no quote was observed', () => {
    const f = realisticFill({
      book: 'nifty',
      qty: 65,
      entry: 100,
      exit: 80,
      reason: 'sl',
      entryBid: null,
      entryAsk: null,
      exitBid: null,
      exitAsk: null,
    });
    expect(f.entryFill).toBe(101.05);
    expect(f.exitFill).toBe(79.15);
    expect(f.grossRs).toBe(-1423.5);
    expect(f.netRs).toBeLessThan(f.grossRs);
    expect(f.quality).toBe('modelled');
  });

  it('sells a stop at the observed bid when it is below the paper exit, and never above it', () => {
    const lower = realisticFill({
      book: 'bank',
      qty: 30,
      entry: 100,
      exit: 90,
      reason: 'scratch',
      entryBid: 99,
      entryAsk: 101,
      exitBid: 88,
      exitAsk: 90,
    });
    expect(lower.exitFill).toBe(87.95);
    const higher = realisticFill({
      book: 'bank',
      qty: 30,
      entry: 100,
      exit: 90,
      reason: 'sl',
      entryBid: 99,
      entryAsk: 101,
      exitBid: 95,
      exitAsk: 96,
    });
    expect(higher.exitFill).toBe(89.95);
    expect(lower.quality).toBe('quoted');
  });

  it('always costs more than the paper fill: realistic net is below paper gross for a flat trade', () => {
    const f = realisticFill({
      book: 'crude',
      qty: 10,
      entry: 150,
      exit: 150,
      reason: 'eod',
      entryBid: 149,
      entryAsk: 151,
      exitBid: 149,
      exitAsk: 151,
    });
    expect(f.grossRs).toBeLessThan(0);
    expect(f.netRs).toBeLessThan(f.grossRs);
  });
});

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

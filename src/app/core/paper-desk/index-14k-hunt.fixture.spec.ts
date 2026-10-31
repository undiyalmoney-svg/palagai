import { describe, expect, it } from 'vitest';
import { INDEX_14K_HUNT } from './index-14k-hunt.fixture';
import { decideBook, guardCapital } from './capital-guard.util';

describe('₹14k index hunt', () => {
  it('keeps Nifty, Bank and Sensex futures and ATM blocked at owner cash', () => {
    expect(INDEX_14K_HUNT.capitalRs).toBe(14_000);
    expect(INDEX_14K_HUNT.premiumBudgetRs).toBe(3_500);
    expect(INDEX_14K_HUNT.dayLossCapRs).toBe(420);
    expect(INDEX_14K_HUNT.books.nifty.futAllowed).toBe(false);
    expect(INDEX_14K_HUNT.books.bank.futAllowed).toBe(false);
    expect(INDEX_14K_HUNT.books.sensex.futAllowed).toBe(false);
    expect(INDEX_14K_HUNT.books.nifty.atmAllowed).toBe(false);
    expect(INDEX_14K_HUNT.books.bank.atmAllowed).toBe(false);
    expect(INDEX_14K_HUNT.books.sensex.atmAllowed).toBe(false);
    expect(decideBook('nifty', 14_000).allowed).toBe(false);
    expect(decideBook('bank', 14_000).allowed).toBe(false);
    expect(decideBook('sensex', 14_000).allowed).toBe(false);
    expect(guardCapital(14_000).liveBook).toBe('crude');
  });

  it('treats cheap OTM champions as a spot-delta proxy, not a live arm', () => {
    expect(INDEX_14K_HUNT.honest).toMatch(/not a live option tape/i);
    expect(INDEX_14K_HUNT.honest).toMatch(/not a guaranteed profit/i);
    for (const id of ['nifty', 'bank', 'sensex'] as const) {
      const c = INDEX_14K_HUNT.books[id].champion;
      expect(c).toBeTruthy();
      expect(c?.fits14k).toBe(true);
      expect(c?.oneStopRs).toBeLessThanOrEqual(INDEX_14K_HUNT.dayLossCapRs);
      expect(c?.openCostRs).toBeLessThanOrEqual(INDEX_14K_HUNT.premiumBudgetRs);
      expect(c?.redDays).toBeGreaterThan(0);
    }
  });
});

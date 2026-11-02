import { describe, expect, it } from 'vitest';
import {
  OWNER_CAPITAL_RS,
  atmLots,
  atmMinCapitalRs,
  canBuyAtmOption,
  chartAtmRefuseReason,
  crudeFuturesLots,
  dayLossCapRs,
  decideBook,
  expiryRule,
  guardCapital,
  indexOptionLots,
  oneStopOutRs,
} from './capital-guard.util';
import { planLotsForCapital } from './capital-plan.util';
import { lotsFromAvailableFunds } from './lots-from-funds';

describe('₹14k capital guard', () => {
  it('blocks ATM on every book at ₹14k and allows cheap CE/PE instead', () => {
    expect(OWNER_CAPITAL_RS).toBe(14_000);
    expect(canBuyAtmOption('nifty', 14_000)).toBe(false);
    expect(canBuyAtmOption('bank', 14_000)).toBe(false);
    expect(canBuyAtmOption('sensex', 14_000)).toBe(false);
    expect(canBuyAtmOption('crude', 14_000)).toBe(false);
    expect(indexOptionLots(14_000)).toBe(0);
    expect(decideBook('nifty', 14_000).allowed).toBe(true);
    expect(decideBook('nifty', 14_000).product).toBe('CEPE');
    expect(decideBook('bank', 14_000).allowed).toBe(true);
    expect(decideBook('sensex', 14_000).allowed).toBe(true);
    expect(decideBook('sensex', 14_000).product).toBe('CEPE');
    expect(decideBook('nifty', 14_000).reason).toMatch(/cheap CE\/PE/i);
    expect(decideBook('crude', 14_000).reason).not.toMatch(/No option buying/);
  });

  it('allows Crude cheap CE/PE at ₹14k and refuses FUT — Kite needs ~₹31k', () => {
    const crude = decideBook('crude', 14_000);
    expect(crude.allowed).toBe(true);
    expect(crude.lots).toBe(1);
    expect(crude.product).toBe('CEPE');
    expect(crude.reason).toMatch(/₹14,000 is rejected/i);
    expect(crudeFuturesLots(14_000)).toBe(0);
    expect(lotsFromAvailableFunds(14_000, 'index')).toBe(0);
    expect(lotsFromAvailableFunds(14_000, 'crude')).toBe(0);
    expect(lotsFromAvailableFunds(31_000, 'crude')).toBe(1);
    expect(guardCapital(14_000).liveBook).toBe('crude');
  });

  it('cheap OTM one-stops fit the ₹420 day-loss; ATM 25% would not', () => {
    expect(oneStopOutRs('nifty')).toBe(325);
    expect(oneStopOutRs('bank')).toBe(300);
    expect(oneStopOutRs('sensex')).toBe(320);
    expect(oneStopOutRs('crude')).toBe(200);
    expect(oneStopOutRs('nifty', 40_000)).toBe(325);
    expect(oneStopOutRs('nifty', 84_000)).toBe(2_500);
    const g = guardCapital(14_000);
    expect(g.books.find((b) => b.book === 'nifty')?.oneLossPct).toBe(2.3);
    expect(g.books.find((b) => b.book === 'crude')?.oneLossPct).toBe(1.4);
    expect(g.dayLossCapRs).toBe(dayLossCapRs(14_000));
    expect(g.dayLossCapRs).toBe(420);
    expect(g.liveBook).toBe('crude');
    expect(g.allowed).toEqual(['nifty', 'bank', 'sensex', 'crude']);
    expect(g.note).toMatch(/motto CE\/PE/);
  });

  it('does not arm index lots in the 40k planner below ₹40k', () => {
    const p = planLotsForCapital(14_000);
    expect(p.niftyLots).toBe(0);
    expect(p.bankLots).toBe(0);
    expect(p.enableNifty).toBe(false);
    expect(p.enableBank).toBe(false);
  });

  it('keeps the 40k lot planner unchanged but blocks ATM until one stop fits the day cap', () => {
    expect(indexOptionLots(40_000)).toBe(1);
    const p = planLotsForCapital(40_000);
    expect(p.niftyLots).toBe(1);
    expect(p.bankLots).toBe(1);
    expect(canBuyAtmOption('nifty', 40_000)).toBe(false);
    expect(canBuyAtmOption('nifty', 83_000)).toBe(false);
    expect(canBuyAtmOption('nifty', 84_000)).toBe(true);
    expect(canBuyAtmOption('bank', 99_000)).toBe(false);
    expect(canBuyAtmOption('bank', 100_000)).toBe(true);
    expect(atmMinCapitalRs('nifty')).toBe(84_000);
    expect(atmMinCapitalRs('bank')).toBe(100_000);
    expect(atmMinCapitalRs('sensex')).toBeNull();
    expect(atmLots('nifty', 84_000)).toBe(1);
    expect(atmLots('bank', 100_000)).toBe(1);
    expect(decideBook('nifty', 84_000).product).toBe('CEPE');
    expect(decideBook('nifty', 84_000).reason).toMatch(/ATM CE\/PE ×1/);
  });

  it('at ₹50k no book risks more than the day cap and Crude FUT is not sized', () => {
    const g = guardCapital(50_000);
    expect(g.premiumBudgetRs).toBe(12_500);
    expect(g.dayLossCapRs).toBe(1_500);
    expect(canBuyAtmOption('nifty', 50_000)).toBe(false);
    expect(canBuyAtmOption('bank', 50_000)).toBe(false);
    expect(g.books.every((b) => b.product === 'CEPE')).toBe(true);
    for (const b of g.books) expect(b.oneLossRs * b.lots).toBeLessThanOrEqual(g.dayLossCapRs);
    expect(g.allOpenPremiumRs).toBe(10_750);
    expect(g.allOpenWorstLossRs).toBe(1_145);
    expect(g.allOpenWorstLossRs).toBeLessThanOrEqual(g.dayLossCapRs);
    expect(g.note).toMatch(/ATM blocked/);
    expect(g.note).not.toMatch(/stays FUT/);
    expect(crudeFuturesLots(50_000)).toBe(1);
    expect(lotsFromAvailableFunds(50_000, 'crude')).toBe(1);
  });

  it('rolls the dying contract on expiry day', () => {
    expect(expiryRule('nifty')).toMatch(/next Tuesday/i);
    expect(expiryRule('bank')).toMatch(/next month/i);
    expect(expiryRule('crude')).toMatch(/next listed expiry/i);
    expect(expiryRule('sensex')).toMatch(/next Friday/i);
  });

  it('refuses Charts ATM option buys at ₹14k on every book, and leaves ₹40k Charts alone', () => {
    expect(chartAtmRefuseReason('nifty', 14_000)).toMatch(/Nifty/i);
    expect(chartAtmRefuseReason('nifty', 14_000)).toMatch(/14k plan on Test/i);
    expect(chartAtmRefuseReason('bank', 14_000)).toMatch(/Bank Nifty/i);
    expect(chartAtmRefuseReason('crude', 14_000)).toMatch(/rejects 1 lot at ₹14,000/i);
    expect(chartAtmRefuseReason('sensex', 14_000)).toMatch(/Sensex ATM is blocked/i);
    expect(chartAtmRefuseReason('nifty', 50_000)).toMatch(/₹2,500 vs ₹1,500 day cap/);
    expect(chartAtmRefuseReason('nifty', 50_000)).toMatch(/Need ≥₹84,000/);
    expect(chartAtmRefuseReason('bank', 50_000)).toMatch(/Need ≥₹1,00,000/);
    expect(chartAtmRefuseReason('nifty', 84_000)).toBeNull();
    expect(chartAtmRefuseReason('bank', 100_000)).toBeNull();
    expect(chartAtmRefuseReason('crude', 40_000)).toBeNull();
  });
});

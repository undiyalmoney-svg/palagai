import { describe, expect, it } from 'vitest';
import {
  OWNER_CAPITAL_RS,
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
    expect(oneStopOutRs('nifty', 40_000)).toBe(2_500);
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

  it('keeps Nifty+Bank ×1 at ₹40k so the bigger-capital desk is unchanged', () => {
    expect(indexOptionLots(40_000)).toBe(1);
    expect(canBuyAtmOption('nifty', 40_000)).toBe(true);
    const p = planLotsForCapital(40_000);
    expect(p.niftyLots).toBe(1);
    expect(p.bankLots).toBe(1);
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
    expect(chartAtmRefuseReason('nifty', 40_000)).toBeNull();
    expect(chartAtmRefuseReason('bank', 40_000)).toBeNull();
    expect(chartAtmRefuseReason('crude', 40_000)).toBeNull();
  });
});

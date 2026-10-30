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
  it('blocks Nifty, Bank and Sensex ATM option buying at ₹14k', () => {
    expect(OWNER_CAPITAL_RS).toBe(14_000);
    expect(canBuyAtmOption('nifty', 14_000)).toBe(false);
    expect(canBuyAtmOption('bank', 14_000)).toBe(false);
    expect(canBuyAtmOption('sensex', 14_000)).toBe(false);
    expect(indexOptionLots(14_000)).toBe(0);
    expect(decideBook('nifty', 14_000).allowed).toBe(false);
    expect(decideBook('bank', 14_000).allowed).toBe(false);
    expect(decideBook('sensex', 14_000).allowed).toBe(false);
    expect(decideBook('sensex', 14_000).product).toBe('none');
  });

  it('allows only 1 Crude Mini future lot at ₹14k — not 3, not options', () => {
    const crude = decideBook('crude', 14_000);
    expect(crude.allowed).toBe(true);
    expect(crude.lots).toBe(1);
    expect(crude.product).toBe('FUT');
    expect(crudeFuturesLots(14_000)).toBe(1);
    expect(lotsFromAvailableFunds(14_000, 'index')).toBe(0);
    expect(lotsFromAvailableFunds(14_000, 'crude')).toBe(1);
  });

  it('a Nifty ATM 25% stop would take ~18% of ₹14k; Crude 20-pt stop takes ~1.4%', () => {
    expect(oneStopOutRs('nifty')).toBe(2_500);
    expect(oneStopOutRs('bank')).toBe(3_000);
    expect(oneStopOutRs('crude')).toBe(200);
    const g = guardCapital(14_000);
    expect(g.books.find((b) => b.book === 'nifty')?.oneLossPct).toBe(17.9);
    expect(g.books.find((b) => b.book === 'crude')?.oneLossPct).toBe(1.4);
    expect(g.dayLossCapRs).toBe(dayLossCapRs(14_000));
    expect(g.dayLossCapRs).toBe(420);
    expect(g.liveBook).toBe('crude');
    expect(g.allowed).toEqual(['crude']);
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
    expect(expiryRule('crude')).toMatch(/next listed future/i);
    expect(expiryRule('sensex')).toMatch(/not a live book/i);
  });

  it('refuses Charts ATM option buys at ₹14k on every book, and leaves ₹40k Charts alone', () => {
    expect(chartAtmRefuseReason('nifty', 14_000)).toMatch(/Nifty/i);
    expect(chartAtmRefuseReason('bank', 14_000)).toMatch(/Bank Nifty/i);
    expect(chartAtmRefuseReason('crude', 14_000)).toMatch(/Crude Oil tab/i);
    expect(chartAtmRefuseReason('sensex', 14_000)).toMatch(/display-only/i);
    expect(chartAtmRefuseReason('nifty', 40_000)).toBeNull();
    expect(chartAtmRefuseReason('bank', 40_000)).toBeNull();
    expect(chartAtmRefuseReason('crude', 40_000)).toBeNull();
  });
});

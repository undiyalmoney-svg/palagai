import { describe, expect, it } from 'vitest';
import { dnaCapsForStrategy } from './strategy-dna-caps';
import { MANAGED_STRATEGY_IDS } from './managed-strategy-ids';

describe('dnaCapsForStrategy', () => {
  it('unlocks max trades for non-Trap strategies (0 = unlimited)', () => {
    const ids = Object.values(MANAGED_STRATEGY_IDS).filter(
      (id) => id !== MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM,
    );
    for (const id of ids) {
      expect(dnaCapsForStrategy(id, 'nifty').maxTradesPerDay).toBe(0);
      expect(dnaCapsForStrategy(id, 'bank').maxTradesPerDay).toBe(0);
    }
  });

  it('caps Trap at 5/day · 3.5R for option-₹ hunt DNA', () => {
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM, 'nifty')).toEqual({
      maxTradesPerDay: 5,
      targetRMultiple: 3.5,
    });
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM, 'bank').maxTradesPerDay).toBe(
      5,
    );
  });

  it('keeps research R targets', () => {
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R, 'nifty')).toEqual({
      maxTradesPerDay: 0,
      targetRMultiple: 2,
    });
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE, 'nifty').targetRMultiple).toBe(
      3,
    );
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE, 'bank').targetRMultiple).toBe(
      1.5,
    );
  });
});

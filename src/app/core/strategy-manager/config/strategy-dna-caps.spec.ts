import { describe, expect, it } from 'vitest';
import { dnaCapsForStrategy } from './strategy-dna-caps';
import { MANAGED_STRATEGY_IDS } from './managed-strategy-ids';

describe('dnaCapsForStrategy', () => {
  it('unlocks max trades for every strategy (0 = unlimited)', () => {
    const ids = Object.values(MANAGED_STRATEGY_IDS);
    for (const id of ids) {
      expect(dnaCapsForStrategy(id, 'nifty').maxTradesPerDay).toBe(0);
      expect(dnaCapsForStrategy(id, 'bank').maxTradesPerDay).toBe(0);
    }
  });

  it('keeps research R targets', () => {
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R, 'nifty')).toEqual({
      maxTradesPerDay: 0,
      targetRMultiple: 2,
    });
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM, 'nifty')).toEqual({
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

import { describe, expect, it } from 'vitest';
import { dnaCapsForStrategy } from './strategy-dna-caps';
import { MANAGED_STRATEGY_IDS } from './managed-strategy-ids';

describe('dnaCapsForStrategy', () => {
  it('gives Donch default 3 trades/day', () => {
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R, 'nifty')).toEqual({
      maxTradesPerDay: 3,
      targetRMultiple: 2,
    });
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R, 'bank').maxTradesPerDay).toBe(
      3,
    );
  });

  it('gives trap max-earn 3 trades and 3.5R', () => {
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM, 'nifty')).toEqual({
      maxTradesPerDay: 3,
      targetRMultiple: 3.5,
    });
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM, 'bank').maxTradesPerDay).toBe(
      3,
    );
  });

  it('keeps GENIE channel caps (must not share one max across indices)', () => {
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE, 'nifty').maxTradesPerDay).toBe(
      2,
    );
    expect(dnaCapsForStrategy(MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE, 'bank').maxTradesPerDay).toBe(
      1,
    );
  });
});

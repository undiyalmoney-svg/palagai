import { describe, expect, it } from 'vitest';
import { dnaCapsForStrategy } from './strategy-dna-caps';
import { MANAGED_STRATEGY_IDS } from './managed-strategy-ids';
import { settingsKey } from './strategy-assignment.service';

describe('dnaCapsForStrategy', () => {
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

  it('scopes settings keys per channel so Bank DNA cannot clobber Nifty', () => {
    expect(settingsKey('align-combo-genie', 'nifty')).toBe('align-combo-genie::nifty');
    expect(settingsKey('align-combo-genie', 'bank')).toBe('align-combo-genie::bank');
    expect(settingsKey('sr-trap-confirm', 'nifty')).not.toBe(
      settingsKey('sr-trap-confirm', 'bank'),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { SrTrapConfirmManagedStrategy } from './sr-trap-confirm.managed-strategy';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';

describe('SrTrapConfirmManagedStrategy', () => {
  it('registers trap book with mt3 / 3.5R', () => {
    const s = new SrTrapConfirmManagedStrategy();
    s.initialize();
    expect(s.id).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM);
    expect(s.name).toContain('Trap');
    expect(s.getSettings().maxTradesPerDay).toBe(3);
    expect(s.getSettings().targetRMultiple).toBe(3.5);
    expect(s.supports).toContain('nifty');
    expect(s.supports).toContain('bank');
  });
});

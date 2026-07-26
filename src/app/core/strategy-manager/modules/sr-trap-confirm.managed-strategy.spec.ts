import { describe, expect, it } from 'vitest';
import { SrTrapConfirmManagedStrategy } from './sr-trap-confirm.managed-strategy';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';

describe('SrTrapConfirmManagedStrategy', () => {
  it('registers default trap book with mt3 / 3.5R / day stop 60 / ₹1000 cap', () => {
    const s = new SrTrapConfirmManagedStrategy();
    s.initialize();
    expect(s.id).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM);
    expect(s.name).toContain('Trap');
    expect(s.getSettings().maxTradesPerDay).toBe(3);
    expect(s.getSettings().targetRMultiple).toBe(3.5);
    expect(s.getSettings().dayStopPts).toBe(60);
    expect(s.getSettings().dayLossCapRs).toBe(1000);
    expect(s.supports).toContain('nifty');
    expect(s.supports).toContain('bank');
  });

  it('keeps the ₹ cap after a DNA re-hydrate', () => {
    const s = new SrTrapConfirmManagedStrategy();
    s.initialize({ maxTradesPerDay: 3, targetRMultiple: 3.5 });
    expect(s.getSettings().dayLossCapRs).toBe(1000);
  });
});

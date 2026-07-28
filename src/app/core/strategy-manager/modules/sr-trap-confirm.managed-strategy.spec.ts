import { describe, expect, it } from 'vitest';
import { SrTrapConfirmManagedStrategy } from './sr-trap-confirm.managed-strategy';
import { DEFAULT_CHANNEL_ASSIGNMENTS, MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';

describe('SrTrapConfirmManagedStrategy', () => {
  it('is indices default with mt3 / 3.5R / 1R→BE protect', () => {
    const s = new SrTrapConfirmManagedStrategy();
    s.initialize();
    expect(s.id).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM);
    expect(s.name).toContain('Trap');
    expect(s.getSettings().maxTradesPerDay).toBe(3);
    expect(s.getSettings().targetRMultiple).toBe(3.5);
    expect(s.getSettings().profitProtectEnabled).toBe(true);
    expect(s.getSettings().profitProtectArmR).toBe(1);
    expect(s.getSettings().profitProtectLockR).toBe(0);
    expect(s.getSettings().extras['profitLockArmRs']).toBe(1000);
    expect(s.getSettings().extras['profitLockLockRs']).toBe(500);
    expect(s.getSettings().extras['profitLockGivebackRs']).toBe(500);
    expect(s.supports).toContain('nifty');
    expect(s.supports).toContain('bank');
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.nifty.paper).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM);
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.nifty.live).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM);
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.bank.paper).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM);
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.bank.live).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM);
  });
});

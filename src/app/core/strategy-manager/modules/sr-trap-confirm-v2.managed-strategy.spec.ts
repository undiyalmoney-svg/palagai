import { describe, expect, it } from 'vitest';
import { SrTrapConfirmV2ManagedStrategy } from './sr-trap-confirm-v2.managed-strategy';
import { DEFAULT_CHANNEL_ASSIGNMENTS, MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';

describe('SrTrapConfirmV2ManagedStrategy', () => {
  it('is the Nifty/Bank Paper+Live default with option-₹ DNA and a hard ₹300/lot cap', () => {
    const s = new SrTrapConfirmV2ManagedStrategy();
    s.initialize();
    expect(s.id).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2);
    expect(s.name).toContain('Trap');
    expect(s.getSettings().maxTradesPerDay).toBe(3);
    expect(s.getSettings().targetRMultiple).toBe(3.5);
    expect(s.getSettings().extras['piercePts']).toBe(20);
    expect(s.getSettings().extras['bankPiercePts']).toBe(40);
    expect(s.getSettings().extras['profitLockArmRs']).toBe(100);
    expect(s.getSettings().extras['profitLockLockRs']).toBe(50);
    expect(s.getSettings().extras['profitLockGivebackRs']).toBe(50);
    expect(s.getSettings().extras['maxOptionLossRs']).toBe(300);
    expect(s.supports).toContain('nifty');
    expect(s.supports).toContain('bank');
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.nifty.paper).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2);
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.nifty.live).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2);
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.bank.paper).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2);
    expect(DEFAULT_CHANNEL_ASSIGNMENTS.bank.live).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM_V2);
  });
});

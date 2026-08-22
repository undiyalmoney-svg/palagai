import { describe, expect, it } from 'vitest';
import { SrTrapConfirmManagedStrategy } from './sr-trap-confirm.managed-strategy';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';

/**
 * Superseded by SR_TRAP_CONFIRM_V2 (sr-trap-confirm-v2.managed-strategy.spec.ts)
 * as the Nifty/Bank default — this strategy stays registered (not deleted)
 * for comparison against the loss history it was live for, so its own
 * settings are still worth pinning here.
 */
describe('SrTrapConfirmManagedStrategy', () => {
  it('has option-₹ DNA (pierce20 · Bank40 · peak₹100 · max3 · 3.5R)', () => {
    const s = new SrTrapConfirmManagedStrategy();
    s.initialize();
    expect(s.id).toBe(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM);
    expect(s.name).toContain('Trap');
    expect(s.getSettings().maxTradesPerDay).toBe(3);
    expect(s.getSettings().dayStopPts).toBe(60);
    expect(s.getSettings().targetRMultiple).toBe(3.5);
    expect(s.getSettings().profitProtectEnabled).toBe(true);
    expect(s.getSettings().profitProtectArmR).toBe(1);
    expect(s.getSettings().profitProtectLockR).toBe(0);
    expect(s.getSettings().extras['piercePts']).toBe(20);
    expect(s.getSettings().extras['bankPiercePts']).toBe(40);
    expect(s.getSettings().extras['bounceOrPierceMult']).toBe(0);
    expect(s.getSettings().extras['bounceOrPierceCap']).toBe(0);
    expect(s.getSettings().extras['profitLockArmRs']).toBe(100);
    expect(s.getSettings().extras['profitLockLockRs']).toBe(50);
    expect(s.getSettings().extras['profitLockGivebackRs']).toBe(50);
    expect(s.getSettings().extras['slConfirmCutoffEnabled']).toBe(false);
    expect(s.supports).toContain('nifty');
    expect(s.supports).toContain('bank');
  });
});

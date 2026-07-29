import { describe, expect, it } from 'vitest';
import { AlignComboGenieManagedStrategy } from './align-combo-genie.managed-strategy';
import { MANAGED_STRATEGY_IDS } from '../config/managed-strategy-ids';
import {
  instrumentAllowedByGenieRoute,
  resolveGenieV3Route,
} from '../engines/smart-pullback-pro.engine';

describe('AlignComboGenieManagedStrategy', () => {
  it('registers as align-combo-genie on nifty+bank with GENIE on', () => {
    const s = new AlignComboGenieManagedStrategy();
    s.initialize();
    expect(s.id).toBe(MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE);
    expect(s.name).toBe('Genie');
    expect(s.supports).toEqual(['nifty', 'bank', 'stocks']);
    expect(s.getSettings().extras?.['genieRouterEnabled']).toBe(true);
    expect(s.getSettings().extras?.['slConfirmCutoffEnabled']).toBe(true);
    expect(s.getSettings().extras?.['slConfirmCutoffFracR']).toBe(0.55);
    expect(s.getSettings().extras?.['slConfirmCutoffMaxMfeR']).toBe(0.75);
    expect(s.getSettings().extras?.['slConfirmSoftRs']).toBe(700);
    expect(s.getSettings().extras?.['profitLockArmRs']).toBe(600);
    expect(s.getSettings().extras?.['profitLockGivebackRs']).toBe(300);
    expect(s.getSettings().extras?.['dayLossCapRs']).toBe(2500);
    expect(s.getSettings().extras?.['dayBankQuitRs']).toBe(0);
  });

  it('maps screenshot-style aligned dump day to BOTH (short combo)', () => {
    // Both indices same bias + strong drive → COMBO (your PE short day).
    expect(
      resolveGenieV3Route({
        wd: 2, // Wed
        nDrive: 0.6,
        bDrive: 0.7,
        nGap: -80,
        bGap: -200,
        aligned: true,
      }),
    ).toBe('BOTH');
    expect(instrumentAllowedByGenieRoute('BOTH', 'NIFTY')).toBe(true);
    expect(instrumentAllowedByGenieRoute('BOTH', 'BANKNIFTY')).toBe(true);
  });
});

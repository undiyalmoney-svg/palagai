import { describe, expect, it } from 'vitest';
import {
  DESK_OPTION_DAY_LOSS_RS,
  deskOptionDayLossMoneyRs,
  isOptionDayLossBreached,
  optionDayLossReason,
} from './option-day-loss.util';

describe('option-day-loss.util', () => {
  it('uses ₹350 1-lot band (blocks stacking like 2026-08-10 −₹593)', () => {
    expect(DESK_OPTION_DAY_LOSS_RS).toBe(350);
    expect(deskOptionDayLossMoneyRs(1)).toBe(350);
    expect(deskOptionDayLossMoneyRs(2)).toBe(700);
  });

  it('breaches after first Bank PE scratch + second (−72 + −309)', () => {
    expect(isOptionDayLossBreached(-72)).toBe(false);
    expect(isOptionDayLossBreached(-72 - 309)).toBe(true);
    expect(isOptionDayLossBreached(-350)).toBe(true);
    expect(isOptionDayLossBreached(-349.99)).toBe(false);
  });

  it('scales floor with lots', () => {
    expect(isOptionDayLossBreached(-500, 2)).toBe(false);
    expect(isOptionDayLossBreached(-700, 2)).toBe(true);
  });

  it('explains stand-down in operator language', () => {
    expect(optionDayLossReason(-381)).toContain('−₹350');
    expect(optionDayLossReason(-381)).toContain('no new entries');
  });
});

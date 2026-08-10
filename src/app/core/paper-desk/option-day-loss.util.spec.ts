import { describe, expect, it } from 'vitest';
import {
  DESK_OPTION_DAY_LOSS_RS,
  combinedOptionDayNetRs,
  deskOptionDayLossMoneyRs,
  isOptionDayLossBreached,
  optionDayLossLegKey,
  optionDayLossReason,
  runningOptionNetAfterClose,
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

  it('sums current-tick closed option ₹ and skips missed same-batch legs', () => {
    const trades = [
      { instrumentId: 'bank-nifty', entryTime: 't1', optionPnlRs: -72 },
      { instrumentId: 'bank-nifty', entryTime: 't2', optionPnlRs: -309, netOptionPnlRs: -320 },
      { instrumentId: 'nifty-50', entryTime: 't3', optionPnlRs: -211 },
    ];
    expect(combinedOptionDayNetRs(trades)).toBe(-72 - 320 - 211);
    const exclude = new Set([optionDayLossLegKey('nifty-50', 't3')]);
    expect(combinedOptionDayNetRs(trades, exclude)).toBe(-72 - 320);
    expect(isOptionDayLossBreached(combinedOptionDayNetRs(trades, exclude))).toBe(true);
  });

  it('running net: Bank close in same tick blocks the next open (flush race)', () => {
    let running = -72; // prior tick
    expect(isOptionDayLossBreached(running)).toBe(false);
    running = runningOptionNetAfterClose(running, -309); // Bank PE #2 close this tick
    expect(running).toBe(-381);
    expect(isOptionDayLossBreached(running)).toBe(true); // Nifty open must SKIP
  });
});

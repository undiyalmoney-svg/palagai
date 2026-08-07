import { describe, expect, it } from 'vitest';
import {
  RESEARCH_DAY_LOCK_RS,
  RESEARCH_INDEX_CHARGE_RS,
  applyResearchDayLock,
  researchLockedByMonth,
  researchLockedNetRs,
  researchTradeIndexRs,
} from './research-locked-pnl.util';

describe('researchLockedPnl', () => {
  it('charges ₹40 and uses Nifty ₹65 / Bank ₹30', () => {
    expect(RESEARCH_INDEX_CHARGE_RS).toBe(40);
    expect(RESEARCH_DAY_LOCK_RS).toBe(3000);
    expect(researchTradeIndexRs({ instrumentId: 'nifty', indexPoints: 10 })).toBe(10 * 65 - 40);
    expect(researchTradeIndexRs({ instrumentId: 'banknifty', indexPoints: 20 })).toBe(20 * 30 - 40);
  });

  it('locks green days at ₹3k (research monthly meter)', () => {
    const locked = applyResearchDayLock(
      new Map([
        ['2026-07-01', 6460],
        ['2026-07-02', 1772],
        ['2026-07-03', -200],
      ]),
    );
    expect(locked.get('2026-07-01')).toBe(3000);
    expect(locked.get('2026-07-02')).toBe(1772);
    expect(locked.get('2026-07-03')).toBe(-200);
  });

  it('sums Locked ₹ and groups by month', () => {
    const trades = [
      { instrumentId: 'nifty', indexPoints: 100, entryTime: '2026-07-01 10:00:00' }, // 6460→3000
      { instrumentId: 'banknifty', indexPoints: 20, entryTime: '2026-07-02 11:00:00' }, // 560
      { instrumentId: 'nifty', indexPoints: 50, entryTime: '2026-08-03 10:00:00' }, // 3210→3000
    ];
    expect(researchLockedNetRs(trades)).toBe(3000 + 560 + 3000);
    expect(researchLockedByMonth(trades, { toDate: '2026-08-07' })).toEqual({
      '2026-07': 3560,
      '2026-08': 3000,
    });
  });
});

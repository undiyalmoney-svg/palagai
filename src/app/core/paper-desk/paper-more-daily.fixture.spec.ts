import { describe, expect, it } from 'vitest';
import { PAPER_MORE_DAILY } from './paper-more-daily.fixture';

describe('More daily profit + reverse on losers', () => {
  it('keeps a richer dummy tape after charges and does not call it a guarantee', () => {
    expect(PAPER_MORE_DAILY.guaranteed).toBe(false);
    expect(PAPER_MORE_DAILY.liveOrders).toBe(false);
    expect(PAPER_MORE_DAILY.armedOnCrudeBest).toBe(false);
    expect(PAPER_MORE_DAILY.quitJob).toBe(false);
    expect(PAPER_MORE_DAILY.keepTape).toBe(true);
    expect(PAPER_MORE_DAILY.richer.redDays).toBe(0);
    expect(PAPER_MORE_DAILY.richer.greenDays).toBeGreaterThan(PAPER_MORE_DAILY.current.greenDays);
    expect(PAPER_MORE_DAILY.richer.lateNetRs).toBeGreaterThan(PAPER_MORE_DAILY.current.lateNetRs);
    expect(PAPER_MORE_DAILY.lateLiftRs).toBeGreaterThan(0);
    expect(PAPER_MORE_DAILY.autopsy.wrong_direction).toBe(34);
    expect(PAPER_MORE_DAILY.autopsy.chop_both_lose).toBe(43);
    expect(PAPER_MORE_DAILY.champion.name).toBe('trend PDHL loser');
    expect(PAPER_MORE_DAILY.champion.keep).toBe(true);
    expect(PAPER_MORE_DAILY.champion.oosFlipRs).toBeGreaterThan(0);
    expect(PAPER_MORE_DAILY.honest).toMatch(/Not a guaranteed profit/);
    expect(PAPER_MORE_DAILY.honest).toMatch(/Not a salary/);
  });
});

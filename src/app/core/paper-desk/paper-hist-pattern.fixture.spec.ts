import { describe, expect, it } from 'vitest';
import { PAPER_HIST_PATTERN } from './paper-hist-pattern.fixture';

describe('Longer historical fail-pattern replay', () => {
  it('kills the against-VWAP flip and keeps structure-switch after charges', () => {
    expect(PAPER_HIST_PATTERN.guaranteed).toBe(false);
    expect(PAPER_HIST_PATTERN.liveOrders).toBe(false);
    expect(PAPER_HIST_PATTERN.armedOnCrudeBest).toBe(false);
    expect(PAPER_HIST_PATTERN.quitJob).toBe(false);
    expect(PAPER_HIST_PATTERN.flipFailed).toBe(true);
    expect(PAPER_HIST_PATTERN.lateLiftRs).toBeLessThan(0);
    expect(PAPER_HIST_PATTERN.structureBetter).toBe(true);
    expect(PAPER_HIST_PATTERN.champion.name).toBe('morning structure switch, do not flip');
    expect(PAPER_HIST_PATTERN.champion.keep).toBe(true);
    expect(PAPER_HIST_PATTERN.champion.lateNetRs).toBeGreaterThan(
      PAPER_HIST_PATTERN.champion.lateOrigRs,
    );
    expect(PAPER_HIST_PATTERN.champion.longBetter).toBe(4);
    expect(PAPER_HIST_PATTERN.worstWeekRs).toBeLessThan(0);
    expect(PAPER_HIST_PATTERN.redWeeks).toBeGreaterThan(0);
    expect(PAPER_HIST_PATTERN.honest).toMatch(/not a salary/i);
    expect(PAPER_HIST_PATTERN.honest).toMatch(/Not a guaranteed profit/);
    expect(PAPER_HIST_PATTERN.honest).toMatch(/do not flip/);
  });
});

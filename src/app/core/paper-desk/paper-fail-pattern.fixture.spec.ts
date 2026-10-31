import { describe, expect, it } from 'vitest';
import { PAPER_FAIL_PATTERN } from './paper-fail-pattern.fixture';

describe('Wrong-direction fail pattern', () => {
  it('keeps trend PDHL against VWAP and does not call it a guarantee', () => {
    expect(PAPER_FAIL_PATTERN.guaranteed).toBe(false);
    expect(PAPER_FAIL_PATTERN.liveOrders).toBe(false);
    expect(PAPER_FAIL_PATTERN.armedOnCrudeBest).toBe(false);
    expect(PAPER_FAIL_PATTERN.champion.name).toBe('trend PDHL + against VWAP');
    expect(PAPER_FAIL_PATTERN.champion.keep).toBe(true);
    expect(PAPER_FAIL_PATTERN.champion.n).toBe(8);
    expect(PAPER_FAIL_PATTERN.champion.oosLiftRs).toBe(1160);
    expect(PAPER_FAIL_PATTERN.champion.oosRuleNetRs).toBeGreaterThan(
      PAPER_FAIL_PATTERN.champion.oosOrigNetRs,
    );
    expect(PAPER_FAIL_PATTERN.slices.wrongStructure.trend).toBe(20);
    expect(PAPER_FAIL_PATTERN.honest).toMatch(/Not a guaranteed profit/);
  });
});

import { describe, expect, it } from 'vitest';
import { PAPER_REVERSE_FAIL } from './paper-reverse-fail.fixture';

describe('Reverse-engineering of failed tickets', () => {
  it('finds wrong-direction losers but does not arm a live flip', () => {
    expect(PAPER_REVERSE_FAIL.guaranteed).toBe(false);
    expect(PAPER_REVERSE_FAIL.liveOrders).toBe(false);
    expect(PAPER_REVERSE_FAIL.autopsy.wrongDirection).toBe(34);
    expect(PAPER_REVERSE_FAIL.autopsy.chopBothLose).toBe(43);
    expect(PAPER_REVERSE_FAIL.autopsy.origGreen).toBe(85);
    expect(PAPER_REVERSE_FAIL.flipGroups.length).toBe(0);
    expect(PAPER_REVERSE_FAIL.liveFlipOos.kept).toBe(false);
    expect(PAPER_REVERSE_FAIL.liveFlipOos.flipNetRs).toBeLessThan(
      PAPER_REVERSE_FAIL.liveFlipOos.origNetRs,
    );
    expect(PAPER_REVERSE_FAIL.honest).toMatch(/Not a guaranteed profit/);
  });
});

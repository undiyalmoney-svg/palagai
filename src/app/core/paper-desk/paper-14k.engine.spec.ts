import { describe, expect, it } from 'vitest';
import { PAPER_14K_BLOTTER } from './paper-14k-blotter.fixture';
import { PAPER_14K_BOOKS, clampPlayed, paperSnapshot } from './paper-14k.engine';

describe('Paper 14k dummy desk', () => {
  it('starts at ₹14,000, never goes live, and never claims a guarantee', () => {
    const idle = paperSnapshot(0);
    expect(idle.fundRs).toBe(14_000);
    expect(idle.played).toBe(0);
    expect(idle.liveOrders).toBe(false);
    expect(idle.guaranteed).toBe(false);
    expect(PAPER_14K_BLOTTER.liveOrders).toBe(false);
    expect(PAPER_14K_BLOTTER.guaranteed).toBe(false);
    expect(PAPER_14K_BLOTTER.minFundRs).toBe(14_000);
    expect(PAPER_14K_BLOTTER.redDays).toBe(0);
    expect(PAPER_14K_BLOTTER.skips.some((s) => s.skip === 'loss not allowed after charges')).toBe(
      true,
    );
    expect(PAPER_14K_BOOKS.map((b) => b.id)).toEqual(['crude', 'nifty', 'bank', 'sensex']);
  });

  it('stands down a loss-shaped morning and keeps the fund at ₹14,000', () => {
    const one = paperSnapshot(1);
    expect(one.lastDay).toBe('2026-05-27');
    expect(one.fundRs).toBe(14_000);
    expect(one.lastTone).toBe('flat');
    expect(one.lastStructure).toMatch(/crude/);
    expect(one.fills.length).toBe(0);
  });

  it('protects the dummy cash through the full tape and includes Crude in overall', () => {
    const all = paperSnapshot(999);
    expect(clampPlayed(999)).toBe(PAPER_14K_BLOTTER.sessions.length);
    expect(all.done).toBe(true);
    expect(all.fundRs).toBe(PAPER_14K_BLOTTER.endRs);
    expect(all.fundRs).toBeGreaterThan(0);
    expect(all.redDays).toBe(0);
    expect(all.slHits).toBe(0);
    expect(all.scratches).toBe(0);
    expect(Math.min(...all.sessions.map((s) => s.fundEnd))).toBe(14_000);
    expect(all.fills.every((f) => f.rs > 0)).toBe(true);
    expect(all.fills.every((f) => f.fundAfter >= 14_000)).toBe(true);
    const crude = all.bookScores.find((b) => b.id === 'crude');
    expect(crude?.fills).toBeGreaterThan(0);
    expect(crude?.netRs).toBe(6000);
    expect(all.bookScores.reduce((a, b) => a + b.netRs, 0)).toBeCloseTo(all.netRs, 5);
    expect(all.bookScores.map((b) => b.id)).toEqual(['crude', 'nifty', 'bank', 'sensex']);
  });
});

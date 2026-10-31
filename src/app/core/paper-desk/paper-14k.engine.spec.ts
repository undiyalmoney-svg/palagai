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
    expect(PAPER_14K_BLOTTER.minFundRs).toBeGreaterThan(0);
    expect(PAPER_14K_BLOTTER.skips.some((s) => s.skip === 'day-loss cap')).toBe(true);
    expect(PAPER_14K_BOOKS.map((b) => b.id)).toEqual(['crude', 'nifty', 'bank', 'sensex']);
  });

  it('plays one dummy session like a live day and marks the fund', () => {
    const one = paperSnapshot(1);
    expect(one.lastDay).toBe('2026-07-22');
    expect(one.fundRs).toBe(14_050);
    expect(one.lastFills.length).toBeGreaterThan(0);
    expect(one.tpHits).toBe(1);
    expect(one.scratches).toBe(1);
    expect(one.slHits).toBe(0);
  });

  it('protects the dummy cash through the full tape', () => {
    const all = paperSnapshot(999);
    expect(clampPlayed(999)).toBe(PAPER_14K_BLOTTER.sessions.length);
    expect(all.done).toBe(true);
    expect(all.fundRs).toBe(PAPER_14K_BLOTTER.endRs);
    expect(all.fundRs).toBeGreaterThan(0);
    expect(all.skipped).toBe(PAPER_14K_BLOTTER.skipped);
    expect(Math.min(...all.sessions.map((s) => s.fundEnd))).toBeGreaterThan(0);
    expect(all.fills.every((f) => f.fundAfter > 0)).toBe(true);
    const crude = all.bookScores.find((b) => b.id === 'crude');
    expect(crude?.fills).toBeGreaterThan(0);
    expect(crude?.netRs).toBe(7040);
    expect(all.bookScores.reduce((a, b) => a + b.netRs, 0)).toBe(all.netRs);
    expect(all.bookScores.map((b) => b.id)).toEqual(['crude', 'nifty', 'bank', 'sensex']);
  });
});

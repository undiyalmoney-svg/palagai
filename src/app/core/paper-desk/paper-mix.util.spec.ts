import { describe, expect, it } from 'vitest';
import { LIVE_PAPER_BOOKS, PAPER_SCALP_BOOKS } from './live-paper.engine';
import { mixGate, MIX_NEED, usesMix } from './paper-mix.util';

const nifty = (desk: string) => ({
  ...LIVE_PAPER_BOOKS.find((b) => b.id === `nifty-${desk}`)!,
  mix: true,
});

const bar = (min: number, close: number, open = close, day = '2026-11-05') => ({
  day,
  min,
  open,
  high: Math.max(open, close) + 2,
  low: Math.min(open, close) - 2,
  close,
});

describe('paper mix', () => {
  it('is off the historical Nifty pick and off Scalp', () => {
    expect(LIVE_PAPER_BOOKS.every((b) => !usesMix(b))).toBe(true);
    expect(PAPER_SCALP_BOOKS.every((b) => !usesMix(b))).toBe(true);
    expect(mixGate([], 0, PAPER_SCALP_BOOKS[0], { dir: -1, mode: 'vwap_fade' }, 'range').ok).toBe(true);
  });

  it('blocks a continuation that is already on the wrong side of VWAP', () => {
    const bars = [bar(9 * 60 + 15, 24000), bar(9 * 60 + 20, 24010), bar(10 * 60, 23970, 23990)];
    const gate = mixGate(bars, 2, nifty('pdhl'), { dir: 1, mode: 'pdhl' }, 'trend');
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/against VWAP/);
  });

  it('blocks a VWAP / trap fade on a trend morning — the 5 Nov mix fail', () => {
    const bars = [
      bar(9 * 60 + 15, 24420),
      bar(10 * 60, 24480),
      bar(12 * 60 + 50, 24540, 24560),
    ];
    const fade = mixGate(bars, 2, nifty('vwap'), { dir: -1, mode: 'vwap_fade' }, 'trend');
    expect(fade.ok).toBe(false);
    expect(fade.reason).toMatch(/no fade on trend day/);
    expect(mixGate(bars, 2, nifty('trap'), { dir: -1, mode: 'trap' }, 'trend').ok).toBe(false);
  });

  it('lets a with-VWAP continuation through when the score reaches 4', () => {
    const bars = [bar(9 * 60 + 15, 24000), bar(9 * 60 + 20, 24005), bar(10 * 60, 24040, 24020)];
    const gate = mixGate(bars, 2, nifty('momentum'), { dir: 1, mode: 'momentum' }, 'trend');
    expect(gate.score).toBeGreaterThanOrEqual(MIX_NEED);
    expect(gate.ok).toBe(true);
    expect(gate.bits).toContain('with-vwap');
  });

  it('lets a range fade through when it is stretched away from VWAP', () => {
    const bars = [bar(9 * 60 + 15, 24000), bar(10 * 60, 24002), bar(12 * 60 + 50, 24040, 24050)];
    const gate = mixGate(bars, 2, nifty('vwap'), { dir: -1, mode: 'vwap_fade' }, 'range');
    expect(gate.ok).toBe(true);
    expect(gate.bits).toContain('stretch-vwap');
  });
});

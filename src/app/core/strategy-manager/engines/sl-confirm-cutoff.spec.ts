import { describe, expect, it } from 'vitest';
import { applySlConfirmCutoff } from './index-rule.engine';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { ManagedOpenPosition } from '../models/strategy-module.interface';

function settings() {
  return defaultStrategySettings({
    extras: {
      slConfirmCutoffEnabled: true,
      slConfirmCutoffFracR: 0.55,
      slConfirmCutoffMaxMfeR: 0.25,
      slConfirmSoftRs: 800,
    },
  });
}

describe('applySlConfirmCutoff (tighter loser-only)', () => {
  it('cuts never-green loser at 0.55R with adverse confirm close', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 100,
      stop: 90,
      target: 130,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 1,
      initialRiskPts: 10,
    };
    // MAE 6 = 0.6R >= 0.55R
    const candle = {
      date: '2026-07-28T10:20:00+05:30',
      open: 95,
      high: 95.2,
      low: 94,
      close: 94.2,
      volume: 0,
    };
    const hit = applySlConfirmCutoff(candle, open, settings(), 'NIFTY 50');
    expect(hit?.reason).toBe('SL cutoff — confirmed adverse');
    expect(hit?.exitPrice).toBe(94.2);
  });

  it('cuts on soft ₹800 adverse when never-green (Nifty)', () => {
    // risk 28 pts; 0.55R = 15.4 pts; soft ₹800 ≈ 12.3 pts → soft fires first
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24972,
      target: 25098,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 2,
      initialRiskPts: 28,
    };
    const candle = {
      date: '2026-07-28T10:20:00+05:30',
      open: 24990,
      high: 24991,
      low: 24987, // MAE 13 pts ≈ ₹845 (>=800 soft, <15.4 frac)
      close: 24988,
      volume: 0,
    };
    const hit = applySlConfirmCutoff(candle, open, settings(), 'NIFTY 50');
    expect(hit?.reason).toBe('SL cutoff — soft ₹ adverse');
  });

  it('does not cut winners that dipped near SL', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 100,
      stop: 90,
      target: 130,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 5,
      initialRiskPts: 10,
    };
    const candle = {
      date: '2026-07-28T10:20:00+05:30',
      open: 94,
      high: 94.5,
      low: 92,
      close: 92.5,
      volume: 0,
    };
    expect(applySlConfirmCutoff(candle, open, settings(), 'NIFTY 50')).toBeNull();
  });
});

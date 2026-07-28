import { describe, expect, it } from 'vitest';
import { applySlConfirmCutoff } from './index-rule.engine';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { ManagedOpenPosition } from '../models/strategy-module.interface';

function settings() {
  return defaultStrategySettings({
    extras: {
      slConfirmCutoffEnabled: true,
      slConfirmCutoffFracR: 0.7,
      slConfirmCutoffMaxMfeR: 0.25,
    },
  });
}

describe('applySlConfirmCutoff (research loser-only)', () => {
  it('cuts never-green loser at 0.7R with adverse confirm close', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 100,
      stop: 90,
      target: 130,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 1, // < 0.25*10
      initialRiskPts: 10,
    };
    const candle = {
      date: '2026-07-28T10:20:00+05:30',
      open: 94,
      high: 94.5,
      low: 92, // MAE 8 = 0.8R
      close: 92.5, // against + adverse body
      volume: 0,
    };
    const hit = applySlConfirmCutoff(candle, open, settings());
    expect(hit?.reason).toBe('SL cutoff — confirmed adverse');
    expect(hit?.exitPrice).toBe(92.5);
  });

  it('does not cut winners that dipped near SL (MFE already green)', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 100,
      stop: 90,
      target: 130,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 5, // 0.5R > 0.25R max
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
    expect(applySlConfirmCutoff(candle, open, settings())).toBeNull();
  });

  it('does not cut without adverse confirm body (strict near-SL rejected by research)', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 100,
      stop: 90,
      target: 130,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 0,
      initialRiskPts: 10,
    };
    const candle = {
      date: '2026-07-28T10:20:00+05:30',
      open: 92,
      high: 93,
      low: 91,
      close: 92.8, // green body — no confirm
      volume: 0,
    };
    expect(applySlConfirmCutoff(candle, open, settings())).toBeNull();
  });
});

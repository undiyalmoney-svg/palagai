import { describe, expect, it } from 'vitest';
import { Candle } from '../../models/candle.model';
import { defaultStrategySettings } from '../models/strategy-settings.model';
import { ManagedOpenPosition } from '../models/strategy-module.interface';
import {
  armTrapProfitDrainFloor,
  srTrapExitLogic,
} from './sr-trap-confirm.engine';

function bar(
  partial: Partial<Candle> & Pick<Candle, 'open' | 'high' | 'low' | 'close'>,
): Candle {
  return {
    date: partial.date ?? '2026-07-28T10:00:00+05:30',
    open: partial.open,
    high: partial.high,
    low: partial.low,
    close: partial.close,
    volume: partial.volume ?? 0,
  };
}

function niftySettings() {
  return defaultStrategySettings({
    exitTime: '15:15',
    targetRMultiple: 3.5,
    profitProtectEnabled: true,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
    extras: { profitLockArmRs: 1000, profitLockLockRs: 500 },
  });
}

function ctx(instrumentId = 'NIFTY 50') {
  return {
    instrumentId,
    candle5m: bar({ open: 100, high: 100, low: 100, close: 100 }),
    previous5m: [],
  } as Parameters<typeof srTrapExitLogic>[4];
}

describe('Trap profit drain floor', () => {
  it('does not arm before ~₹1000 MFE (Nifty ≈15.4 pts)', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 0,
    };
    const candle = bar({ open: 25005, high: 25010, low: 25000, close: 25008 });
    expect(armTrapProfitDrainFloor(candle, open, niftySettings(), 'NIFTY 50')).toBe(false);
    expect(open.stop).toBe(24980);
  });

  it('arms ₹500 lock floor once peak MFE ≥ ₹1000 and remembers peak across bars', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 0,
    };
    // ₹1400 MFE ≈ 21.5 pts
    const run = bar({ open: 25010, high: 25022, low: 25008, close: 25018 });
    expect(armTrapProfitDrainFloor(run, open, niftySettings(), 'NIFTY 50')).toBe(true);
    expect(open.stop).toBeCloseTo(25000 + 500 / 65, 5);
    expect(open.peakMfePts).toBeGreaterThanOrEqual(21);

    const pullback = bar({
      date: '2026-07-28T10:05:00+05:30',
      open: 25010,
      high: 25012,
      low: 25005,
      close: 25006,
    });
    expect(armTrapProfitDrainFloor(pullback, open, niftySettings(), 'NIFTY 50')).toBe(true);
    expect(open.stop).toBeCloseTo(25000 + 500 / 65, 5);
  });

  it('exits at ₹500 lock (not ₹0) when profit drains after a ₹1k+ run', () => {
    const lockPts = 500 / 65;
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 22, // prior bar already printed ~₹1430
    };
    // Drains through the lock toward a loss — must book ~₹500, not ride to −₹325
    const drain = bar({
      date: '2026-07-28T10:20:00+05:30',
      open: 25005,
      high: 25006,
      low: 24995,
      close: 24995,
    });
    const exit = srTrapExitLogic(drain, open, [25000, 25018, 24995], niftySettings(), ctx());
    expect(exit).not.toBeNull();
    expect(exit!.reason).toBe('Profit drained — cut & rehunt');
    expect(exit!.exitPrice).toBeCloseTo(25000 + lockPts, 5);
    expect(open.stop).toBeCloseTo(25000 + lockPts, 5);
  });

  it('SELL: same drain→rehunt after Bank ~₹1000 peak locks ₹500', () => {
    const open: ManagedOpenPosition = {
      direction: 'SELL',
      entry: 52000,
      stop: 52040,
      target: 51860,
      entryTime: '2026-07-28T11:00:00+05:30',
      peakMfePts: 0,
    };
    const settings = defaultStrategySettings({
      exitTime: '15:15',
      targetRMultiple: 3.5,
      profitProtectEnabled: true,
      profitProtectArmR: 1,
      profitProtectLockR: 0,
      extras: { profitLockArmRs: 1000, profitLockLockRs: 500 },
    });
    const lockPts = 500 / 30;
    // Bank ₹/pt = 30 → arm ≈ 33.3 pts. Peak 35 pts = ₹1050
    const run = bar({ open: 51980, high: 51990, low: 51965, close: 51970 });
    expect(armTrapProfitDrainFloor(run, open, settings, 'NIFTY BANK')).toBe(true);
    expect(open.stop).toBeCloseTo(52000 - lockPts, 5);

    const drain = bar({
      date: '2026-07-28T11:15:00+05:30',
      open: 51990,
      high: 52010,
      low: 51985,
      close: 52008,
    });
    const exit = srTrapExitLogic(
      drain,
      open,
      [52000, 51970, 52008],
      settings,
      ctx('NIFTY BANK'),
    );
    expect(exit?.reason).toBe('Profit drained — cut & rehunt');
    expect(exit?.exitPrice).toBeCloseTo(52000 - lockPts, 5);
  });
});

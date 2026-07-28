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
    extras: {
      profitLockArmRs: 1000,
      profitLockLockRs: 500,
      profitLockGivebackRs: 500,
    },
  });
}

function ctx(instrumentId = 'NIFTY 50') {
  return {
    instrumentId,
    candle5m: bar({ open: 100, high: 100, low: 100, close: 100 }),
    previous5m: [],
  } as Parameters<typeof srTrapExitLogic>[4];
}

describe('Trap peak-trail drain (not wait until ₹0)', () => {
  it('does not arm before ~₹1000 MFE', () => {
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

  it('peak ₹1400 → trail floor ~₹900 (not ₹0 or only ₹500)', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 0,
    };
    // 1400/65 ≈ 21.538 pts
    const run = bar({ open: 25010, high: 25000 + 1400 / 65, low: 25008, close: 25018 });
    expect(armTrapProfitDrainFloor(run, open, niftySettings(), 'NIFTY 50')).toBe(true);
    // floor = max(500, 1400-500) = 900
    expect(open.stop).toBeCloseTo(25000 + 900 / 65, 5);
  });

  it('cuts at ~₹900 trail when +1400 starts draining — does not wait for flat', () => {
    const floorPts = 900 / 65;
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 1400 / 65,
    };
    // Bar trades through the ₹900 floor toward flat — must exit at trail, not ₹0
    const drain = bar({
      date: '2026-07-28T10:20:00+05:30',
      open: 25015,
      high: 25016,
      low: 25000 + floorPts - 1,
      close: 25005,
    });
    const exit = srTrapExitLogic(drain, open, [25000, 25018, 25005], niftySettings(), ctx());
    expect(exit).not.toBeNull();
    expect(exit!.reason).toBe('Profit drained — cut & rehunt');
    expect(exit!.exitPrice).toBeCloseTo(25000 + floorPts, 5);
    // Booked ~₹900, not ₹0
    const bookedRs = (exit!.exitPrice - open.entry) * 65;
    expect(bookedRs).toBeCloseTo(900, 0);
  });

  it('SELL Bank: peak trail locks peak−giveback', () => {
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
      extras: {
        profitLockArmRs: 1000,
        profitLockLockRs: 500,
        profitLockGivebackRs: 500,
      },
    });
    // Peak 45 pts = ₹1350 → floor max(500, 1350-500)=850 → 850/30 pts
    const peakPts = 45;
    const run = bar({ open: 51980, high: 51990, low: 52000 - peakPts, close: 51970 });
    expect(armTrapProfitDrainFloor(run, open, settings, 'NIFTY BANK')).toBe(true);
    expect(open.stop).toBeCloseTo(52000 - 850 / 30, 5);
  });
});

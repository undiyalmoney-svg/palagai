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
      profitLockArmRs: 600,
      profitLockLockRs: 300,
      profitLockGivebackRs: 300,
      slConfirmCutoffEnabled: true,
      slConfirmCutoffFracR: 0.55,
      slConfirmCutoffMaxMfeR: 0.75,
      slConfirmSoftRs: 700,
    },
  });
}

function ctx(instrumentId = 'NIFTY 50') {
  return {
    instrumentId,
    candle5m: bar({ open: 100, high: 100, low: 100, close: 100 }),
    previous5m: [],
  } as unknown as Parameters<typeof srTrapExitLogic>[4];
}

describe('Trap peak-trail drain (arm ₹600 / giveback ₹300)', () => {
  it('does not arm before ~₹600 MFE', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 0,
    };
    // ~₹520 peak — below arm
    const candle = bar({ open: 25005, high: 25000 + 520 / 65, low: 25000, close: 25008 });
    expect(armTrapProfitDrainFloor(candle, open, niftySettings(), 'NIFTY 50')).toBe(false);
    expect(open.stop).toBe(24980);
  });

  it('peak ₹900 → trail floor ~₹600 (not wait until ₹0)', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 0,
    };
    // 900/65 ≈ 13.846 pts
    const run = bar({ open: 25010, high: 25000 + 900 / 65, low: 25008, close: 25012 });
    expect(armTrapProfitDrainFloor(run, open, niftySettings(), 'NIFTY 50')).toBe(true);
    // floor = max(300, 900-300) = 600
    expect(open.stop).toBeCloseTo(25000 + 600 / 65, 5);
  });

  it('cuts at ~₹600 trail when +900 starts draining — does not wait for flat', () => {
    const floorPts = 600 / 65;
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 900 / 65,
    };
    const drain = bar({
      date: '2026-07-28T10:20:00+05:30',
      open: 25012,
      high: 25013,
      low: 25000 + floorPts - 1,
      close: 25005,
    });
    const exit = srTrapExitLogic(drain, open, [25000, 25014, 25005], niftySettings(), ctx());
    expect(exit).not.toBeNull();
    expect(exit!.reason).toBe('Profit drained — cut & rehunt');
    expect(exit!.exitPrice).toBeCloseTo(25000 + floorPts, 5);
    const bookedRs = (exit!.exitPrice - open.entry) * 65;
    expect(bookedRs).toBeCloseTo(600, 0);
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
        profitLockArmRs: 600,
        profitLockLockRs: 300,
        profitLockGivebackRs: 300,
      },
    });
    // Peak 30 pts = ₹900 → floor max(300, 900-300)=600 → 600/30 pts
    const peakPts = 30;
    const run = bar({ open: 51980, high: 51990, low: 52000 - peakPts, close: 51970 });
    expect(armTrapProfitDrainFloor(run, open, settings, 'NIFTY BANK')).toBe(true);
    expect(open.stop).toBeCloseTo(52000 - 600 / 30, 5);
  });

  it('does not index-arm when option marks are known (option-native trail)', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 0,
      optionPeakMfeRs: 650,
    };
    const candle = bar({ open: 25010, high: 25000 + 900 / 65, low: 25008, close: 25012 });
    // Index trail stays off — option path owns drain exits.
    expect(armTrapProfitDrainFloor(candle, open, niftySettings(), 'NIFTY 50')).toBe(false);
    expect(open.stop).toBe(24980);
  });

  it('option-native drain exits at option floor premium', () => {
    const open: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 0,
      optionPeakMfeRs: 200,
      optionEntryPremium: 100,
      optionBarLow: 102.3, // ≈ 100 + 150/65
      optionLotUnits: 65,
      lotsMultiplier: 1,
    };
    const settings = defaultStrategySettings({
      exitTime: '15:15',
      targetRMultiple: 3.5,
      extras: {
        profitLockArmRs: 100,
        profitLockLockRs: 50,
        profitLockGivebackRs: 50,
        slConfirmCutoffEnabled: false,
      },
    });
    const candle = bar({
      date: '2026-07-28T10:20:00+05:30',
      open: 25010,
      high: 25012,
      low: 25005,
      close: 25008,
    });
    const exit = srTrapExitLogic(candle, open, [25000, 25014, 25008], settings, ctx());
    expect(exit).not.toBeNull();
    expect(exit!.reason).toBe('Profit drained — cut & rehunt');
    expect(exit!.optionExitPremium).toBeCloseTo(102.3, 1);
  });

  it('multi-lot does not drain on 1-lot MFE — trail scales with lots', () => {
    const settings = defaultStrategySettings({
      exitTime: '15:15',
      targetRMultiple: 3.5,
      extras: {
        profitLockArmRs: 100,
        profitLockLockRs: 50,
        profitLockGivebackRs: 50,
        slConfirmCutoffEnabled: false,
      },
    });
    const candle = bar({
      date: '2026-07-28T10:20:00+05:30',
      open: 25010,
      high: 25012,
      low: 25005,
      close: 25008,
    });
    // Same premium path as 1-lot winner, but 2 lots → MFE ₹200 arms only after scale.
    const early: ManagedOpenPosition = {
      direction: 'BUY',
      entry: 25000,
      stop: 24980,
      target: 25070,
      entryTime: '2026-07-28T10:00:00+05:30',
      peakMfePts: 0,
      optionPeakMfeRs: 100,
      optionEntryPremium: 100,
      optionBarLow: 99,
      optionLotUnits: 130,
      lotsMultiplier: 2,
    };
    expect(srTrapExitLogic(candle, early, [25000, 25014, 25008], settings, ctx())).toBeNull();

    const armed: ManagedOpenPosition = {
      ...early,
      optionPeakMfeRs: 400,
      // floor = max(100, 400-100)=300 → floorPrem = 100 + 300/130 ≈ 102.31
      optionBarLow: 102.3,
    };
    const exit = srTrapExitLogic(candle, armed, [25000, 25014, 25008], settings, ctx());
    expect(exit?.reason).toBe('Profit drained — cut & rehunt');
    expect(exit?.optionExitPremium).toBeCloseTo(100 + 300 / 130, 1);
  });
});

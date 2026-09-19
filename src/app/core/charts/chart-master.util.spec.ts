import { describe, expect, it } from 'vitest';
import { Candle } from '../models/candle.model';
import { ChartStructure } from './chart-structure.util';
import {
  buildMasterGuide,
  classifyMasterBias,
  masterAllowsBox,
  masterDriveBarCount,
  masterReadyIndex,
  replayMasterTrades,
} from './chart-master.util';

function bar(hm: string, o: number, h: number, l: number, c: number): Candle {
  return { date: `2026-07-08T${hm}:00+05:30`, open: o, high: h, low: l, close: c, volume: 0 };
}

function box(patch: Partial<ChartStructure> = {}): ChartStructure {
  return {
    dir: 1,
    option: 'CE',
    wall: 100,
    height: 10,
    sl: 90,
    entry: 100,
    exit: 110,
    pink: { lo: 90, hi: 100, fromIndex: 0, toIndex: 6 },
    teal: { lo: 100, hi: 110, fromIndex: 0, toIndex: 6 },
    breakIndex: 4,
    fromIndex: 0,
    toIndex: 6,
    date: '2026-07-08T10:15:00+05:30',
    status: 'live',
    fresh: false,
    ...patch,
  };
}

describe('Charts Master', () => {
  it('needs three 15m bars (45 minutes) before it calls the day', () => {
    expect(masterDriveBarCount(15)).toBe(3);
    expect(masterDriveBarCount(5)).toBe(9);
    const early = [bar('09:15', 100, 101, 99, 100), bar('09:30', 100, 102, 99, 101)];
    expect(classifyMasterBias(early, '2026-07-08', 15, 10).bias).toBe('wait');
    expect(masterReadyIndex(early, '2026-07-08', 15)).toBe(-1);
  });

  it('calls an up day when the open drive closes near the high', () => {
    const candles = [
      bar('09:15', 100, 103, 99, 102),
      bar('09:30', 102, 106, 101, 105),
      bar('09:45', 105, 110, 104, 109),
    ];
    const call = classifyMasterBias(candles, '2026-07-08', 15, 8);
    expect(call.ready).toBe(true);
    expect(call.bias).toBe('up');
  });

  it('calls a down day when the open drive closes near the low', () => {
    const candles = [
      bar('09:15', 110, 111, 107, 108),
      bar('09:30', 108, 109, 104, 105),
      bar('09:45', 105, 106, 100, 101),
    ];
    expect(classifyMasterBias(candles, '2026-07-08', 15, 8).bias).toBe('down');
  });

  it('stands down when the open is a mid-range chop', () => {
    const candles = [
      bar('09:15', 100, 102, 98, 101),
      bar('09:30', 101, 103, 99, 100),
      bar('09:45', 100, 102, 98, 101),
    ];
    expect(classifyMasterBias(candles, '2026-07-08', 15, 8).bias).toBe('chop');
  });

  it('only keeps with-trend breaks after the drive, and stops after a failed break', () => {
    const candles = [
      bar('09:15', 100, 103, 99, 102),
      bar('09:30', 102, 106, 101, 105),
      bar('09:45', 105, 110, 104, 109),
      bar('10:00', 109, 109, 108, 108),
      bar('10:15', 108, 114, 107, 113),
      bar('10:30', 113, 114, 89, 90),
      bar('10:45', 90, 120, 90, 118),
    ];
    const tooEarly = box({
      breakIndex: 2,
      date: '2026-07-08T09:45:00+05:30',
      status: 'hit_exit',
    });
    const pe = box({
      dir: -1,
      option: 'PE',
      breakIndex: 3,
      date: '2026-07-08T10:00:00+05:30',
      sl: 110,
      exit: 90,
    });
    const win = box({
      breakIndex: 4,
      date: '2026-07-08T10:15:00+05:30',
      status: 'hit_exit',
      entry: 108,
      sl: 98,
      exit: 118,
      height: 10,
    });
    const fail = box({
      breakIndex: 5,
      date: '2026-07-08T10:30:00+05:30',
      status: 'hit_sl',
      entry: 113,
      sl: 90,
      exit: 136,
      height: 23,
    });
    const later = box({
      breakIndex: 6,
      date: '2026-07-08T10:45:00+05:30',
      status: 'hit_exit',
      entry: 90,
      sl: 80,
      exit: 100,
    });
    const taken = replayMasterTrades(
      [tooEarly, pe, win, fail, later],
      candles,
      '2026-07-08',
      15,
      8,
    );
    expect(taken.map((b) => b.breakIndex)).toEqual([4, 5]);
    expect(masterAllowsBox(buildMasterGuide('2026-07-08', {
      crude: {
        book: 'crude',
        label: 'Crude Oil',
        bias: 'chop',
        action: 'stand_down',
        reason: 'x',
        ready: true,
      },
      nifty: {
        book: 'nifty',
        label: 'Nifty',
        bias: 'up',
        action: 'buy_ce',
        reason: 'x',
        ready: true,
      },
      bank: {
        book: 'bank',
        label: 'Bank Nifty',
        bias: 'up',
        action: 'buy_ce',
        reason: 'x',
        ready: true,
      },
    }).books.nifty, win)).toBe(true);
  });

  it('writes a headline that names which books to trade', () => {
    const guide = buildMasterGuide('2026-07-08', {
      crude: {
        book: 'crude',
        label: 'Crude Oil',
        bias: 'chop',
        action: 'stand_down',
        reason: 'Open drive is mid-range.',
        ready: true,
      },
      nifty: {
        book: 'nifty',
        label: 'Nifty',
        bias: 'up',
        action: 'buy_ce',
        reason: 'Open drive closed near the high.',
        ready: true,
      },
      bank: {
        book: 'bank',
        label: 'Bank Nifty',
        bias: 'up',
        action: 'buy_ce',
        reason: 'Open drive closed near the high.',
        ready: true,
      },
    });
    expect(guide.headline).toContain('Buy CE');
    expect(guide.headline).toContain('Skip Crude Oil');
  });
});

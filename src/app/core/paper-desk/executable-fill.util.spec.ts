import { describe, expect, it } from 'vitest';
import {
  buildBarIndex,
  executableFill,
  isRestingExit,
  repriceTradesToExecutableFills,
} from './executable-fill.util';
import { PaperTrade } from './paper-desk.models';
import { Candle } from '../models/candle.model';

function bar(date: string, o: number, h: number, l: number, c: number): Candle {
  return { date, open: o, high: h, low: l, close: c, volume: 1 };
}

/** 10:00 … 10:20, five-minute bars. */
const series: Candle[] = [
  bar('10:00', 100, 110, 99, 108),
  bar('10:05', 109, 120, 108, 118),
  bar('10:10', 117, 125, 116, 124),
  bar('10:15', 123, 130, 122, 129),
];
const idx = buildBarIndex(series);

function trade(p: Partial<PaperTrade>): PaperTrade {
  return {
    id: 't',
    instrumentId: 'nifty-50',
    instrumentName: 'Nifty 50',
    direction: 'BUY',
    indexEntry: 108,
    indexStop: 100,
    indexTarget: 130,
    indexExit: 118,
    indexPoints: 10,
    entryTime: '10:00',
    exitTime: '10:05',
    exitReason: 'Profit drained — cut & rehunt',
    option: null,
    optionEntryPremium: null,
    optionExitPremium: null,
    optionPnlRs: null,
    premiumEstimated: true,
    outcome: 'WIN',
    ...p,
  };
}

describe('isRestingExit', () => {
  it('stop and target rest at the exchange', () => {
    expect(isRestingExit('Stop loss hit')).toBe(true);
    expect(isRestingExit('Target hit')).toBe(true);
  });

  it('anything the desk decides does not', () => {
    expect(isRestingExit('Profit drained — cut & rehunt')).toBe(false);
    expect(isRestingExit('EMA-20 exit')).toBe(false);
  });
});

describe('executableFill', () => {
  it('enters at the open after the signal bar, exits at the open after the exit bar', () => {
    const f = executableFill(trade({}), idx, series);
    // signal 10:00 → fill 10:05 open 109; decided exit 10:05 → fill 10:10 open 117
    expect(f.entryPrice).toBe(109);
    expect(f.exitPrice).toBe(117);
    expect(f.indexPoints).toBe(8);
  });

  it('a resting stop still fills intrabar at its level', () => {
    const f = executableFill(
      trade({ exitReason: 'Stop loss hit', exitTime: '10:10', indexExit: 100 }),
      idx,
      series,
    );
    expect(f.entryPrice).toBe(109);
    expect(f.exitPrice).toBe(100);
    expect(f.indexPoints).toBe(-9);
  });

  it('drops a decided exit that lands on our entry bar — nothing to hold', () => {
    const f = executableFill(trade({ entryTime: '10:00', exitTime: '10:00' }), idx, series);
    expect(f.indexPoints).toBeNull();
  });

  it('drops a trade with no bar left to fill on', () => {
    const f = executableFill(trade({ entryTime: '10:15', exitTime: '10:15' }), idx, series);
    expect(f.indexPoints).toBeNull();
  });

  it('reverses correctly for a SELL', () => {
    const f = executableFill(trade({ direction: 'SELL' }), idx, series);
    // in 109, out 117, short → -8
    expect(f.indexPoints).toBe(-8);
  });
});

describe('repriceTradesToExecutableFills', () => {
  const byInstrument = new Map([['nifty-50', series]]);

  it('keeps the modelled points for reference and scales option money', () => {
    const [out] = repriceTradesToExecutableFills(
      [trade({ optionPnlRs: 1000, netOptionPnlRs: 950 })],
      byInstrument,
    );
    expect(out!.modelledIndexPoints).toBe(10);
    expect(out!.indexPoints).toBe(8);
    expect(out!.optionPnlRs).toBeCloseTo(800, 6);
    expect(out!.netOptionPnlRs).toBeCloseTo(760, 6);
  });

  it('REGRESSION: a modelled winner that is unreachable is not reported as a fill', () => {
    const out = repriceTradesToExecutableFills(
      [trade({ entryTime: '10:15', exitTime: '10:15', indexPoints: 50 })],
      byInstrument,
    );
    expect(out).toEqual([]);
  });

  it('leaves trades alone when the series is unknown', () => {
    const t = trade({ instrumentId: 'crude-oil-mini' });
    const out = repriceTradesToExecutableFills([t], byInstrument);
    expect(out).toEqual([t]);
  });

  it('flips outcome when a modelled winner is really a loser', () => {
    const [out] = repriceTradesToExecutableFills(
      [trade({ direction: 'SELL', outcome: 'WIN' })],
      byInstrument,
    );
    expect(out!.outcome).toBe('LOSS');
  });
});

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
  it('stop, target, and peak-trail drain rest at the exchange (SL-M)', () => {
    expect(isRestingExit('Stop loss hit')).toBe(true);
    expect(isRestingExit('Target hit')).toBe(true);
    expect(isRestingExit('Profit drained — cut & rehunt')).toBe(true);
  });

  it('desk-decided soft exits do not rest', () => {
    expect(isRestingExit('EMA-20 exit')).toBe(false);
    expect(isRestingExit('Session exit')).toBe(false);
  });
});

describe('executableFill', () => {
  it('peak-trail drain fills at the trail level (resting SL-M), not next open', () => {
    const f = executableFill(
      trade({
        exitReason: 'Profit drained — cut & rehunt',
        exitTime: '10:05',
        indexExit: 118,
        indexPoints: 10,
      }),
      idx,
      series,
    );
    // signal 10:00 → fill 10:05 open 109; trail SL fills intrabar at 118
    expect(f.entryPrice).toBe(109);
    expect(f.exitPrice).toBe(118);
    expect(f.indexPoints).toBe(9);
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

  it('drops when resting exit is before we could enter', () => {
    const f = executableFill(
      trade({ entryTime: '10:00', exitTime: '10:00', exitReason: 'Stop loss hit' }),
      idx,
      series,
    );
    expect(f.indexPoints).toBeNull();
  });

  it('drops a trade with no bar left to enter on', () => {
    const f = executableFill(
      trade({
        entryTime: '10:15',
        exitTime: '10:15',
        exitReason: 'EMA-20 exit',
      }),
      idx,
      series,
    );
    expect(f.indexPoints).toBeNull();
  });

  it('SELL trail drain: entry next open, exit at resting trail level', () => {
    const f = executableFill(
      trade({
        direction: 'SELL',
        indexExit: 112,
        exitReason: 'Profit drained — cut & rehunt',
      }),
      idx,
      series,
    );
    expect(f.entryPrice).toBe(109);
    expect(f.exitPrice).toBe(112);
    expect(f.indexPoints).toBe(-3);
  });

  it('desk-decided exit still uses next-bar open', () => {
    const f = executableFill(
      trade({
        exitReason: 'EMA-20 exit',
        exitTime: '10:05',
        indexExit: 118,
      }),
      idx,
      series,
    );
    expect(f.entryPrice).toBe(109);
    expect(f.exitPrice).toBe(117);
    expect(f.indexPoints).toBe(8);
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
    // trail resting: entry 109 → exit 118 → +9
    expect(out!.indexPoints).toBe(9);
    expect(out!.optionPnlRs).toBeCloseTo(900, 6);
    expect(out!.netOptionPnlRs).toBeCloseTo(855, 6);
  });

  it('REGRESSION: a modelled winner that is unreachable is not reported as a fill', () => {
    const out = repriceTradesToExecutableFills(
      [
        trade({
          entryTime: '10:15',
          exitTime: '10:15',
          indexPoints: 50,
          exitReason: 'EMA-20 exit',
        }),
      ],
      byInstrument,
    );
    expect(out).toEqual([]);
  });

  it('leaves trades alone when the series is unknown', () => {
    const t = trade({ instrumentId: 'crude-oil-mini' });
    const out = repriceTradesToExecutableFills([t], byInstrument);
    expect(out).toEqual([t]);
  });

  it('REGRESSION Aug7 −₹33: peak-trail must not flip via next-open', () => {
    // Old bug: profit-drained treated as decided → exit next open → false red.
    const [out] = repriceTradesToExecutableFills(
      [
        trade({
          direction: 'SELL',
          indexEntry: 120,
          indexExit: 110,
          indexPoints: 10,
          entryTime: '10:00',
          exitTime: '10:05',
          exitReason: 'Profit drained — cut & rehunt',
          outcome: 'WIN',
          optionPnlRs: 500,
        }),
      ],
      byInstrument,
    );
    expect(out).toBeTruthy();
    expect(out!.indexExit).toBe(110);
    // Must NOT use 10:10 open 117 as exit (that painted false option losses).
    expect(out!.indexExit).not.toBe(117);
  });

  it('does not scale real option OHLC money by the index entry-lag ratio', () => {
    const [out] = repriceTradesToExecutableFills(
      [
        trade({
          premiumEstimated: false,
          optionPnlRs: 216,
          netOptionPnlRs: 200,
          indexPoints: 10,
        }),
      ],
      byInstrument,
    );
    // Index still repriced (entry lag), but real option ₹ stays as measured.
    expect(out!.indexPoints).toBe(9);
    expect(out!.optionPnlRs).toBe(216);
    expect(out!.netOptionPnlRs).toBe(200);
    expect(out!.moneyOutcome).toBe('WIN');
  });
});

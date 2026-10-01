import { Candle } from '../models/candle.model';
import { SmcAnalysis, SmcLiquidity, SmcStructureEvent, SmcTrade } from './smc/smc.types';
import {
  lastBos,
  lastCompactFvgs,
  pathwayInducement,
  pathwayLevels,
  pathwayPaintModel,
  pathwayZones,
  sessionRange,
} from './pathway-overlay';

function bar(date: string, high: number, low: number, close = high): Candle {
  return { date, open: close, high, low, close, volume: 1 };
}

function analysis(partial: Partial<SmcAnalysis>): SmcAnalysis {
  return {
    market: 'nifty',
    bars: 10,
    config: {} as SmcAnalysis['config'],
    swings: [],
    structure: [],
    orderBlocks: [],
    fvgs: [],
    liquidity: [],
    equalLevels: [],
    range: null,
    trades: [],
    signals: [],
    setups: { BUY: null, SELL: null },
    alerts: [],
    snapshot: {} as SmcAnalysis['snapshot'],
    stats: {} as SmcAnalysis['stats'],
    preview: null,
    htfAvailable: true,
    ...partial,
  };
}

describe('pathway overlay', () => {
  it('reads Day High / Day Low from the current session only', () => {
    const candles = [
      bar('2026-09-29T15:20:00', 100, 90),
      bar('2026-09-30T09:15:00', 110, 95),
      bar('2026-09-30T09:16:00', 108, 92),
      bar('2026-09-30T09:17:00', 120, 100),
    ];
    expect(sessionRange(candles)).toEqual({
      day: '2026-09-30',
      high: 120,
      low: 92,
      highIndex: 3,
      lowIndex: 2,
    });
  });

  it('places PE halfway from SL to TG on a live short', () => {
    const trade = {
      sl: 100,
      slNow: 100,
      tpFinal: 80,
      side: 'SELL',
    } as SmcTrade;
    expect(pathwayLevels(null, null, trade)).toEqual({
      sl: 100,
      pe: 90,
      tg: 80,
      side: 'SELL',
      fromTrade: true,
    });
  });

  it('plans SL / PE / TG from a bearish BOS down to Day Low', () => {
    const bos = { kind: 'BOS', dir: 'bear', level: 250, index: 4 } as SmcStructureEvent;
    const levels = pathwayLevels(analysis({ structure: [bos] }), {
      day: '2026-09-30',
      high: 260,
      low: 200,
      highIndex: 2,
      lowIndex: 8,
    }, null);
    expect(levels).toEqual({
      sl: 250,
      pe: 225,
      tg: 200,
      side: 'SELL',
      fromTrade: false,
    });
  });

  it('labels the swept stop-hunt before the last BOS as HTF IDM', () => {
    const bos = { kind: 'BOS', dir: 'bull', level: 100, index: 8 } as SmcStructureEvent;
    const swept = {
      sweptAt: 7,
      price: 94,
      index: 3,
    } as SmcLiquidity;
    const idm = pathwayInducement(analysis({ structure: [bos], liquidity: [swept] }), '5m');
    expect(idm).toEqual({ price: 94, index: 3, label: '5M-IDM' });
  });

  it('drops two 15-minute zones after the last BOS on a 1-minute chart', () => {
    const bos = { kind: 'BOS', dir: 'bull', level: 100, index: 10 } as SmcStructureEvent;
    expect(pathwayZones(analysis({ structure: [bos] }), 1)).toEqual({
      bosIndex: 10,
      zone1: 25,
      zone2: 40,
    });
    expect(lastBos(analysis({ structure: [bos] }))).toBe(bos);
  });

  it('keeps only the latest active FVG for the compact box', () => {
    const older = { id: 'a', status: 'active', index: 2, lo: 1, hi: 2 } as SmcAnalysis['fvgs'][number];
    const latest = { id: 'b', status: 'active', index: 6, lo: 3, hi: 4 } as SmcAnalysis['fvgs'][number];
    const filled = { id: 'c', status: 'filled', index: 8, lo: 5, hi: 6 } as SmcAnalysis['fvgs'][number];
    expect(lastCompactFvgs(analysis({ fvgs: [older, latest, filled] }), 1)).toEqual([latest]);
  });

  it('assembles the 1-minute paint model from session, BOS and a live trade', () => {
    const candles = [
      bar('2026-09-30T09:15:00', 110, 90),
      bar('2026-09-30T09:16:00', 108, 88),
    ];
    const bos = { kind: 'BOS', dir: 'bear', level: 105, index: 1 } as SmcStructureEvent;
    const trade = { sl: 106, slNow: 106, tpFinal: 86, side: 'SELL' } as SmcTrade;
    const model = pathwayPaintModel(candles, analysis({ structure: [bos] }), {
      htfLabel: '5m',
      intervalMinutes: 1,
      trade,
    });
    expect(model.session).toMatchObject({ day: '2026-09-30', high: 110, low: 88 });
    expect(model.bos).toBe(bos);
    expect(model.levels).toEqual({
      sl: 106,
      pe: 96,
      tg: 86,
      side: 'SELL',
      fromTrade: true,
    });
    expect(model.zones).toEqual({ bosIndex: 1, zone1: 16, zone2: 31 });
  });
});

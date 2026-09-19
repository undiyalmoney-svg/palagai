import { describe, expect, it } from 'vitest';
import { ATM_OPTION_DELTA, BOOK_LOT_SIZE } from '../paper-desk/option-delta.util';
import {
  AUTO_BOT_LABELS,
  BOT_TARGET_R,
  analyzeChartTrade,
  chartCandleAsOf,
  chartBookDeltaKind,
  chartWhyCaption,
  endOfIstDay,
  isLiveChartDay,
  istToday,
  lastPriceOnDay,
  replayChartAutoTrades,
  structureIndexPoints,
  structurePaperPnlRs,
  structuresOnDay,
  summarizeChartPnl,
} from './chart-auto-pnl.util';
import { ChartStructure } from './chart-structure.util';

function box(patch: Partial<ChartStructure> = {}): ChartStructure {
  return {
    dir: 1,
    option: 'CE',
    wall: 100,
    height: 10,
    sl: 90,
    entry: 100,
    exit: 110,
    pink: { lo: 90, hi: 100, fromIndex: 0, toIndex: 4 },
    teal: { lo: 100, hi: 110, fromIndex: 0, toIndex: 4 },
    breakIndex: 3,
    fromIndex: 0,
    toIndex: 4,
    date: '2026-09-17T10:00:00+05:30',
    status: 'hit_exit',
    fresh: false,
    ...patch,
  };
}

describe('chart auto-bot labels', () => {
  it('names one button per book', () => {
    expect(AUTO_BOT_LABELS.crude).toBe('Crude auto bot');
    expect(AUTO_BOT_LABELS.nifty).toBe('Nifty auto bot');
    expect(AUTO_BOT_LABELS.bank).toBe('Bank Nifty auto bot');
  });
});

describe('IST test date', () => {
  it('treats today as live and a past day as a closed session', () => {
    const now = new Date('2026-09-19T12:00:00+05:30');
    expect(istToday(now)).toBe('2026-09-19');
    expect(isLiveChartDay('2026-09-19', now)).toBe(true);
    expect(isLiveChartDay('2026-09-17', now)).toBe(false);
    expect(isLiveChartDay('', now)).toBe(true);
    expect(endOfIstDay('2026-09-17').toISOString()).toBe(
      new Date('2026-09-17T23:59:59+05:30').toISOString(),
    );
    expect(chartCandleAsOf('2026-09-17', now)).toEqual(endOfIstDay('2026-09-17'));
    expect(chartCandleAsOf('2026-09-19', now)).toEqual(now);
  });
});

describe('structure paper P&L', () => {
  it('pays +1R on EXIT and −1R on SL', () => {
    expect(structureIndexPoints(box({ status: 'hit_exit' }))).toBe(10);
    expect(structureIndexPoints(box({ status: 'hit_sl' }))).toBe(-10);
  });

  it('marks an open box to last price and clips to 1R', () => {
    const live = box({ status: 'live' });
    expect(structureIndexPoints(live, 104)).toBe(4);
    expect(structureIndexPoints(live, 80)).toBe(-10);
    expect(structureIndexPoints(live, 130)).toBe(10);
    expect(structureIndexPoints(box({ dir: -1, option: 'PE', status: 'live' }), 96)).toBe(4);
  });

  it('uses each book\'s ATM delta × lot size and books 0.5R, not the teal 1:1', () => {
    const win = box({ status: 'hit_exit', height: 10 });
    expect(structureIndexPoints(win)).toBe(10);
    expect(structurePaperPnlRs('nifty', win, 1)).toBeCloseTo(
      BOT_TARGET_R * 10 * ATM_OPTION_DELTA.nifty * BOOK_LOT_SIZE.nifty,
    );
    expect(structurePaperPnlRs('bank', win, 2)).toBeCloseTo(
      BOT_TARGET_R * 10 * ATM_OPTION_DELTA.bank * BOOK_LOT_SIZE.bank * 2,
    );
    expect(structurePaperPnlRs('crude', win, 3)).toBeCloseTo(
      BOT_TARGET_R * 10 * ATM_OPTION_DELTA.crude * BOOK_LOT_SIZE.crude * 3,
    );
    expect(chartBookDeltaKind('bank')).toBe('bank');
  });

  it('keeps only boxes from the test date and totals the three books', () => {
    const day = structuresOnDay(
      [
        box({ date: '2026-09-17T10:00:00+05:30', status: 'hit_exit' }),
        box({ date: '2026-09-18T10:00:00+05:30', status: 'hit_sl' }),
      ],
      '2026-09-17',
    );
    expect(day).toHaveLength(1);

    const summary = summarizeChartPnl({
      crude: { boxes: [box({ status: 'hit_exit' })], lots: 3 },
      nifty: { boxes: [box({ status: 'hit_sl' })], lots: 1 },
      bank: { boxes: [], lots: 1 },
    });
    expect(summary.books.crude.trades).toBe(1);
    expect(summary.books.bank.amount).toBe(0);
    expect(summary.total).toBeCloseTo(
      structurePaperPnlRs('crude', box({ status: 'hit_exit' }), 3) +
        structurePaperPnlRs('nifty', box({ status: 'hit_sl' }), 1),
    );
  });

  it('reads the last close on the test date, not a leftover live bar', () => {
    const candles = [
      { date: '2026-03-31T15:15:00+05:30', open: 1, high: 1, low: 1, close: 100, volume: 0 },
      { date: '2026-04-01T09:15:00+05:30', open: 1, high: 1, low: 1, close: 200, volume: 0 },
      { date: '2026-04-01T15:15:00+05:30', open: 1, high: 1, low: 1, close: 220, volume: 0 },
    ];
    expect(lastPriceOnDay(candles, '2026-04-01')).toBe(220);
  });

  it('takes one auto-bot position at a time so overlapping −1R tickets are dropped', () => {
    const candles = [
      { date: '2026-04-01T09:15:00+05:30', open: 100, high: 100, low: 100, close: 100, volume: 0 },
      { date: '2026-04-01T09:30:00+05:30', open: 100, high: 103, low: 96, close: 102, volume: 0 },
      { date: '2026-04-01T09:45:00+05:30', open: 109, high: 110, low: 108, close: 109, volume: 0 },
      { date: '2026-04-01T10:00:00+05:30', open: 109, high: 109, low: 89, close: 90, volume: 0 },
      { date: '2026-04-01T10:15:00+05:30', open: 90, high: 100, low: 88, close: 99, volume: 0 },
    ];
    const first = box({
      breakIndex: 1,
      status: 'hit_sl',
      date: '2026-04-01T09:30:00+05:30',
      sl: 90,
      exit: 120,
      height: 10,
      entry: 100,
    });
    const overlap = box({
      breakIndex: 2,
      status: 'hit_sl',
      date: '2026-04-01T09:45:00+05:30',
      sl: 90,
      exit: 120,
    });
    const after = box({
      breakIndex: 4,
      status: 'live',
      date: '2026-04-01T10:15:00+05:30',
      sl: 80,
      exit: 120,
    });
    const taken = replayChartAutoTrades([first, overlap, after], candles);
    expect(taken.map((b) => b.breakIndex)).toEqual([1, 4]);
    // Bar 2 prints 110 — that is 0.5R (105). The bot books there and does not
    // wait for the SL on bar 3.
    expect(taken[0]!.toIndex).toBe(2);
  });

  it('names failed breaks, give-backs, and 0.5R books', () => {
    const base = [
      { date: '2026-04-01T09:15:00+05:30', open: 100, high: 100, low: 100, close: 100, volume: 0 },
      { date: '2026-04-01T09:30:00+05:30', open: 100, high: 103, low: 99, close: 102, volume: 0 },
    ];
    const ce = box({ breakIndex: 1, height: 10, entry: 100, sl: 90, exit: 110, status: 'live' });

    const failed = analyzeChartTrade(ce, [
      ...base,
      { date: '2026-04-01T09:45:00+05:30', open: 102, high: 102, low: 89, close: 91, volume: 0 },
    ]);
    expect(failed.why).toBe('failed_break');
    expect(failed.points).toBe(-10);

    const gave = analyzeChartTrade(ce, [
      ...base,
      { date: '2026-04-01T09:45:00+05:30', open: 102, high: 104, low: 101, close: 103, volume: 0 },
      { date: '2026-04-01T10:00:00+05:30', open: 103, high: 103, low: 89, close: 91, volume: 0 },
    ]);
    expect(gave.why).toBe('gave_back');
    expect(gave.mfeR).toBeGreaterThan(0.35);
    expect(gave.points).toBe(-10);

    const half = analyzeChartTrade(ce, [
      ...base,
      { date: '2026-04-01T09:45:00+05:30', open: 102, high: 106, low: 101, close: 105, volume: 0 },
    ]);
    expect(half.why).toBe('booked_half');
    expect(half.points).toBe(5);
    expect(half.hold1rPoints).toBe(0);

    const eod = analyzeChartTrade(ce, [
      ...base,
      { date: '2026-04-01T09:45:00+05:30', open: 102, high: 103, low: 101, close: 102, volume: 0 },
    ]);
    expect(eod.why).toBe('eod');
    expect(eod.points).toBe(2);
  });

  it('summarises why counts so the P&L strip can say failed vs gave-back', () => {
    const summary = summarizeChartPnl({
      crude: { boxes: [box({ status: 'hit_exit' })], lots: 1 },
      nifty: { boxes: [box({ status: 'hit_sl' })], lots: 1 },
      bank: { boxes: [box({ status: 'live' })], lots: 1 },
    });
    expect(summary.why.booked_half).toBe(1);
    expect(summary.why.failed_break).toBe(1);
    expect(summary.why.eod).toBe(1);
    expect(chartWhyCaption(summary.why)).toBe('1 Failed break · 1 Booked 0.5R · 1 EOD');
  });
});

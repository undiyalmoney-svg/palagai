import { describe, expect, it } from 'vitest';
import { ATM_OPTION_DELTA, BOOK_LOT_SIZE } from '../paper-desk/option-delta.util';
import {
  AUTO_BOT_LABELS,
  chartCandleAsOf,
  chartBookDeltaKind,
  endOfIstDay,
  isLiveChartDay,
  istToday,
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

  it('uses each book\'s ATM delta × lot size', () => {
    const win = box({ status: 'hit_exit', height: 10 });
    expect(structurePaperPnlRs('nifty', win, 1)).toBeCloseTo(
      10 * ATM_OPTION_DELTA.nifty * BOOK_LOT_SIZE.nifty,
    );
    expect(structurePaperPnlRs('bank', win, 2)).toBeCloseTo(
      10 * ATM_OPTION_DELTA.bank * BOOK_LOT_SIZE.bank * 2,
    );
    expect(structurePaperPnlRs('crude', win, 3)).toBeCloseTo(
      10 * ATM_OPTION_DELTA.crude * BOOK_LOT_SIZE.crude * 3,
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
});

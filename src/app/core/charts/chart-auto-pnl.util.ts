/**
 * Charts-tab paper P&L for 1:1 auto-bot boxes.
 *
 * Same ATM delta × lot ladder Trade Bot uses when option OHLC is missing.
 * Charts-tab only — does not call the desk.
 */
import { Candle } from '../models/candle.model';
import { ATM_OPTION_DELTA, BOOK_LOT_SIZE } from '../paper-desk/option-delta.util';
import { extractTradeDate } from '../utils/trade-date.util';
import { ChartStructure, structureResolvedIndex } from './chart-structure.util';
import { ChartBookId } from './live-chart-data.service';

export const AUTO_BOT_LABELS: Record<ChartBookId, string> = {
  crude: 'Crude auto bot',
  nifty: 'Nifty auto bot',
  bank: 'Bank Nifty auto bot',
};

export const AUTO_BOT_SHORT: Record<ChartBookId, string> = {
  crude: 'Crude bot',
  nifty: 'Nifty bot',
  bank: 'Bank bot',
};

export const CHART_PNL_LABELS: Record<ChartBookId, string> = {
  crude: 'Crude Oil',
  nifty: 'Nifty',
  bank: 'Bank Nifty',
};

export const CHART_PNL_BOOKS: readonly ChartBookId[] = ['crude', 'nifty', 'bank'];

export function istToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Last instant of an IST calendar day, so a test date loads that session closed. */
export function endOfIstDay(day: string): Date {
  return new Date(`${day}T23:59:59+05:30`);
}

export function isLiveChartDay(day: string, now = new Date()): boolean {
  return !day || day >= istToday(now);
}

export function chartCandleAsOf(day: string, now = new Date()): Date {
  return isLiveChartDay(day, now) ? now : endOfIstDay(day);
}

export function chartBookDeltaKind(book: ChartBookId): 'crude' | 'nifty' | 'bank' {
  return book === 'crude' || book === 'bank' ? book : 'nifty';
}

/**
 * Signed index points the box made. EXIT is +1R, SL is −1R, an open box is
 * marked to last price and clipped to that same 1R.
 */
export function structureIndexPoints(
  box: ChartStructure,
  lastPrice?: number | null,
): number {
  if (box.status === 'hit_exit') return box.height;
  if (box.status === 'hit_sl') return -box.height;
  const last = Number(lastPrice);
  if (!Number.isFinite(last)) return 0;
  const raw = box.dir > 0 ? last - box.entry : box.entry - last;
  return Math.max(-box.height, Math.min(box.height, raw));
}

export function structurePaperPnlRs(
  book: ChartBookId,
  box: ChartStructure,
  lots: number,
  lastPrice?: number | null,
): number {
  const kind = chartBookDeltaKind(book);
  const points = structureIndexPoints(box, lastPrice);
  const n = Math.max(1, Math.floor(Number(lots) || 1));
  return points * ATM_OPTION_DELTA[kind] * BOOK_LOT_SIZE[kind] * n;
}

export function structuresOnDay(boxes: ChartStructure[], day: string): ChartStructure[] {
  if (!day) return boxes;
  return boxes.filter((box) => extractTradeDate(box.date) === day);
}

export function lastPriceOnDay(candles: Candle[], day: string): number | null {
  const onDay = day ? candles.filter((bar) => extractTradeDate(bar.date) === day) : candles;
  const last = onDay.length ? onDay[onDay.length - 1] : candles[candles.length - 1];
  const close = Number(last?.close);
  return Number.isFinite(close) ? close : null;
}

/**
 * One auto-bot position at a time: take a fresh 1:1, hold to SL / EXIT / EOD,
 * then the next break may fire. Stacking every zone pierce was painting a
 * pile of overlapping −1R tickets that never appeared as entries on the chart.
 */
export function replayChartAutoTrades(
  boxes: ChartStructure[],
  candles: Candle[],
): ChartStructure[] {
  const ordered = [...boxes].sort((a, b) => a.breakIndex - b.breakIndex);
  const taken: ChartStructure[] = [];
  let busyUntil = -1;
  for (const box of ordered) {
    if (box.breakIndex <= busyUntil) continue;
    taken.push(clipStructureToOutcome(box, candles));
    busyUntil = structureResolvedIndex(box, candles);
  }
  return taken;
}

/** Stop the pink/teal box at SL / EXIT / EOD so an old entry does not paint to the last bar. */
export function clipStructureToOutcome(box: ChartStructure, candles: Candle[]): ChartStructure {
  const end = structureResolvedIndex(box, candles);
  return {
    ...box,
    toIndex: end,
    pink: { ...box.pink, toIndex: end },
    teal: { ...box.teal, toIndex: end },
  };
}

export function sumChartPnlRs(
  book: ChartBookId,
  boxes: ChartStructure[],
  lots: number,
  lastPrice?: number | null,
): number {
  return boxes.reduce((sum, box) => sum + structurePaperPnlRs(book, box, lots, lastPrice), 0);
}

export interface ChartBookPnl {
  book: ChartBookId;
  label: string;
  amount: number;
  trades: number;
}

export interface ChartPnlSummary {
  books: Record<ChartBookId, ChartBookPnl>;
  total: number;
}

export function summarizeChartPnl(
  byBook: Record<ChartBookId, { boxes: ChartStructure[]; lots: number; lastPrice?: number | null }>,
): ChartPnlSummary {
  const books = {} as Record<ChartBookId, ChartBookPnl>;
  let total = 0;
  for (const book of CHART_PNL_BOOKS) {
    const row = byBook[book];
    const amount = sumChartPnlRs(book, row.boxes, row.lots, row.lastPrice);
    books[book] = {
      book,
      label: CHART_PNL_LABELS[book],
      amount,
      trades: row.boxes.length,
    };
    total += amount;
  }
  return { books, total };
}

/**
 * Charts-tab paper P&L for auto-bot boxes.
 *
 * The teal drawing is still a 1:1 measured move. The bot books 0.5R if it
 * prints, else the pink SL, else the day's last price. Same ATM delta × lot
 * ladder Trade Bot uses when option OHLC is missing. Charts-tab only — does
 * not call the desk.
 */
import { Candle } from '../models/candle.model';
import { ATM_OPTION_DELTA, BOOK_LOT_SIZE } from '../paper-desk/option-delta.util';
import { extractTradeDate } from '../utils/trade-date.util';
import { ChartStructure } from './chart-structure.util';
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

/** Auto bot books here. The teal box is still the 1:1 measured move. */
export const BOT_TARGET_R = 0.5;
/** If MFE reached this before SL, the trade was in profit and then given back. */
export const GAVE_BACK_MFE_R = 0.35;

export type ChartTradeWhy = 'failed_break' | 'gave_back' | 'booked_half' | 'eod';

export interface ChartTradePath {
  why: ChartTradeWhy;
  /** Best run toward the teal, in R (box height = 1R). */
  mfeR: number;
  /** Worst run toward the pink, in R. */
  maeR: number;
  /** Points the auto bot actually books (0.5R / −1R / EOD mark). */
  points: number;
  /** What holding for the full 1:1 would have scored. */
  hold1rPoints: number;
}

export interface ChartTradeReview {
  box: ChartStructure;
  path: ChartTradePath;
}

export const CHART_WHY_LABELS: Record<ChartTradeWhy, string> = {
  failed_break: 'Failed break',
  gave_back: 'Gave back',
  booked_half: 'Booked 0.5R',
  eod: 'EOD',
};

/** What the Charts auto bot actually does — teal on the chart is still 1:1. */
export const CHART_STRATEGY_BLURB =
  'Entry is a closed candle through S/R. The teal box is a 1:1 measured move — that target is often too far. The bot books 0.5R if it prints, otherwise the full pink SL. Losses are a failed break (never ran) or a give-back (ran, then SL).';

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

export function botTargetPrice(box: ChartStructure): number {
  return box.entry + box.dir * BOT_TARGET_R * box.height;
}

/**
 * Index points the auto bot books when we only have box status (no bar path).
 * EXIT is 0.5R, SL is −1R, an open box is marked to last price and clipped
 * to that same 0.5R / −1R band.
 */
export function botBookPoints(box: ChartStructure, lastPrice?: number | null): number {
  if (box.status === 'hit_exit') return BOT_TARGET_R * box.height;
  if (box.status === 'hit_sl') return -box.height;
  const last = Number(lastPrice);
  if (!Number.isFinite(last)) return 0;
  const raw = box.dir > 0 ? last - box.entry : box.entry - last;
  return Math.max(-box.height, Math.min(BOT_TARGET_R * box.height, raw));
}

/**
 * What the auto bot does after a wall close: book 0.5R if it prints, else
 * the pink SL, else the day's last price. Also records whether a loser had
 * already been in profit (gave back) or never ran (failed break).
 */
export function analyzeChartTrade(
  box: ChartStructure,
  candles: Candle[],
  lastPrice?: number | null,
): ChartTradePath {
  const height = box.height;
  const hold1rPoints = structureIndexPoints(box, lastPrice);
  if (!candles.length || box.breakIndex >= candles.length) {
    return {
      why: box.status === 'hit_sl' ? 'failed_break' : box.status === 'hit_exit' ? 'booked_half' : 'eod',
      mfeR: 0,
      maeR: 0,
      points: botBookPoints(box, lastPrice),
      hold1rPoints,
    };
  }
  const half = botTargetPrice(box);
  let mfe = 0;
  let mae = 0;
  let bookedHalf = false;
  let hitSl = false;

  const note = (bar: Candle) => {
    if (box.dir > 0) {
      mfe = Math.max(mfe, bar.high - box.entry);
      mae = Math.max(mae, box.entry - bar.low);
    } else {
      mfe = Math.max(mfe, box.entry - bar.low);
      mae = Math.max(mae, bar.high - box.entry);
    }
  };

  for (let i = box.breakIndex; i < candles.length; i += 1) {
    const bar = candles[i]!;
    note(bar);
    if (i > box.breakIndex) {
      if (box.dir > 0 ? bar.low <= box.sl : bar.high >= box.sl) {
        hitSl = true;
        break;
      }
    }
    if (box.dir > 0 ? bar.high >= half : bar.low <= half) {
      bookedHalf = true;
      break;
    }
  }

  const mfeR = height > 0 ? mfe / height : 0;
  const maeR = height > 0 ? mae / height : 0;
  if (bookedHalf) {
    return { why: 'booked_half', mfeR, maeR, points: BOT_TARGET_R * height, hold1rPoints };
  }
  if (hitSl) {
    return {
      why: mfeR >= GAVE_BACK_MFE_R ? 'gave_back' : 'failed_break',
      mfeR,
      maeR,
      points: -height,
      hold1rPoints,
    };
  }
  const marked = Number(lastPrice);
  const lastClose = Number(candles[candles.length - 1]?.close);
  const last = Number.isFinite(marked) ? marked : lastClose;
  const raw = Number.isFinite(last)
    ? box.dir > 0
      ? last - box.entry
      : box.entry - last
    : 0;
  return {
    why: 'eod',
    mfeR,
    maeR,
    points: Math.max(-height, Math.min(BOT_TARGET_R * height, raw)),
    hold1rPoints,
  };
}

export function botResolvedIndex(box: ChartStructure, candles: Candle[]): number {
  const half = botTargetPrice(box);
  for (let i = box.breakIndex; i < candles.length; i += 1) {
    const bar = candles[i]!;
    if (i > box.breakIndex) {
      if (box.dir > 0 ? bar.low <= box.sl : bar.high >= box.sl) {
        return i;
      }
    }
    if (box.dir > 0 ? bar.high >= half : bar.low <= half) {
      return i;
    }
  }
  return Math.max(box.breakIndex, candles.length - 1);
}

export function pointsToPnlRs(book: ChartBookId, points: number, lots: number): number {
  const kind = chartBookDeltaKind(book);
  const n = Math.max(1, Math.floor(Number(lots) || 1));
  return points * ATM_OPTION_DELTA[kind] * BOOK_LOT_SIZE[kind] * n;
}

export function structurePaperPnlRs(
  book: ChartBookId,
  box: ChartStructure,
  lots: number,
  lastPrice?: number | null,
  candles?: Candle[],
): number {
  const points = candles?.length
    ? analyzeChartTrade(box, candles, lastPrice).points
    : botBookPoints(box, lastPrice);
  return pointsToPnlRs(book, points, lots);
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
 * One auto-bot position at a time: take a fresh 1:1, book 0.5R / SL / EOD,
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
    busyUntil = botResolvedIndex(box, candles);
  }
  return taken;
}

export function reviewChartTrades(
  boxes: ChartStructure[],
  candles: Candle[],
  lastPrice?: number | null,
): ChartTradeReview[] {
  return boxes.map((box) => ({
    box,
    path: analyzeChartTrade(box, candles, lastPrice),
  }));
}

export function chartWhyCaption(why: Record<ChartTradeWhy, number>): string {
  return (['failed_break', 'gave_back', 'booked_half', 'eod'] as const)
    .filter((key) => why[key] > 0)
    .map((key) => `${why[key]} ${CHART_WHY_LABELS[key]}`)
    .join(' · ');
}

export function countTradeWhys(reviews: ChartTradeReview[]): Record<ChartTradeWhy, number> {
  const counts: Record<ChartTradeWhy, number> = {
    failed_break: 0,
    gave_back: 0,
    booked_half: 0,
    eod: 0,
  };
  for (const row of reviews) {
    counts[row.path.why] += 1;
  }
  return counts;
}

/** Stop the pink/teal box at the bot exit so an old entry does not paint to the last bar. */
export function clipStructureToOutcome(box: ChartStructure, candles: Candle[]): ChartStructure {
  const end = botResolvedIndex(box, candles);
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
  candles?: Candle[],
): number {
  return boxes.reduce(
    (sum, box) => sum + structurePaperPnlRs(book, box, lots, lastPrice, candles),
    0,
  );
}

export interface ChartBookPnl {
  book: ChartBookId;
  label: string;
  amount: number;
  trades: number;
  why: Record<ChartTradeWhy, number>;
}

export interface ChartPnlSummary {
  books: Record<ChartBookId, ChartBookPnl>;
  total: number;
  why: Record<ChartTradeWhy, number>;
}

export function summarizeChartPnl(
  byBook: Record<
    ChartBookId,
    { boxes: ChartStructure[]; lots: number; lastPrice?: number | null; candles?: Candle[] }
  >,
): ChartPnlSummary {
  const books = {} as Record<ChartBookId, ChartBookPnl>;
  const why: Record<ChartTradeWhy, number> = {
    failed_break: 0,
    gave_back: 0,
    booked_half: 0,
    eod: 0,
  };
  let total = 0;
  for (const book of CHART_PNL_BOOKS) {
    const row = byBook[book];
    const reviews = reviewChartTrades(row.boxes, row.candles ?? [], row.lastPrice);
    const counts = countTradeWhys(reviews);
    const amount = reviews.reduce(
      (sum, item) => sum + pointsToPnlRs(book, item.path.points, row.lots),
      0,
    );
    books[book] = {
      book,
      label: CHART_PNL_LABELS[book],
      amount,
      trades: row.boxes.length,
      why: counts,
    };
    total += amount;
    why.failed_break += counts.failed_break;
    why.gave_back += counts.gave_back;
    why.booked_half += counts.booked_half;
    why.eod += counts.eod;
  }
  return { books, total, why };
}

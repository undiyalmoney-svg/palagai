/**
 * Charts Master — decide trend vs chop on Crude / Nifty / Bank Nifty, then
 * only take with-trend 0.5R breaks.
 *
 * Classification uses the opening drive only (first ~45 minutes of that
 * book's session), so a test-date replay does not peek at the afternoon.
 * After a failed break or give-back, that book stands down for the rest of
 * the day.
 *
 * Charts-tab only. Does not call the desk or Trade Bot.
 */
import { Candle } from '../models/candle.model';
import { extractTradeDate } from '../utils/trade-date.util';
import {
  analyzeChartTrade,
  CHART_PNL_BOOKS,
  CHART_PNL_LABELS,
  replayChartAutoTrades,
} from './chart-auto-pnl.util';
import { ChartStructure } from './chart-structure.util';
import { ChartBookId } from './live-chart-data.service';

export type MasterBias = 'up' | 'down' | 'chop' | 'wait';
export type MasterAction = 'buy_ce' | 'buy_pe' | 'stand_down' | 'wait';

/** Minutes of session the Master needs before it will call a trend. */
export const MASTER_DRIVE_MINUTES = 45;
/** Never classify on fewer closed session bars than this. */
export const MASTER_MIN_DRIVE_BARS = 3;
/** Session range must be at least this many ATRs to count as a drive. */
export const MASTER_MIN_RANGE_ATR = 0.5;
/** Close must sit in this fraction of the drive range (top for up, bottom for down). */
export const MASTER_CLOSE_EXTREME = 0.62;
/** Net open→close must be at least this many ATRs. */
export const MASTER_MIN_MOVE_ATR = 0.2;

export const MASTER_BIAS_LABELS: Record<MasterBias, string> = {
  up: 'Trending up',
  down: 'Trending down',
  chop: 'Chop',
  wait: 'Waiting for open drive',
};

export const MASTER_ACTION_LABELS: Record<MasterAction, string> = {
  buy_ce: 'Buy CE',
  buy_pe: 'Buy PE',
  stand_down: 'Stand down',
  wait: 'Wait',
};

export interface MasterBookCall {
  book: ChartBookId;
  label: string;
  bias: MasterBias;
  action: MasterAction;
  reason: string;
  ready: boolean;
}

export interface MasterGuide {
  day: string;
  ready: boolean;
  books: Record<ChartBookId, MasterBookCall>;
  headline: string;
  detail: string;
}

export function masterDriveBarCount(intervalMinutes: number): number {
  const mins = Number(intervalMinutes) > 0 ? Number(intervalMinutes) : 15;
  return Math.max(MASTER_MIN_DRIVE_BARS, Math.ceil(MASTER_DRIVE_MINUTES / mins));
}

export function sessionBarsOnDay(candles: Candle[], day: string): Candle[] {
  if (!day) return candles;
  return candles.filter((bar) => extractTradeDate(bar.date) === day);
}

/** Index in `candles` of the last opening-drive bar, or -1 if not ready. */
export function masterReadyIndex(
  candles: Candle[],
  day: string,
  intervalMinutes: number,
): number {
  const session = sessionBarsOnDay(candles, day);
  const need = masterDriveBarCount(intervalMinutes);
  if (session.length < need) return -1;
  const last = session[need - 1]!;
  return candles.indexOf(last);
}

export function classifyMasterBias(
  candles: Candle[],
  day: string,
  intervalMinutes: number,
  atr?: number | null,
): { bias: MasterBias; reason: string; ready: boolean } {
  const session = sessionBarsOnDay(candles, day);
  const need = masterDriveBarCount(intervalMinutes);
  if (session.length < need) {
    return {
      bias: 'wait',
      ready: false,
      reason: `Need ${need} closed bars (~${MASTER_DRIVE_MINUTES}m) before Master calls the day.`,
    };
  }
  const drive = session.slice(0, need);
  const open = drive[0]!.open;
  const last = drive[drive.length - 1]!.close;
  let lo = Infinity;
  let hi = -Infinity;
  for (const bar of drive) {
    lo = Math.min(lo, bar.low);
    hi = Math.max(hi, bar.high);
  }
  const range = hi - lo;
  if (!(range > 0)) {
    return { bias: 'chop', ready: true, reason: 'Opening drive has no range.' };
  }
  const loc = (last - lo) / range;
  const move = last - open;
  const scale = atr != null && atr > 0 ? atr : range;
  const rangeOk = range >= MASTER_MIN_RANGE_ATR * scale;
  const moveOk = Math.abs(move) >= MASTER_MIN_MOVE_ATR * scale;

  if (move > 0 && rangeOk && moveOk && loc >= MASTER_CLOSE_EXTREME) {
    return {
      bias: 'up',
      ready: true,
      reason: `Open drive closed near the high — trade CE only.`,
    };
  }
  if (move < 0 && rangeOk && moveOk && loc <= 1 - MASTER_CLOSE_EXTREME) {
    return {
      bias: 'down',
      ready: true,
      reason: `Open drive closed near the low — trade PE only.`,
    };
  }
  return {
    bias: 'chop',
    ready: true,
    reason: 'Open drive is mid-range or too small — stand down.',
  };
}

export function masterActionFor(bias: MasterBias): MasterAction {
  if (bias === 'up') return 'buy_ce';
  if (bias === 'down') return 'buy_pe';
  if (bias === 'wait') return 'wait';
  return 'stand_down';
}

export function masterAllowsBox(call: MasterBookCall, box: ChartStructure): boolean {
  if (call.action === 'buy_ce') return box.option === 'CE' && box.dir > 0;
  if (call.action === 'buy_pe') return box.option === 'PE' && box.dir < 0;
  return false;
}

/**
 * One-at-a-time with-trend tickets only, and only after the opening drive.
 * The first failed break or give-back stops that book for the day.
 */
export function replayMasterTrades(
  boxes: ChartStructure[],
  candles: Candle[],
  day: string,
  intervalMinutes: number,
  atr?: number | null,
  lastPrice?: number | null,
): ChartStructure[] {
  const classified = classifyMasterBias(candles, day, intervalMinutes, atr);
  if (classified.bias !== 'up' && classified.bias !== 'down') return [];
  const readyAt = masterReadyIndex(candles, day, intervalMinutes);
  if (readyAt < 0) return [];
  const wantDir = classified.bias === 'up' ? 1 : -1;
  const aligned = boxes.filter((box) => box.dir === wantDir && box.breakIndex > readyAt);
  const sequential = replayChartAutoTrades(aligned, candles);
  const kept: ChartStructure[] = [];
  for (const box of sequential) {
    kept.push(box);
    const why = analyzeChartTrade(box, candles, lastPrice).why;
    if (why === 'failed_break' || why === 'gave_back') break;
  }
  return kept;
}

export function buildMasterBookCall(
  book: ChartBookId,
  candles: Candle[],
  day: string,
  intervalMinutes: number,
  atr?: number | null,
): MasterBookCall {
  const classified = classifyMasterBias(candles, day, intervalMinutes, atr);
  return {
    book,
    label: CHART_PNL_LABELS[book],
    bias: classified.bias,
    action: masterActionFor(classified.bias),
    reason: classified.reason,
    ready: classified.ready,
  };
}

export function buildMasterGuide(
  day: string,
  byBook: Record<ChartBookId, MasterBookCall>,
): MasterGuide {
  const books = {} as Record<ChartBookId, MasterBookCall>;
  for (const book of CHART_PNL_BOOKS) {
    books[book] = byBook[book];
  }
  const ready = CHART_PNL_BOOKS.some((book) => books[book]!.ready);
  const trade = CHART_PNL_BOOKS.filter(
    (book) => books[book]!.action === 'buy_ce' || books[book]!.action === 'buy_pe',
  );
  const waiting = CHART_PNL_BOOKS.filter((book) => books[book]!.action === 'wait');
  const chop = CHART_PNL_BOOKS.filter((book) => books[book]!.action === 'stand_down');

  let headline: string;
  if (!ready && waiting.length === CHART_PNL_BOOKS.length) {
    headline = 'Master is waiting for the opening drive on Crude, Nifty and Bank Nifty.';
  } else if (!trade.length) {
    headline = 'Chop day — Master stands down on all three books.';
  } else {
    const bits = trade.map((book) => `${books[book]!.label} ${MASTER_ACTION_LABELS[books[book]!.action]}`);
    headline = `Trending — ${bits.join(', ')}.`;
    if (chop.length) {
      headline += ` Skip ${chop.map((book) => books[book]!.label).join(', ')}.`;
    }
  }

  const detail = CHART_PNL_BOOKS.map(
    (book) => `${books[book]!.label}: ${MASTER_BIAS_LABELS[books[book]!.bias]} — ${books[book]!.reason}`,
  ).join(' ');

  return { day, ready, books, headline, detail };
}

export function emptyMasterCall(book: ChartBookId): MasterBookCall {
  return {
    book,
    label: CHART_PNL_LABELS[book],
    bias: 'wait',
    action: 'wait',
    reason: 'No candles yet.',
    ready: false,
  };
}

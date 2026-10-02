/**
 * Charts Protect — one toggle that runs Auto with the capital rules.
 *
 * The 25% stop and 0.5R target stay on the existing Auto path. This module
 * only decides WHETHER that path may fire: funds lots, one book, HTF must
 * already be printed, first fill then stand down, Crude after NSE.
 * Off = the per-chart Auto switches are the reader's.
 */
import { ChartBookId } from './live-chart-data.service';
import { optionSideForAlert } from './chart-auto-trade.util';
import { SmcAlertType, SmcTrend } from './smc/smc.types';
import { minutesOfDay } from '../utils/market-status.util';

export const CHART_PROTECT_DAY_KEY = 'palagai.chart.protect-day.v1';

/** First real 5m structure — skip the 09:15 open chop. */
export const INDEX_PROTECT_FROM = '09:50';
/** Do not open a cash-session fill into the close. */
export const INDEX_PROTECT_UNTIL = '15:15';
/** Crude is a second session, not a hedge on the same equity. */
export const CRUDE_PROTECT_FROM = '15:30';
export const CRUDE_PROTECT_UNTIL = '21:00';

export interface ChartProtectFlags {
  nifty: boolean;
  bank: boolean;
  crude: boolean;
}

export interface ChartProtectDay {
  date: string;
  /** Index book that already took today's Protect fill. Null until one fires. */
  nseBook: 'nifty' | 'bank' | null;
  placed: ChartProtectFlags;
  done: ChartProtectFlags;
}

export interface ProtectDecision {
  allow: boolean;
  reason: string;
}

const EMPTY_FLAGS: ChartProtectFlags = { nifty: false, bank: false, crude: false };

export function emptyProtectDay(date: string): ChartProtectDay {
  return {
    date,
    nseBook: null,
    placed: { ...EMPTY_FLAGS },
    done: { ...EMPTY_FLAGS },
  };
}

export function parseProtectDay(value: unknown, today: string): ChartProtectDay {
  const empty = emptyProtectDay(today);
  if (!value || typeof value !== 'object') return empty;
  const row = value as Record<string, unknown>;
  if (String(row['date'] || '') !== today) return empty;
  const nse = row['nseBook'];
  return {
    date: today,
    nseBook: nse === 'nifty' || nse === 'bank' ? nse : null,
    placed: parseFlags(row['placed']),
    done: parseFlags(row['done']),
  };
}

export function loadProtectDay(
  storage: Pick<Storage, 'getItem'> | null,
  today: string,
): ChartProtectDay {
  if (!storage) return emptyProtectDay(today);
  try {
    const raw = storage.getItem(CHART_PROTECT_DAY_KEY);
    return parseProtectDay(raw ? JSON.parse(raw) : null, today);
  } catch {
    return emptyProtectDay(today);
  }
}

export function saveProtectDay(
  storage: Pick<Storage, 'setItem'> | null,
  day: ChartProtectDay,
): void {
  try {
    storage?.setItem(CHART_PROTECT_DAY_KEY, JSON.stringify(day));
  } catch {
    // Private mode / quota: the in-memory day still gates this tab.
  }
}

export function isIndexChartBook(book: ChartBookId): book is 'nifty' | 'bank' {
  return book === 'nifty' || book === 'bank';
}

export function inProtectWindow(book: ChartBookId, istTime: string): boolean {
  const now = minutesOfDay(istTime);
  if (book === 'crude') {
    return now >= minutesOfDay(CRUDE_PROTECT_FROM) && now < minutesOfDay(CRUDE_PROTECT_UNTIL);
  }
  return now >= minutesOfDay(INDEX_PROTECT_FROM) && now < minutesOfDay(INDEX_PROTECT_UNTIL);
}

export function htfAllowsProtect(
  type: SmcAlertType,
  htfTrend: SmcTrend | null | undefined,
): boolean {
  if (type === 'BUY') return htfTrend === 'bullish';
  if (type === 'SELL') return htfTrend === 'bearish';
  return false;
}

export function openProtectBooks(
  trades: Array<{ book: ChartBookId | null; status: string }>,
): ChartBookId[] {
  const books: ChartBookId[] = [];
  for (const trade of trades) {
    if (!trade.book) continue;
    if (trade.status !== 'OPEN' && trade.status !== 'WORKING') continue;
    if (!books.includes(trade.book)) books.push(trade.book);
  }
  return books;
}

/**
 * Whether Protect would let this book's Auto button show as armed.
 * HTF is not required here — the fill still waits for a matching 5m trend.
 */
export function protectBookArmed(
  book: ChartBookId,
  day: ChartProtectDay,
  istTime: string,
): boolean {
  if (day.done[book] || day.placed[book]) return false;
  if (!inProtectWindow(book, istTime)) return false;
  if (isIndexChartBook(book) && day.nseBook && day.nseBook !== book) return false;
  return true;
}

export function decideProtectAuto(opts: {
  book: ChartBookId;
  type: SmcAlertType;
  liveDay: boolean;
  marketOpen: boolean;
  busy: boolean;
  htfTrend: SmcTrend | null | undefined;
  istTime: string;
  day: ChartProtectDay;
  openBooks: readonly ChartBookId[];
}): ProtectDecision {
  if (!opts.liveDay) return deny('not the live session');
  if (!opts.marketOpen) return deny('market closed');
  if (opts.busy) return deny('already working');
  if (optionSideForAlert(opts.type) == null) return deny('not a BUY or SELL');
  if (opts.openBooks.length) return deny('a fill is already open — no second trade');
  if (opts.day.done[opts.book] || opts.day.placed[opts.book]) {
    return deny(`${labelOf(opts.book)} already took today's Protect fill`);
  }
  if (isIndexChartBook(opts.book) && opts.day.nseBook && opts.day.nseBook !== opts.book) {
    return deny(`${labelOf(opts.day.nseBook)} already used the NSE slot`);
  }
  if (!inProtectWindow(opts.book, opts.istTime)) {
    return deny(
      opts.book === 'crude'
        ? `Crude waits ${CRUDE_PROTECT_FROM}–${CRUDE_PROTECT_UNTIL}`
        : `index waits ${INDEX_PROTECT_FROM}–${INDEX_PROTECT_UNTIL}`,
    );
  }
  if (!htfAllowsProtect(opts.type, opts.htfTrend)) {
    if (opts.htfTrend === 'bullish' || opts.htfTrend === 'bearish') {
      return deny(`5m is ${opts.htfTrend} — skip this ${opts.type}`);
    }
    return deny('5m sideways — sitting out');
  }
  return { allow: true, reason: 'Protect fill' };
}

export function markProtectPlaced(day: ChartProtectDay, book: ChartBookId): ChartProtectDay {
  const placed = { ...day.placed, [book]: true };
  const nseBook = isIndexChartBook(book) ? book : day.nseBook;
  return { ...day, nseBook, placed };
}

export function applyProtectCloses(
  day: ChartProtectDay,
  trades: Array<{ book: ChartBookId | null; status: string }>,
): ChartProtectDay {
  const open = new Set(openProtectBooks(trades));
  const done = { ...day.done };
  let changed = false;
  for (const book of ['nifty', 'bank', 'crude'] as const) {
    if (!day.placed[book] || day.done[book] || open.has(book)) continue;
    done[book] = true;
    changed = true;
  }
  return changed ? { ...day, done } : day;
}

export function protectStatusLine(opts: {
  on: boolean;
  liveDay: boolean;
  istTime: string;
  day: ChartProtectDay;
  openBooks: readonly ChartBookId[];
  trends: Partial<Record<ChartBookId, SmcTrend | null>>;
}): string {
  if (!opts.on) return 'Protect off — Auto on each chart is yours';
  if (!opts.liveDay) return 'Protect waits for today';
  if (opts.openBooks.length) {
    return `Protect · ${labelOf(opts.openBooks[0]!)} in a fill — no second trade`;
  }
  const doneBooks = (['nifty', 'bank', 'crude'] as const).filter((id) => opts.day.done[id]);
  if (doneBooks.includes('crude') && (opts.day.done.nifty || opts.day.done.bank || opts.day.nseBook)) {
    return 'Protect · done for today';
  }
  if (opts.day.done.crude) return 'Protect · Crude done for today';
  if (opts.day.nseBook && (opts.day.done[opts.day.nseBook] || opts.day.placed[opts.day.nseBook])) {
    if (minutesOfDay(opts.istTime) < minutesOfDay(CRUDE_PROTECT_FROM)) {
      return `Protect · ${labelOf(opts.day.nseBook)} done · Crude after ${CRUDE_PROTECT_FROM}`;
    }
    if (protectBookArmed('crude', opts.day, opts.istTime)) {
      return crudeWatchLine(opts.trends.crude);
    }
  }
  const watching = (['nifty', 'bank', 'crude'] as const).filter((id) =>
    protectBookArmed(id, opts.day, opts.istTime),
  );
  if (!watching.length) {
    if (minutesOfDay(opts.istTime) < minutesOfDay(INDEX_PROTECT_FROM)) {
      return `Protect · waiting until ${INDEX_PROTECT_FROM}`;
    }
    return 'Protect · sitting out';
  }
  if (watching.length === 1 && watching[0] === 'crude') return crudeWatchLine(opts.trends.crude);
  const indexWatch = watching.filter(isIndexChartBook);
  if (indexWatch.length && indexWatch.every((id) => !htfPrinted(opts.trends[id]))) {
    return 'Protect · 5m sideways — sitting out';
  }
  return `Protect · watching ${indexWatch.map(labelOf).join(' & ')} · lots from funds`;
}

function crudeWatchLine(trend: SmcTrend | null | undefined): string {
  if (!htfPrinted(trend)) return 'Protect · Crude 5m sideways — sitting out';
  return 'Protect · watching Crude · lots from funds';
}

function htfPrinted(trend: SmcTrend | null | undefined): boolean {
  return trend === 'bullish' || trend === 'bearish';
}

function parseFlags(value: unknown): ChartProtectFlags {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    nifty: row['nifty'] === true,
    bank: row['bank'] === true,
    crude: row['crude'] === true,
  };
}

function deny(reason: string): ProtectDecision {
  return { allow: false, reason };
}

function labelOf(book: ChartBookId): string {
  if (book === 'bank') return 'Bank';
  if (book === 'crude') return 'Crude';
  return 'Nifty';
}

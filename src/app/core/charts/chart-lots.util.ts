/**
 * Charts ATM sizing — ₹40,000 per index lot, Crude 3× that band.
 *
 * Actual Kite equity wins when it is a positive number. Otherwise the saved
 * capital preference is the fallback, so a dead funds
 * fetch still sizes rather than silently falling back to Settings lots.
 */
import { ChartBookId } from './live-chart-data.service';
import { MAX_CRUDE_LOTS, MAX_DESK_LOTS, lotsFromAvailableFunds } from '../paper-desk/lots-from-funds';

export function chartBookKind(book: ChartBookId): 'index' | 'crude' {
  return book === 'crude' ? 'crude' : 'index';
}

export function sizingCapitalFromFunds(
  equityAvailableRs: number | null | undefined,
  savedCapitalRs: number,
): number {
  const actual = Math.floor(Number(equityAvailableRs) || 0);
  if (actual > 0) return actual;
  return Math.max(0, Math.floor(Number(savedCapitalRs) || 0));
}

export function lotsForChartBook(
  book: ChartBookId,
  equityAvailableRs: number | null | undefined,
  savedCapitalRs: number,
): number {
  return lotsFromAvailableFunds(
    sizingCapitalFromFunds(equityAvailableRs, savedCapitalRs),
    chartBookKind(book),
  );
}

export function maxChartLots(book: ChartBookId): number {
  return book === 'crude' ? MAX_CRUDE_LOTS : MAX_DESK_LOTS;
}

/** Manual +/− on a chart. Floor is 1 so a reader can size below the Crude 3-lot band. */
export function clampChartLots(book: ChartBookId, lots: number): number {
  const n = Math.floor(Number(lots) || 0);
  return Math.min(maxChartLots(book), Math.max(1, n));
}

export function lotsWithDelta(
  book: ChartBookId,
  baseLots: number,
  delta: number,
): number {
  return clampChartLots(book, baseLots + (Math.floor(Number(delta) || 0)));
}

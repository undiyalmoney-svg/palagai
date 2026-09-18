/**
 * Charts ATM sizing — the same ₹40,000 ladder Trade Bot uses.
 *
 * Actual Kite equity wins when it is a positive number. Otherwise the saved
 * capital preference (Trade Bot's "Mine") is the fallback, so a dead funds
 * fetch still sizes rather than silently falling back to Settings lots.
 */
import { ChartBookId } from './live-chart-data.service';
import { lotsFromAvailableFunds } from '../paper-desk/lots-from-funds';

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

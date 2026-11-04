/**
 * Paper fills that copy a live buy: pay the ask when the book is there.
 * Never invents a price. Does not place a Kite order. Profit is not guaranteed.
 */
import { LivePaperBookState } from './live-paper.engine';
import { SkippedSignal } from './paper-analytics.models';

export interface LiveBuyPrice {
  price: number | null;
  atAsk: boolean;
}

/** Live buy: ask first, last as fallback. Null when neither is a real quote. */
export function liveBuyPrice(ask: number | null | undefined, last: number | null | undefined): LiveBuyPrice {
  const a = Number(ask);
  if (Number.isFinite(a) && a > 0) return { price: a, atAsk: true };
  const l = Number(last);
  if (Number.isFinite(l) && l > 0) return { price: l, atAsk: false };
  return { price: null, atAsk: false };
}

export function lotCostRs(price: number, lot: number): number {
  return Math.round(price * lot);
}

export interface NeededLotQuote {
  contract: string;
  premium: number;
  costRs: number;
  atAsk: boolean;
  lot: number;
}

export function neededLotQuote(
  contract: string,
  lot: number,
  ask: number | null | undefined,
  last: number | null | undefined,
): NeededLotQuote | null {
  const fill = liveBuyPrice(ask, last);
  if (fill.price == null || lot <= 0) return null;
  return {
    contract,
    premium: Math.round(fill.price * 100) / 100,
    costRs: lotCostRs(fill.price, lot),
    atAsk: fill.atAsk,
    lot,
  };
}

/**
 * Books that were flattened only because premium × lot was over ₹3,500.
 * Replay today's bars so that signal can be taken at the live ask.
 * Leaves books that already filled today alone.
 */
export function replayBudgetSkips(book: LivePaperBookState): LivePaperBookState {
  if (book.side !== 'flat' || book.fills.length > 0) return book;
  const skips = book.skips || [];
  if (!skips.some((s) => s.reason === 'premium-over-budget')) return book;
  return {
    ...book,
    lastBarMin: -1,
    pendingDir: 0,
    pendingSig: 0,
    pendingMode: '',
    status: 'watching',
    reason: 'replay — taking the live-priced option',
    skips: skips.filter((s: SkippedSignal) => s.reason !== 'premium-over-budget'),
  };
}

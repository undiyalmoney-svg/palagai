/**
 * Capital protection and book selection.
 *
 * ₹14k cannot ATM-buy Nifty / Bank / Sensex options without putting most of
 * the account into one premium. Charts previously armed 1 index lot and 3
 * Crude Mini lots below ₹40k — that is the wash-out. This guard is the desk
 * rule: one book, one lot, skip the expiring contract, hard day-loss.
 *
 * Not a guaranteed profit.
 */
import { ATM_PREMIUM_RS_PER_LOT } from './capital-plan.util';
import {
  CRUDE_MIN_CAPITAL_RS,
  lotsFromAvailableFunds,
  RS_PER_LOT,
} from './lots-from-funds';

export { CRUDE_MIN_CAPITAL_RS };

export type GuardBook = 'nifty' | 'bank' | 'sensex' | 'crude';

export const OWNER_CAPITAL_RS = 14_000;
/** ATM option buying needs a full index lot of cash. Below this, index CE/PE is refused. */
export const INDEX_MIN_CAPITAL_RS = RS_PER_LOT;
/** Never put more than this fraction of cash into one option premium. */
export const MAX_PREMIUM_FRAC = 0.25;
/** Hard day stop as a fraction of cash — ~₹420 at ₹14k, matches Crude 40-pt day loss. */
export const DAY_LOSS_FRAC = 0.03;
export const MAX_OPEN_BOOKS = 1;

export const ATM_PREMIUM_PROXY_RS: Record<GuardBook, number> = {
  nifty: ATM_PREMIUM_RS_PER_LOT.nifty,
  bank: ATM_PREMIUM_RS_PER_LOT.bank,
  /** Sensex is display-only on the desk. Proxy is still too fat for ₹14k. */
  sensex: 8_000,
  /** Crude Mini ATM option proxy (doc 49). Futures are preferred at this capital. */
  crude: 1_500,
};

export const BOOK_LOT_UNITS: Record<GuardBook, number> = {
  nifty: 65,
  bank: 30,
  sensex: 20,
  crude: 1,
};

export const GUARD_BOOK_LABEL: Record<GuardBook, string> = {
  nifty: 'Nifty 50',
  bank: 'Bank Nifty',
  sensex: 'Sensex',
  crude: 'Crude Mini',
};

export type GuardProduct = 'FUT' | 'CEPE' | 'none';

export interface BookDecision {
  book: GuardBook;
  allowed: boolean;
  lots: number;
  product: GuardProduct;
  reason: string;
  /** One losing 25% premium stop, or Crude 20-pt futures stop. */
  oneLossRs: number;
  oneLossPct: number;
}

export interface CapitalGuard {
  capitalRs: number;
  premiumBudgetRs: number;
  dayLossCapRs: number;
  books: BookDecision[];
  allowed: GuardBook[];
  liveBook: GuardBook | null;
  note: string;
}

function cash(capitalRs: number): number {
  return Math.max(0, Math.floor(Number(capitalRs) || 0));
}

export function premiumBudgetRs(capitalRs: number): number {
  return Math.floor(cash(capitalRs) * MAX_PREMIUM_FRAC);
}

export function dayLossCapRs(capitalRs: number): number {
  return Math.max(0, Math.round(cash(capitalRs) * DAY_LOSS_FRAC));
}

/** 25% premium stop on one ATM lot (Charts default). Crude futures: 20 pts × ₹10. */
export function oneStopOutRs(book: GuardBook): number {
  if (book === 'crude') return 20 * 10;
  return Math.round(ATM_PREMIUM_PROXY_RS[book] * 0.25);
}

export function canBuyAtmOption(book: GuardBook, capitalRs: number): boolean {
  if (book === 'sensex') return false;
  if (book === 'crude') return false;
  const c = cash(capitalRs);
  if (c < INDEX_MIN_CAPITAL_RS) return false;
  return ATM_PREMIUM_PROXY_RS[book] <= premiumBudgetRs(c);
}

export function crudeFuturesLots(capitalRs: number): number {
  return lotsFromAvailableFunds(capitalRs, 'crude');
}

export function indexOptionLots(capitalRs: number): number {
  return lotsFromAvailableFunds(capitalRs, 'index');
}

/**
 * Charts buy ATM CE/PE. Below ₹40k that path is refused on every book —
 * Crude Mini futures live on the Crude Oil tab instead. ₹40k+ Charts is unchanged.
 */
export function chartAtmRefuseReason(book: GuardBook, capitalRs: number): string | null {
  const c = cash(capitalRs);
  if (c >= INDEX_MIN_CAPITAL_RS) return null;
  if (book === 'crude') {
    return (
      `₹${c.toLocaleString('en-IN')} cannot buy ATM options. Crude Mini futures ×1 is the live book ` +
      `on the Crude Oil tab. Charts CE/PE stands down until ₹${INDEX_MIN_CAPITAL_RS.toLocaleString('en-IN')}.`
    );
  }
  return decideBook(book, c).reason;
}

export function decideBook(book: GuardBook, capitalRs: number): BookDecision {
  const c = cash(capitalRs);
  const loss = oneStopOutRs(book);
  const pct = c > 0 ? Math.round((loss / c) * 1000) / 10 : 0;
  const base = { book, oneLossRs: loss, oneLossPct: pct };

  if (book === 'sensex') {
    return {
      ...base,
      allowed: false,
      lots: 0,
      product: 'none',
      reason: 'Sensex is display-only. No option book, and ATM premium would still eat this cash.',
    };
  }

  if (book === 'nifty' || book === 'bank') {
    const prem = ATM_PREMIUM_PROXY_RS[book];
    const lots = canBuyAtmOption(book, c) ? indexOptionLots(c) : 0;
    if (!lots) {
      return {
        ...base,
        allowed: false,
        lots: 0,
        product: 'none',
        reason: `${book === 'nifty' ? 'Nifty' : 'Bank Nifty'} ATM ~₹${prem.toLocaleString('en-IN')} / lot. ₹${c.toLocaleString('en-IN')} cannot buy that without washing the account. Need ≥₹${INDEX_MIN_CAPITAL_RS.toLocaleString('en-IN')}.`,
      };
    }
    return {
      ...base,
      allowed: true,
      lots,
      product: 'CEPE',
      reason: `${book === 'nifty' ? 'Nifty' : 'Bank Nifty'} ATM CE/PE ×${lots}. Skip Tuesday/monthly expiry day — next contract only.`,
    };
  }

  const lots = crudeFuturesLots(c);
  if (!lots) {
    return {
      ...base,
      allowed: false,
      lots: 0,
      product: 'none',
      reason: `Crude Mini futures need ≥₹${CRUDE_MIN_CAPITAL_RS.toLocaleString('en-IN')} (1 lot MIS + 40-pt day buffer).`,
    };
  }
  return {
    ...base,
    allowed: true,
    lots,
    product: 'FUT',
    reason:
      lots === 1
        ? 'Crude Mini futures ×1 lot. Defined 20-pt stop (₹200) + ₹50/RT. Next month on expiry day. No option buying at this cash.'
        : `Crude Mini futures ×${lots}. Next month on expiry day.`,
  };
}

export function guardCapital(capitalRs: number = OWNER_CAPITAL_RS): CapitalGuard {
  const c = cash(capitalRs);
  const books = (['nifty', 'bank', 'sensex', 'crude'] as const).map((b) => decideBook(b, c));
  const allowed = books.filter((b) => b.allowed).map((b) => b.book);
  const liveBook = allowed.includes('crude') ? 'crude' : allowed[0] || null;
  const dayLoss = dayLossCapRs(c);
  const budget = premiumBudgetRs(c);
  const live = books.find((b) => b.book === liveBook) || null;
  const note = live
    ? `₹${c.toLocaleString('en-IN')} · live ${live.book} ${live.product} ×${live.lots} · day loss cap ₹${dayLoss} · one book. Not a guaranteed profit.`
    : `₹${c.toLocaleString('en-IN')} · no book fits. Do not buy ATM index options.`;
  return {
    capitalRs: c,
    premiumBudgetRs: budget,
    dayLossCapRs: dayLoss,
    books,
    allowed,
    liveBook,
    note,
  };
}

export function expiryRule(book: GuardBook): string {
  switch (book) {
    case 'nifty':
      return 'Nifty weekly is Tuesday. On expiry day trade the next Tuesday — never the dying week.';
    case 'bank':
      return 'Bank Nifty is monthly (last Tuesday). On expiry day trade the next month.';
    case 'sensex':
      return 'Sensex is not a live book.';
    case 'crude':
      return 'CRUDEOILM futures: on expiry day skip the dying month and trade the next listed future.';
  }
}

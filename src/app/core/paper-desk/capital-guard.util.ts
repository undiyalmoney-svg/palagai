/**
 * Capital protection and book selection.
 *
 * Motto: buy CE / PE. ₹14k cannot ATM-buy Nifty / Bank / Sensex / Crude
 * options without putting most of the account into one premium. Cheap
 * next-expiry OTM that fits the ₹3,500 budget and ₹420 day-loss is the
 * 14k plan. Crude Best live stays 1-lot FUT until that book is assigned.
 *
 * Not a guaranteed profit.
 */
import { ATM_PREMIUM_RS_PER_LOT } from './capital-plan.util';
import {
  CRUDE_MIN_CAPITAL_RS,
  lotsFromAvailableFunds,
  RS_PER_LOT,
} from './lots-from-funds';
import {
  OPTION_14K_BOOKS,
  canBuyCheapCepe as cheapFits,
} from './option-14k-plan';

export { CRUDE_MIN_CAPITAL_RS };

export type GuardBook = 'nifty' | 'bank' | 'sensex' | 'crude';

export const OWNER_CAPITAL_RS = 14_000;
/** ATM option buying needs a full index lot of cash. Below this, ATM CE/PE is refused. */
export const INDEX_MIN_CAPITAL_RS = RS_PER_LOT;
/** Never put more than this fraction of cash into one option premium. */
export const MAX_PREMIUM_FRAC = 0.25;
/** Hard day stop as a fraction of cash — ~₹420 at ₹14k. */
export const DAY_LOSS_FRAC = 0.03;
export const MAX_OPEN_BOOKS = 1;

export const ATM_PREMIUM_PROXY_RS: Record<GuardBook, number> = {
  nifty: ATM_PREMIUM_RS_PER_LOT.nifty,
  bank: ATM_PREMIUM_RS_PER_LOT.bank,
  sensex: 8_000,
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
  /** One losing cheap-OTM stop, or ATM 25% premium stop above ₹40k. */
  oneLossRs: number;
  oneLossPct: number;
}

export interface CapitalGuard {
  capitalRs: number;
  premiumBudgetRs: number;
  dayLossCapRs: number;
  books: BookDecision[];
  allowed: GuardBook[];
  /** Crude Best live worker — still FUT until CE/PE is assigned. */
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

export function canBuyCheapCepe(book: GuardBook, capitalRs: number): boolean {
  const c = cash(capitalRs);
  return cheapFits(book, c, premiumBudgetRs(c), dayLossCapRs(c));
}

/** 25% ATM premium stop above ₹40k. At ₹14k: cheap OTM one-stop. */
export function oneStopOutRs(book: GuardBook, capitalRs: number = OWNER_CAPITAL_RS): number {
  if (canBuyAtmOption(book, capitalRs)) {
    return Math.round(ATM_PREMIUM_PROXY_RS[book] * 0.25);
  }
  return OPTION_14K_BOOKS[book].oneStopRs;
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
 * Charts buy ATM CE/PE. Below ₹40k that path is refused on every book.
 * Cheap OTM CE/PE is the 14k plan on Test — not Charts ATM.
 */
export function chartAtmRefuseReason(book: GuardBook, capitalRs: number): string | null {
  const c = cash(capitalRs);
  if (c >= INDEX_MIN_CAPITAL_RS) return null;
  const cheap = OPTION_14K_BOOKS[book];
  if (book === 'crude') {
    return (
      `₹${c.toLocaleString('en-IN')} cannot buy ATM options. Crude Mini futures ×1 is the live book ` +
      `on the Crude Oil tab. Cheap ${cheap.product} is the 14k plan on Test. Charts ATM stands down ` +
      `until ₹${INDEX_MIN_CAPITAL_RS.toLocaleString('en-IN')}.`
    );
  }
  if (book === 'sensex') {
    return (
      `Sensex ATM is blocked at ₹${c.toLocaleString('en-IN')}. Cheap ${cheap.product} is the 14k plan ` +
      `on Test. Charts ATM stands down until ₹${INDEX_MIN_CAPITAL_RS.toLocaleString('en-IN')}.`
    );
  }
  const prem = ATM_PREMIUM_PROXY_RS[book];
  return (
    `${book === 'nifty' ? 'Nifty' : 'Bank Nifty'} ATM ~₹${prem.toLocaleString('en-IN')} / lot. ` +
    `₹${c.toLocaleString('en-IN')} cannot buy that without washing the account. Cheap ${cheap.product} ` +
    `is the 14k plan on Test. Need ≥₹${INDEX_MIN_CAPITAL_RS.toLocaleString('en-IN')} for ATM.`
  );
}

export function decideBook(book: GuardBook, capitalRs: number): BookDecision {
  const c = cash(capitalRs);
  const loss = oneStopOutRs(book, c);
  const pct = c > 0 ? Math.round((loss / c) * 1000) / 10 : 0;
  const base = { book, oneLossRs: loss, oneLossPct: pct };
  const cheap = OPTION_14K_BOOKS[book];

  if (canBuyAtmOption(book, c)) {
    const lots = indexOptionLots(c);
    return {
      ...base,
      allowed: true,
      lots,
      product: 'CEPE',
      reason: `${book === 'nifty' ? 'Nifty' : 'Bank Nifty'} ATM CE/PE ×${lots}. Skip Tuesday/monthly expiry day — next contract only.`,
    };
  }

  if (canBuyCheapCepe(book, c)) {
    return {
      ...base,
      allowed: true,
      lots: 1,
      product: 'CEPE',
      reason:
        book === 'crude'
          ? `Crude Mini cheap CE/PE ×1 (~₹${cheap.openCostRs.toLocaleString('en-IN')} premium, ${cheap.slPrem}-pt premium stop ₹${cheap.oneStopRs}). Skip expiry day. ATM still blocked. Crude Best live stays 1-lot FUT until you assign this book.`
          : `${GUARD_BOOK_LABEL[book]} cheap CE/PE ×1 (~₹${cheap.openCostRs.toLocaleString('en-IN')} premium, one-stop ₹${cheap.oneStopRs}). Skip expiry day. ATM still blocked at this cash.`,
    };
  }

  if (book === 'crude') {
    const lots = crudeFuturesLots(c);
    if (lots) {
      return {
        ...base,
        allowed: true,
        lots,
        product: 'FUT',
        reason: `Crude Mini futures ×${lots}. Next month on expiry day.`,
      };
    }
    return {
      ...base,
      allowed: false,
      lots: 0,
      product: 'none',
      reason: `Crude Mini needs ≥₹${CRUDE_MIN_CAPITAL_RS.toLocaleString('en-IN')} free (cheap CE/PE or 1 lot MIS + 40-pt day buffer).`,
    };
  }

  const prem = ATM_PREMIUM_PROXY_RS[book];
  return {
    ...base,
    allowed: false,
    lots: 0,
    product: 'none',
    reason: `${GUARD_BOOK_LABEL[book]} ATM ~₹${prem.toLocaleString('en-IN')} / lot. ₹${c.toLocaleString('en-IN')} cannot buy that, and cheap OTM does not fit the budget. Need ≥₹${INDEX_MIN_CAPITAL_RS.toLocaleString('en-IN')} for ATM.`,
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
  const cheapCount = books.filter((b) => b.allowed && b.product === 'CEPE').length;
  const note = live
    ? `₹${c.toLocaleString('en-IN')} · motto CE/PE · ${cheapCount} cheap OTM book${cheapCount === 1 ? '' : 's'} · day loss cap ₹${dayLoss} · ATM blocked. Crude Best live stays FUT until assigned. Not a guaranteed profit.`
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
  return OPTION_14K_BOOKS[book].expiryNote;
}

/**
 * Capital protection and book selection.
 *
 * Motto: buy CE / PE. ₹14k cannot ATM-buy Nifty / Bank / Sensex / Crude
 * options without putting most of the account into one premium. Cheap
 * next-expiry OTM that fits the ₹3,500 budget and ₹420 day-loss is the
 * 14k plan. Crude Mini FUT is refused at this cash (Kite NRML ~₹31k).
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
  /** Option premium outlay for the allowed lots. 0 for FUT (margin) and blocked books. */
  premiumRs: number;
}

export interface CapitalGuard {
  capitalRs: number;
  premiumBudgetRs: number;
  dayLossCapRs: number;
  books: BookDecision[];
  allowed: GuardBook[];
  /** Crude is preferred, otherwise the first allowed book. Not a live-order assignment. */
  liveBook: GuardBook | null;
  /** Premium if every allowed option book is open at once. */
  allOpenPremiumRs: number;
  /** Loss if every allowed option book stops out in the same day. */
  allOpenWorstLossRs: number;
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

/** 25% ATM premium stop where ATM is allowed; otherwise the cheap OTM one-stop. */
export function oneStopOutRs(book: GuardBook, capitalRs: number = OWNER_CAPITAL_RS): number {
  if (canBuyAtmOption(book, capitalRs)) {
    return atmStopRs(book);
  }
  return OPTION_14K_BOOKS[book].oneStopRs;
}

function atmStopRs(book: GuardBook): number {
  return Math.round(ATM_PREMIUM_PROXY_RS[book] * 0.25);
}

/**
 * Smallest cash where one ATM lot respects both the 25% premium budget and the
 * 3% day-loss cap on a 25% premium stop. Only Nifty and Bank have an ATM book.
 */
export function atmMinCapitalRs(book: GuardBook): number | null {
  if (book === 'sensex' || book === 'crude') return null;
  const byBudget = ATM_PREMIUM_PROXY_RS[book] / MAX_PREMIUM_FRAC;
  const byDayLoss = atmStopRs(book) / DAY_LOSS_FRAC;
  const need = Math.ceil((Math.max(byBudget, byDayLoss) - 1e-6) / 1000) * 1000;
  return Math.max(INDEX_MIN_CAPITAL_RS, need);
}

export function canBuyAtmOption(book: GuardBook, capitalRs: number): boolean {
  const min = atmMinCapitalRs(book);
  if (min == null) return false;
  const c = cash(capitalRs);
  if (c < min) return false;
  return ATM_PREMIUM_PROXY_RS[book] <= premiumBudgetRs(c) && atmStopRs(book) <= dayLossCapRs(c);
}

/** ATM lots capped by cash band, premium budget, and the day-loss cap on stops. */
export function atmLots(book: GuardBook, capitalRs: number): number {
  if (!canBuyAtmOption(book, capitalRs)) return 0;
  const c = cash(capitalRs);
  return Math.max(
    1,
    Math.min(
      indexOptionLots(c),
      Math.floor(premiumBudgetRs(c) / ATM_PREMIUM_PROXY_RS[book]),
      Math.floor(dayLossCapRs(c) / atmStopRs(book)),
    ),
  );
}

export function crudeFuturesLots(capitalRs: number): number {
  return lotsFromAvailableFunds(capitalRs, 'crude');
}

export function indexOptionLots(capitalRs: number): number {
  return lotsFromAvailableFunds(capitalRs, 'index');
}

/**
 * Charts buy ATM CE/PE. Nifty and Bank ATM are refused until one 25% stop fits
 * the 3% day cap. Crude and Sensex ATM are refused below ₹40k.
 * Cheap OTM CE/PE is the small-cash plan on Test — not Charts ATM.
 */
export function chartAtmRefuseReason(book: GuardBook, capitalRs: number): string | null {
  const c = cash(capitalRs);
  const cheap = OPTION_14K_BOOKS[book];
  if (book === 'nifty' || book === 'bank') {
    if (canBuyAtmOption(book, c)) return null;
  } else if (c >= INDEX_MIN_CAPITAL_RS) {
    return null;
  }
  if (book === 'crude') {
    return (
      `₹${c.toLocaleString('en-IN')} cannot buy ATM options. Crude Mini FUT NRML is ~₹31,000 — Kite ` +
      `rejects 1 lot at ₹14,000. Cheap ${cheap.product} is the 14k plan on Test. Charts ATM stands down ` +
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
  const need = atmMinCapitalRs(book) ?? INDEX_MIN_CAPITAL_RS;
  return (
    `${book === 'nifty' ? 'Nifty' : 'Bank Nifty'} ATM ~₹${prem.toLocaleString('en-IN')} / lot, one 25% stop ` +
    `₹${atmStopRs(book).toLocaleString('en-IN')} vs ₹${dayLossCapRs(c).toLocaleString('en-IN')} day cap at ` +
    `₹${c.toLocaleString('en-IN')}. Cheap ${cheap.product} is the 14k plan on Test. ` +
    `Need ≥₹${need.toLocaleString('en-IN')} for ATM.`
  );
}

export function decideBook(book: GuardBook, capitalRs: number): BookDecision {
  const c = cash(capitalRs);
  const loss = oneStopOutRs(book, c);
  const pct = c > 0 ? Math.round((loss / c) * 1000) / 10 : 0;
  const base = { book, oneLossRs: loss, oneLossPct: pct, premiumRs: 0 };
  const cheap = OPTION_14K_BOOKS[book];

  if (canBuyAtmOption(book, c)) {
    const lots = atmLots(book, c);
    return {
      ...base,
      allowed: true,
      lots,
      product: 'CEPE',
      premiumRs: ATM_PREMIUM_PROXY_RS[book] * lots,
      reason: `${book === 'nifty' ? 'Nifty' : 'Bank Nifty'} ATM CE/PE ×${lots}. Skip Tuesday/monthly expiry day — next contract only.`,
    };
  }

  if (canBuyCheapCepe(book, c)) {
    return {
      ...base,
      allowed: true,
      lots: 1,
      product: 'CEPE',
      premiumRs: cheap.openCostRs,
      reason:
        book === 'crude'
          ? `Crude Mini cheap CE/PE ×1 (~₹${cheap.openCostRs.toLocaleString('en-IN')} premium, ${cheap.slPrem}-pt premium stop ₹${cheap.oneStopRs}). Kite FUT NRML is ~₹31,000 — ₹14,000 is rejected. Skip expiry day. ATM still blocked.`
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
  const optionBooks = books.filter((b) => b.allowed && b.product === 'CEPE');
  const atmCount = optionBooks.filter((b) => canBuyAtmOption(b.book, c)).length;
  const cheapCount = optionBooks.length - atmCount;
  const allOpenPremiumRs = optionBooks.reduce((n, b) => n + b.premiumRs, 0);
  const allOpenWorstLossRs = optionBooks.reduce((n, b) => n + b.oneLossRs * b.lots, 0);
  const atmNote = atmCount ? `${atmCount} ATM` : 'ATM blocked';
  const note = live
    ? `₹${c.toLocaleString('en-IN')} · motto CE/PE · ${cheapCount} cheap OTM book${cheapCount === 1 ? '' : 's'} · ${atmNote} · day loss cap ₹${dayLoss.toLocaleString('en-IN')} · all open ₹${allOpenPremiumRs.toLocaleString('en-IN')} premium, worst ₹${allOpenWorstLossRs.toLocaleString('en-IN')}. Crude FUT needs ~₹31,000 commodity. Not a guaranteed profit.`
    : `₹${c.toLocaleString('en-IN')} · no book fits. Do not buy ATM index options.`;
  return {
    capitalRs: c,
    premiumBudgetRs: budget,
    dayLossCapRs: dayLoss,
    books,
    allowed,
    liveBook,
    allOpenPremiumRs,
    allOpenWorstLossRs,
    note,
  };
}

export function expiryRule(book: GuardBook): string {
  return OPTION_14K_BOOKS[book].expiryNote;
}

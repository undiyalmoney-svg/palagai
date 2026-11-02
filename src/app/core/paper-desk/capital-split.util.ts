/**
 * How to split one total across Kite's two pockets for the four CE/PE books.
 *
 * Nifty, Bank Nifty and Sensex options buy from the equity pocket. Crude Mini
 * options buy from the commodity pocket. Each pocket gets its own 25% premium
 * budget and 3% day-loss cap from the capital guard.
 *
 * Not a guaranteed profit.
 */
import { GUARD_BOOK_LABEL, GuardBook, decideBook, premiumBudgetRs, dayLossCapRs } from './capital-guard.util';

/** Smallest commodity cash where one cheap Crude Mini option fits budget and day cap. */
export const CRUDE_OPTION_MIN_COMMODITY_RS = 7_000;
/** Below this total there is no room for both pockets. */
export const SPLIT_MIN_CAPITAL_RS = 21_000;
const COMMODITY_FRAC = 0.2;

export type SplitPocket = 'equity' | 'commodity';
export type SplitMode = 'all-open' | 'one-at-a-time' | 'too-small';

export interface SplitRow {
  book: GuardBook;
  label: string;
  pocket: SplitPocket;
  allowed: boolean;
  product: string;
  premiumRs: number;
  oneLossRs: number;
  reason: string;
}

export interface CapitalSplit {
  capitalRs: number;
  equityRs: number;
  commodityRs: number;
  mode: SplitMode;
  equityPremiumBudgetRs: number;
  equityDayLossCapRs: number;
  commodityPremiumBudgetRs: number;
  commodityDayLossCapRs: number;
  rows: SplitRow[];
  /** Premium if every allowed book is open together. */
  allOpenPremiumRs: number;
  /** Loss if every allowed book stops out the same day. */
  allOpenWorstLossRs: number;
  allOpenWorstLossPct: number;
  note: string;
}

function money(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function commodityShareRs(capitalRs: number): number {
  const c = Math.max(0, Math.floor(Number(capitalRs) || 0));
  if (c < SPLIT_MIN_CAPITAL_RS) return 0;
  const share = Math.round((c * COMMODITY_FRAC) / 1000) * 1000;
  return Math.min(c - 14_000, Math.max(CRUDE_OPTION_MIN_COMMODITY_RS, share));
}

export function planCapitalSplit(capitalRs: number): CapitalSplit {
  const capital = Math.max(0, Math.floor(Number(capitalRs) || 0));
  const commodityRs = commodityShareRs(capital);
  const equityRs = capital - commodityRs;
  const rows: SplitRow[] = [];

  for (const book of ['nifty', 'bank', 'sensex'] as const) {
    const d = decideBook(book, equityRs);
    rows.push({
      book,
      label: GUARD_BOOK_LABEL[book],
      pocket: 'equity',
      allowed: d.allowed,
      product: d.allowed ? (d.premiumRs > 0 && d.lots > 0 ? `${d.lots} lot CE/PE` : 'CE/PE') : 'blocked',
      premiumRs: d.allowed ? d.premiumRs : 0,
      oneLossRs: d.allowed ? d.oneLossRs * Math.max(1, d.lots) : 0,
      reason: d.reason,
    });
  }

  const crudeFunded = commodityRs >= CRUDE_OPTION_MIN_COMMODITY_RS;
  const crude = decideBook('crude', commodityRs);
  rows.push({
    book: 'crude',
    label: GUARD_BOOK_LABEL.crude,
    pocket: 'commodity',
    allowed: crudeFunded && crude.allowed,
    product: crudeFunded && crude.allowed ? '1 lot CE/PE' : 'blocked',
    premiumRs: crudeFunded && crude.allowed ? crude.premiumRs : 0,
    oneLossRs: crudeFunded && crude.allowed ? crude.oneLossRs : 0,
    reason: crudeFunded
      ? crude.reason
      : `Crude Mini options buy from the commodity pocket. Fund ≥${money(CRUDE_OPTION_MIN_COMMODITY_RS)} there ` +
        `(total ≥${money(SPLIT_MIN_CAPITAL_RS)}). Futures need ~₹31,000 and are not sized here.`,
  });

  const open = rows.filter((r) => r.allowed);
  const indexRows = open.filter((r) => r.pocket === 'equity');
  const indexPremium = indexRows.reduce((n, r) => n + r.premiumRs, 0);
  const indexWorst = indexRows.reduce((n, r) => n + r.oneLossRs, 0);
  const allOpenPremiumRs = open.reduce((n, r) => n + r.premiumRs, 0);
  const allOpenWorstLossRs = open.reduce((n, r) => n + r.oneLossRs, 0);
  const equityBudget = premiumBudgetRs(equityRs);
  const equityCap = dayLossCapRs(equityRs);
  const fitsTogether =
    indexRows.length > 0 && indexPremium <= equityBudget && indexWorst <= equityCap;

  let mode: SplitMode = 'too-small';
  if (open.length) mode = fitsTogether ? 'all-open' : 'one-at-a-time';

  const pct = capital > 0 ? Math.round((allOpenWorstLossRs / capital) * 1000) / 10 : 0;
  const note =
    mode === 'all-open'
      ? `${money(capital)}: ${money(equityRs)} equity + ${money(commodityRs)} commodity. All ${open.length} cheap CE/PE books can be open together: ${money(allOpenPremiumRs)} premium, worst day ${money(allOpenWorstLossRs)} (${pct}%). Not a guaranteed profit.`
      : mode === 'one-at-a-time'
        ? `${money(capital)}: run one book at a time. Together they would put ${money(indexPremium)} of equity premium against a ${money(equityBudget)} budget. Not a guaranteed profit.`
        : `${money(capital)} is too small for a CE/PE book. Do not buy ATM index options.`;

  return {
    capitalRs: capital,
    equityRs,
    commodityRs,
    mode,
    equityPremiumBudgetRs: equityBudget,
    equityDayLossCapRs: equityCap,
    commodityPremiumBudgetRs: premiumBudgetRs(commodityRs),
    commodityDayLossCapRs: dayLossCapRs(commodityRs),
    rows,
    allOpenPremiumRs,
    allOpenWorstLossRs,
    allOpenWorstLossPct: pct,
    note,
  };
}

/** Rupees to move equity → commodity so Kite matches the plan. 0 when already funded. */
export function commodityTopUpRs(plan: CapitalSplit, kiteCommodityRs: number | null | undefined): number {
  const have = Math.max(0, Math.floor(Number(kiteCommodityRs) || 0));
  return Math.max(0, plan.commodityRs - have);
}
